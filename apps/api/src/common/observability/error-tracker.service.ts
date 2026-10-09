import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@college-erp/database';
import {
  ErrorTracker,
  bumpWindow,
  createWebhookSink,
  WINDOW_COUNTERS,
  type TrackedErrorEvent,
} from '@college-erp/observability';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../prisma/platform-prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * API-side error tracker. Ships the shared ErrorTracker with:
 *  - a webhook sink when ERROR_TRACKING_WEBHOOK_URL is set (Slack-compatible JSON),
 *  - a Redis window bump so the alert engine sees error spikes,
 *  - optional persistence as deduplicated SystemErrorEvent rows (one row per fingerprint, with a
 *    count) when ERROR_TRACKING_PERSIST is on.
 *
 * Persistence failures are logged through Nest's plain Logger — never fed back into the tracker,
 * which would recurse.
 */
@Injectable()
export class ErrorTrackerService {
  private readonly logger = new Logger(ErrorTrackerService.name);
  private readonly tracker: ErrorTracker;

  constructor(
    config: AppConfigService,
    private readonly platformPrisma: PlatformPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.tracker = new ErrorTracker({
      source: 'api',
      enabled: config.get('ERROR_TRACKING_ENABLED'),
    });

    const webhookUrl = config.get('ERROR_TRACKING_WEBHOOK_URL');
    if (webhookUrl) {
      this.tracker.addSink(createWebhookSink({ url: webhookUrl }));
    }

    // Cross-process signal for the alert engine: every capture (even deduped ones) increments the
    // tracked_errors window; failures must never break the caller.
    this.tracker.addSink(() => {
      void bumpWindow(this.redis, WINDOW_COUNTERS.trackedErrors).catch(() => undefined);
    });

    if (config.get('ERROR_TRACKING_PERSIST')) {
      this.tracker.addSink((event) => this.persist(event));
    }
  }

  capture(
    error: unknown,
    context: Parameters<ErrorTracker['capture']>[1] = {},
  ): TrackedErrorEvent | null {
    return this.tracker.capture(error, context);
  }

  private async persist(event: TrackedErrorEvent): Promise<void> {
    const fingerprint = event.fingerprint;
    const common = {
      level: event.level,
      source: event.source,
      name: event.name,
      message: event.message,
      stack: event.stack ?? null,
      route: event.route ?? null,
      method: event.method ?? null,
      requestId: event.requestId ?? null,
      tenantId: event.tenantId ?? null,
      userId: event.userId ?? null,
    };
    const context = buildContextJson(event);
    try {
      await this.platformPrisma.client.systemErrorEvent.upsert({
        where: { fingerprint },
        create: {
          fingerprint,
          ...common,
          ...(context ? { context } : {}),
        },
        update: {
          ...common,
          ...(context ? { context } : {}),
          count: { increment: 1 },
          lastSeenAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist tracked error ${fingerprint}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/** Small JSONB snapshot; never includes request bodies — only routing/identity metadata. */
function buildContextJson(event: TrackedErrorEvent): Prisma.InputJsonValue | undefined {
  const context: Record<string, unknown> = {
    ...(event.statusCode !== undefined ? { statusCode: event.statusCode } : {}),
    ...(event.path ? { path: event.path } : {}),
    ...(event.jobId ? { jobId: event.jobId } : {}),
    ...(event.queue ? { queue: event.queue } : {}),
    ...(event.context ?? {}),
  };
  return Object.keys(context).length > 0 ? (context as Prisma.InputJsonValue) : undefined;
}
