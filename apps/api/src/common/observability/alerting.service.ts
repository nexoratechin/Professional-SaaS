import { Inject, Injectable, Logger, NotFoundException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { AlertStatus, AlertSeverity, Prisma, SystemAlert } from '@college-erp/database';
import {
  readWindowsSum,
  recordAlertFired,
  setActiveAlerts,
  WINDOW_COUNTERS,
  evaluateAlertRules,
  type AlertEvaluation,
  type AlertSignalSnapshot,
  getLogger,
} from '@college-erp/observability';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../prisma/platform-prisma.service';
import { QueueMonitoringService } from '../queue/queue-monitoring.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { HealthService } from '../../modules/health/health.service';

const WINDOW_SHORT_MINUTES = 15;
const WINDOW_LONG_MINUTES = 60;
const DISPATCH_MARKER = 'v1';

/**
 * The alert engine: gathers a signal snapshot (health probes, queue overview, Redis window
 * counters), evaluates every rule from @college-erp/observability, persists one open SystemAlert
 * per firing rule+scope, auto-resolves alerts whose condition cleared, and fans out dispatches to
 * the configured webhook.
 *
 * Dedupe/dispatch suppression uses a Redis SET NX per rule+scope with a sliding TTL
 * (ALERT_DEDUPE_MINUTES), so multiple API replicas can evaluate concurrently without duplicate
 * pages — the first replica to SET NX sends, the rest update the DB row silently. Persistence
 * upserts by (ruleKey, dedupeKey, open status), so replica races converge on one row.
 */
@Injectable()
export class AlertingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertingService.name);
  private timer?: NodeJS.Timeout;
  private evaluating = false;
  private readonly enabled: boolean;
  private readonly dedupeSeconds: number;
  private readonly webhookUrl?: string;

  constructor(
    private readonly config: AppConfigService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly health: HealthService,
    private readonly queueMonitoring: QueueMonitoringService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.enabled = config.get('ALERTING_ENABLED');
    this.dedupeSeconds = config.get('ALERT_DEDUPE_MINUTES') * 60;
    this.webhookUrl = config.get('ALERT_WEBHOOK_URL');
  }

  onModuleInit(): void {
    if (!this.enabled) {
      this.logger.log('Alerting disabled (ALERTING_ENABLED=false).');
      return;
    }
    const intervalMs = this.config.get('ALERT_EVAL_INTERVAL_MS');
    this.timer = setInterval(() => {
      void this.evaluate().catch((error: unknown) => {
        this.logger.warn(`Alert evaluation failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, intervalMs);
    this.timer.unref();
    this.logger.log(`Alert engine evaluating every ${intervalMs}ms (webhook ${this.webhookUrl ? 'configured' : 'not configured'}).`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One evaluation pass. Public for the platform-ops "evaluate now" endpoint and tests. */
  async evaluate(): Promise<AlertEvaluation[]> {
    if (!this.enabled || this.evaluating) return [];
    this.evaluating = true;
    try {
      const snapshot = await this.buildSnapshot();
      const evaluations = evaluateAlertRules(snapshot);

      for (const evaluation of evaluations) {
        await this.persistFiring(evaluation);
      }
      await this.resolveCleared(evaluations);
      await this.refreshActiveGauges();

      return evaluations;
    } finally {
      this.evaluating = false;
    }
  }

  // ── Snapshot assembly ─────────────────────────────────────────────────────────────────────

  private async buildSnapshot(): Promise<AlertSignalSnapshot> {
    const [readiness, queueOverview, shortWindows, longWindows] = await Promise.all([
      this.health.readiness(),
      this.queueMonitoring.overview().catch(() => undefined),
      readWindowsSum(
        this.redis,
        [
          WINDOW_COUNTERS.httpRequests,
          WINDOW_COUNTERS.http5xx,
          WINDOW_COUNTERS.authFailures,
          WINDOW_COUNTERS.suspiciousLogins,
          WINDOW_COUNTERS.queueFailures,
          WINDOW_COUNTERS.deadLetterMoves,
          WINDOW_COUNTERS.trackedErrors,
        ],
        WINDOW_SHORT_MINUTES,
      ),
      readWindowsSum(
        this.redis,
        [WINDOW_COUNTERS.paymentFailures, WINDOW_COUNTERS.notificationFailures, WINDOW_COUNTERS.storageFailures],
        WINDOW_LONG_MINUTES,
      ),
    ]);

    const queues = queueOverview?.queues ?? [];
    let maxQueueBacklog = 0;
    let maxQueueBacklogQueue: string | undefined;
    for (const queue of queues) {
      if (queue.name === 'dead-letter') continue;
      if (queue.backlog > maxQueueBacklog) {
        maxQueueBacklog = queue.backlog;
        maxQueueBacklogQueue = queue.name;
      }
    }

    const database = readiness.checks.database;
    const redisCheck = readiness.checks.redis;
    const storage = readiness.checks.storage;
    const workerCheck = readiness.checks.worker;

    return {
      databaseUp: database?.ok ?? false,
      redisUp: redisCheck?.ok ?? false,
      storageUp: storage?.ok ?? false,
      databaseLatencyMs: database?.latencyMs ?? 0,
      redisLatencyMs: redisCheck?.latencyMs ?? 0,
      workersOnline: workerCheck.online,
      workersExpected: workerCheck.expected,
      maxQueueBacklog,
      ...(maxQueueBacklogQueue ? { maxQueueBacklogQueue } : {}),
      deadLetterBacklog: queueOverview?.deadLetterBacklog ?? 0,
      httpRequests15m: shortWindows[WINDOW_COUNTERS.httpRequests] ?? 0,
      http5xx15m: shortWindows[WINDOW_COUNTERS.http5xx] ?? 0,
      authFailures15m: shortWindows[WINDOW_COUNTERS.authFailures] ?? 0,
      suspiciousLogins15m: shortWindows[WINDOW_COUNTERS.suspiciousLogins] ?? 0,
      queueFailures15m: shortWindows[WINDOW_COUNTERS.queueFailures] ?? 0,
      deadLetterMoves15m: shortWindows[WINDOW_COUNTERS.deadLetterMoves] ?? 0,
      paymentFailures60m: longWindows[WINDOW_COUNTERS.paymentFailures] ?? 0,
      notificationFailures60m: longWindows[WINDOW_COUNTERS.notificationFailures] ?? 0,
      storageFailures60m: longWindows[WINDOW_COUNTERS.storageFailures] ?? 0,
      trackedErrors15m: shortWindows[WINDOW_COUNTERS.trackedErrors] ?? 0,
    };
  }

  // ── Persistence / dispatch ────────────────────────────────────────────────────────────────

  private async persistFiring(evaluation: AlertEvaluation): Promise<void> {
    const dispatchKey = `obs:alert:dispatch:${evaluation.ruleKey}:${evaluation.dedupeKey}`;
    try {
      const existing = await this.platformPrisma.client.systemAlert.findFirst({
        where: { ruleKey: evaluation.ruleKey, dedupeKey: evaluation.dedupeKey, status: { in: ['FIRING', 'ACKNOWLEDGED'] } },
        orderBy: { firedAt: 'desc' },
      });

      if (existing) {
        await this.platformPrisma.client.systemAlert.update({
          where: { id: existing.id },
          data: {
            severity: evaluation.severity,
            title: evaluation.title,
            description: evaluation.description,
            metricName: evaluation.ruleKey,
            metricValue: evaluation.metricValue,
            threshold: evaluation.threshold,
            details: (evaluation.details ?? undefined) as Prisma.InputJsonValue | undefined,
            lastSeenAt: new Date(),
          },
        });
        await this.maybeDispatch(dispatchKey, evaluation);
        return;
      }

      // No open row: claim the dispatch first so exactly ONE replica creates the row and pages.
      // (Unclaimed replicas simply skip this tick; the row is visible to them as `existing` next
      // tick.) A crash between claim and create costs at most one dedupe window before retry.
      const claimed = await this.redis.set(dispatchKey, DISPATCH_MARKER, 'EX', this.dedupeSeconds, 'NX');
      if (claimed !== 'OK') return;

      await this.platformPrisma.client.systemAlert.create({
        data: {
          ruleKey: evaluation.ruleKey,
          dedupeKey: evaluation.dedupeKey,
          severity: evaluation.severity,
          status: 'FIRING',
          title: evaluation.title,
          description: evaluation.description,
          source: 'api',
          metricName: evaluation.ruleKey,
          metricValue: evaluation.metricValue,
          threshold: evaluation.threshold,
          details: (evaluation.details ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      recordAlertFired(evaluation.ruleKey, evaluation.severity);
      await this.sendWebhook('firing', evaluation);
    } catch (error) {
      this.logger.warn(
        `Failed to persist alert ${evaluation.ruleKey}/${evaluation.dedupeKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /** Re-pages a still-firing alert at most once per dedupe window, platform-wide. */
  private async maybeDispatch(dispatchKey: string, evaluation: AlertEvaluation): Promise<void> {
    const claimed = await this.redis.set(dispatchKey, DISPATCH_MARKER, 'EX', this.dedupeSeconds, 'NX');
    if (claimed !== 'OK') return;
    recordAlertFired(evaluation.ruleKey, evaluation.severity);
    await this.sendWebhook('firing', evaluation);
  }

  /** Open alerts whose condition no longer fires are marked RESOLVED (and a resolve is dispatched). */
  private async resolveCleared(evaluations: AlertEvaluation[]): Promise<void> {
    const firingKeys = new Set(evaluations.map((evaluation) => `${evaluation.ruleKey}\u0001${evaluation.dedupeKey}`));
    try {
      const open = await this.platformPrisma.client.systemAlert.findMany({
        where: { status: { in: ['FIRING', 'ACKNOWLEDGED'] } },
        select: { id: true, ruleKey: true, dedupeKey: true, severity: true, title: true, description: true },
      });
      for (const alert of open) {
        if (firingKeys.has(`${alert.ruleKey}\u0001${alert.dedupeKey}`)) continue;
        await this.platformPrisma.client.systemAlert.update({
          where: { id: alert.id },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        });
        // Clear the dispatch marker so a re-fire pages immediately instead of waiting out the
        // dedupe window.
        await this.redis.del(`obs:alert:dispatch:${alert.ruleKey}:${alert.dedupeKey}`).catch(() => undefined);
        getLogger().emit('info', `Alert resolved: ${alert.title}`, {
          rule: alert.ruleKey,
          dedupeKey: alert.dedupeKey,
        });
        await this.sendWebhook('resolved', {
          ruleKey: alert.ruleKey,
          severity: alert.severity,
          title: alert.title,
          description: alert.description ?? '',
          dedupeKey: alert.dedupeKey,
          metricValue: 0,
          threshold: 0,
        });
      }
    } catch (error) {
      this.logger.warn(`Failed to resolve cleared alerts: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async refreshActiveGauges(): Promise<void> {
    try {
      const rows = await this.platformPrisma.client.systemAlert.groupBy({
        by: ['severity'],
        where: { status: { in: ['FIRING', 'ACKNOWLEDGED'] } },
        _count: { _all: true },
      });
      const counts = new Map(rows.map((row) => [row.severity as string, row._count._all]));
      for (const severity of ['INFO', 'WARNING', 'CRITICAL'] as const) {
        setActiveAlerts(severity, counts.get(severity) ?? 0);
      }
    } catch {
      // Gauges refresh opportunistically; never fail the evaluation loop on this.
    }
  }

  private async sendWebhook(kind: 'firing' | 'resolved', evaluation: AlertEvaluation): Promise<void> {
    if (!this.webhookUrl) return;
    const emoji = kind === 'resolved' ? '✅' : evaluation.severity === 'CRITICAL' ? '🚨' : evaluation.severity === 'WARNING' ? '⚠️' : 'ℹ️';
    const text = `${emoji} [${evaluation.severity}] ${kind === 'resolved' ? 'RESOLVED' : 'ALERT'} — ${evaluation.title}`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      timer.unref?.();
      await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          text: `${text}\n${evaluation.description}`,
          source: 'college-erp',
          status: kind,
          alert: {
            rule: evaluation.ruleKey,
            dedupeKey: evaluation.dedupeKey,
            severity: evaluation.severity,
            metricValue: evaluation.metricValue,
            threshold: evaluation.threshold,
            details: evaluation.details ?? null,
            firedAt: new Date().toISOString(),
          },
        }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
    } catch (error) {
      this.logger.warn(`Alert webhook delivery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ── Operator queries ──────────────────────────────────────────────────────────────────────

  async listAlerts(filter: { status?: AlertStatus; severity?: AlertSeverity; take?: number }): Promise<SystemAlert[]> {
    return this.platformPrisma.client.systemAlert.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.severity ? { severity: filter.severity } : {}),
      },
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
      take: Math.min(Math.max(filter.take ?? 50, 1), 200),
    });
  }

  async acknowledgeAlert(id: string, platformUserId?: string): Promise<SystemAlert> {
    const alert = await this.platformPrisma.client.systemAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found.');
    return this.platformPrisma.client.systemAlert.update({
      where: { id },
      data: {
        status: 'ACKNOWLEDGED',
        acknowledgedAt: new Date(),
        acknowledgedByPlatformUserId: platformUserId ?? null,
      },
    });
  }

  async resolveAlert(id: string): Promise<SystemAlert> {
    const alert = await this.platformPrisma.client.systemAlert.findUnique({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found.');
    return this.platformPrisma.client.systemAlert.update({
      where: { id },
      data: { status: 'RESOLVED', resolvedAt: new Date() },
    });
  }
}
