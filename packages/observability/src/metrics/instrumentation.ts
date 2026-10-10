import { getLogger } from '../logging/logger';
import { defaultRegistry, type MetricsRegistry } from './registry';

/**
 * Named instrumentation helpers — the single place where metric names/labels are defined, so the
 * API, the worker and packages/database all emit the same series for the same event.
 *
 * Naming convention: `college_erp_<subsystem>_<what>_<unit>`; durations are HISTOGRAMS in seconds
 * (Prometheus convention), totals are counters, point-in-time values are gauges.
 */

const METRIC_PREFIX = 'college_erp';

let slowQueryThresholdMs = 500;

/** Configured by configureObservability(); packages/database's Prisma hook reads it. */
export function configureMetrics(options: { slowQueryMs?: number }): void {
  if (options.slowQueryMs && options.slowQueryMs > 0) {
    slowQueryThresholdMs = options.slowQueryMs;
  }
}

export function getSlowQueryThresholdMs(): number {
  return slowQueryThresholdMs;
}

function registry(): MetricsRegistry {
  return defaultRegistry;
}

function toSeconds(durationMs: number): number {
  return Math.max(0, durationMs) / 1000;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────

export function recordHttpRequest(input: {
  method: string;
  route: string;
  status: number;
  durationMs: number;
}): void {
  const { method, route, status, durationMs } = input;
  registry()
    .counter(`${METRIC_PREFIX}_http_requests_total`, 'Total HTTP requests by method, route and status.', [
      'method',
      'route',
      'status',
    ])
    .inc({ method, route, status });
  registry()
    .histogram(
      `${METRIC_PREFIX}_http_request_duration_seconds`,
      'HTTP request latency in seconds by method, route and status class.',
      ['method', 'route', 'status_class'],
    )
    .observe({ method, route, status_class: `${Math.floor(status / 100)}xx` }, toSeconds(durationMs));
}

export function recordHttpError(status: number, route: string): void {
  registry()
    .counter(`${METRIC_PREFIX}_http_errors_total`, 'HTTP error responses (4xx/5xx) by status and route.', [
      'status',
      'route',
    ])
    .inc({ status, route });
}

export function recordTenantRequest(tenantSlug: string): void {
  registry()
    .counter(`${METRIC_PREFIX}_tenant_http_requests_total`, 'HTTP requests per tenant (opt-in high-cardinality).', [
      'tenant',
    ])
    .inc({ tenant: tenantSlug });
}

// ── Database ─────────────────────────────────────────────────────────────────────────────────

export function recordDbQuery(input: {
  model: string;
  operation: string;
  durationMs: number;
  ok: boolean;
}): void {
  const { model, operation, durationMs, ok } = input;
  registry()
    .histogram(
      `${METRIC_PREFIX}_db_query_duration_seconds`,
      'Database query latency in seconds by Prisma model and operation.',
      ['model', 'operation'],
    )
    .observe({ model, operation }, toSeconds(durationMs));
  registry()
    .counter(`${METRIC_PREFIX}_db_queries_total`, 'Database queries by model, operation and result.', [
      'model',
      'operation',
      'result',
    ])
    .inc({ model, operation, result: ok ? 'ok' : 'error' });

  if (ok && durationMs >= slowQueryThresholdMs) {
    registry()
      .counter(`${METRIC_PREFIX}_db_slow_queries_total`, 'Queries slower than SLOW_QUERY_MS.', ['model', 'operation'])
      .inc({ model, operation });
    getLogger().emit('warn', 'Slow database query', {
      model,
      operation,
      durationMs: Math.round(durationMs),
      thresholdMs: slowQueryThresholdMs,
    });
  }
}

// ── Redis ────────────────────────────────────────────────────────────────────────────────────

export function recordRedisState(up: boolean): void {
  registry().gauge(`${METRIC_PREFIX}_redis_up`, 'Whether the Redis connection is READY (1) or not (0).').set({}, up ? 1 : 0);
}

export function recordRedisEvent(type: 'ready' | 'error' | 'reconnecting' | 'end'): void {
  registry()
    .counter(`${METRIC_PREFIX}_redis_events_total`, 'Redis connection lifecycle events.', ['type'])
    .inc({ type });
}

export function recordRedisPing(latencyMs: number, ok: boolean): void {
  registry()
    .histogram(`${METRIC_PREFIX}_redis_ping_duration_seconds`, 'Redis PING latency in seconds.', ['result'])
    .observe({ result: ok ? 'ok' : 'error' }, toSeconds(latencyMs));
}

// ── Queues / worker ──────────────────────────────────────────────────────────────────────────

const QUEUE_STATES = ['active', 'waiting', 'delayed', 'failed'] as const;

export function recordQueueSnapshot(name: string, counts: Record<string, number | undefined>): void {
  const gauge = registry().gauge(`${METRIC_PREFIX}_queue_jobs`, 'BullMQ job counts by queue and state.', [
    'queue',
    'state',
  ]);
  for (const state of QUEUE_STATES) {
    gauge.set({ queue: name, state }, counts[state] ?? 0);
  }
  const backlog = (counts.active ?? 0) + (counts.waiting ?? 0) + (counts.delayed ?? 0);
  registry()
    .gauge(`${METRIC_PREFIX}_queue_backlog`, 'BullMQ backlog (active + waiting + delayed) by queue.', ['queue'])
    .set({ queue: name }, backlog);
}

export function recordDeadLetterBacklog(backlog: number): void {
  registry()
    .gauge(`${METRIC_PREFIX}_queue_dead_letter_backlog`, 'Jobs awaiting operator attention on the dead-letter queue.')
    .set({}, backlog);
}

export function recordQueueJobCompleted(input: { queue: string; durationMs?: number }): void {
  registry()
    .counter(`${METRIC_PREFIX}_queue_jobs_processed_total`, 'BullMQ jobs by queue and terminal result.', [
      'queue',
      'result',
    ])
    .inc({ queue: input.queue, result: 'completed' });
  if (typeof input.durationMs === 'number') {
    registry()
      .histogram(`${METRIC_PREFIX}_queue_job_duration_seconds`, 'BullMQ job processing time in seconds.', ['queue'])
      .observe({ queue: input.queue }, toSeconds(input.durationMs));
  }
}

export function recordQueueJobFailed(input: { queue: string; terminal: boolean }): void {
  registry()
    .counter(`${METRIC_PREFIX}_queue_jobs_processed_total`, 'BullMQ jobs by queue and terminal result.', [
      'queue',
      'result',
    ])
    .inc({ queue: input.queue, result: input.terminal ? 'failed' : 'retrying' });
}

export function recordDeadLetterMove(sourceQueue: string): void {
  registry()
    .counter(`${METRIC_PREFIX}_queue_dead_letters_total`, 'Jobs moved to the dead-letter queue by source queue.', [
      'queue',
    ])
    .inc({ queue: sourceQueue });
}

export function recordWorkerHeartbeat(workerId: string): void {
  registry()
    .gauge(`${METRIC_PREFIX}_worker_heartbeat_timestamp_seconds`, 'Unix time of the last worker heartbeat.', ['worker'])
    .set({ worker: workerId }, Date.now() / 1000);
  registry()
    .gauge(`${METRIC_PREFIX}_worker_up`, 'Whether a worker replica is heartbeating (1) or considered down (0).', [
      'worker',
    ])
    .set({ worker: workerId }, 1);
}

export function setWorkersOnline(online: number, expected: number): void {
  registry().gauge(`${METRIC_PREFIX}_workers_online`, 'Worker replicas heartbeating in Redis.').set({}, online);
  registry().gauge(`${METRIC_PREFIX}_workers_expected`, 'Worker replicas expected by configuration.').set({}, expected);
}

// ── Payments ─────────────────────────────────────────────────────────────────────────────────

export function recordPaymentEvent(gateway: string, status: string): void {
  registry()
    .counter(`${METRIC_PREFIX}_payments_total`, 'Payment lifecycle events by gateway and status.', ['gateway', 'status'])
    .inc({ gateway, status });
}

export function recordPaymentFailure(gateway: string, stage: string): void {
  registry()
    .counter(`${METRIC_PREFIX}_payment_failures_total`, 'Payment failures by gateway and pipeline stage.', [
      'gateway',
      'stage',
    ])
    .inc({ gateway, stage });
}

// ── Notifications ────────────────────────────────────────────────────────────────────────────

export function recordNotificationAttempt(channel: string, outcome: 'sent' | 'failed'): void {
  registry()
    .counter(`${METRIC_PREFIX}_notifications_total`, 'Notification delivery attempts by channel and outcome.', [
      'channel',
      'outcome',
    ])
    .inc({ channel, outcome });
}

export function recordNotificationFailure(channel: string, provider: string, terminal: boolean): void {
  registry()
    .counter(`${METRIC_PREFIX}_notification_failures_total`, 'Notification delivery failures by channel/provider.', [
      'channel',
      'provider',
      'terminal',
    ])
    .inc({ channel, provider, terminal: terminal ? 'true' : 'false' });
}

// ── Storage ──────────────────────────────────────────────────────────────────────────────────

export function recordStorageOperation(operation: string, ok: boolean, durationMs: number): void {
  registry()
    .counter(`${METRIC_PREFIX}_storage_operations_total`, 'Object storage operations by operation and result.', [
      'operation',
      'result',
    ])
    .inc({ operation, result: ok ? 'ok' : 'error' });
  registry()
    .histogram(`${METRIC_PREFIX}_storage_operation_duration_seconds`, 'Object storage operation latency in seconds.', [
      'operation',
    ])
    .observe({ operation }, toSeconds(durationMs));
}

// ── Backup & recovery ────────────────────────────────────────────────────────────────────────

export function recordBackupEvent(kind: string, outcome: 'success' | 'failure', sizeBytes?: number): void {
  registry()
    .counter(`${METRIC_PREFIX}_backup_operations_total`, 'Backup operations by kind and outcome.', ['kind', 'outcome'])
    .inc({ kind, outcome });
  if (outcome === 'success' && sizeBytes !== undefined) {
    registry()
      .gauge(`${METRIC_PREFIX}_backup_last_size_bytes`, 'Size in bytes of the most recent successful backup, by kind.', [
        'kind',
      ])
      .set({ kind }, sizeBytes);
  }
}

export function recordBackupVerification(kind: string, method: 'toc' | 'restore', ok: boolean): void {
  registry()
    .counter(`${METRIC_PREFIX}_backup_verifications_total`, 'Backup verifications by kind, method and result.', [
      'kind',
      'method',
      'result',
    ])
    .inc({ kind, method, result: ok ? 'ok' : 'failed' });
}

export function setBackupLastSuccess(kind: string, timestampSeconds: number): void {
  registry()
    .gauge(
      `${METRIC_PREFIX}_backup_last_success_timestamp_seconds`,
      'Unix timestamp of the last successful backup, by kind (alert when now - value exceeds the RPO budget).',
      ['kind'],
    )
    .set({ kind }, timestampSeconds);
}

// ── Auth ─────────────────────────────────────────────────────────────────────────────────────

export function recordAuthEvent(surface: 'tenant_login' | 'platform_login' | 'mfa', result: 'success' | 'failure', reason?: string): void {
  registry()
    .counter(`${METRIC_PREFIX}_auth_events_total`, 'Authentication events by surface, result and failure reason.', [
      'surface',
      'result',
      'reason',
    ])
    .inc({ surface, result, reason: reason ?? '' });
}

// ── Tenant usage ─────────────────────────────────────────────────────────────────────────────

export function recordUsageEvent(eventType: string, quantity: number): void {
  registry()
    .counter(`${METRIC_PREFIX}_usage_events_total`, 'Metered usage events recorded, by event type.', ['event_type'])
    .inc({ event_type: eventType });
  registry()
    .counter(`${METRIC_PREFIX}_usage_units_total`, 'Metered usage quantity recorded, by event type.', ['event_type'])
    .inc({ event_type: eventType }, Number.isFinite(quantity) ? quantity : 0);
}

// ── Error tracking & alerts ──────────────────────────────────────────────────────────────────

export function recordErrorTracked(source: string, name: string): void {
  registry()
    .counter(`${METRIC_PREFIX}_errors_tracked_total`, 'Errors captured by the error tracker.', ['source', 'name'])
    .inc({ source, name });
}

export function recordAlertFired(ruleKey: string, severity: string): void {
  registry()
    .counter(`${METRIC_PREFIX}_alerts_fired_total`, 'Alerts dispatched by the alert engine.', ['rule', 'severity'])
    .inc({ rule: ruleKey, severity });
}

export function setActiveAlerts(severity: string, count: number): void {
  registry().gauge(`${METRIC_PREFIX}_alerts_active`, 'Currently firing alerts by severity.').set({ severity }, count);
}

// ── Health ───────────────────────────────────────────────────────────────────────────────────

export function recordHealthCheck(name: string, ok: boolean, latencyMs: number): void {
  registry().gauge(`${METRIC_PREFIX}_health_status`, 'Health check result per component (1=up, 0=down).', ['check']).set({ check: name }, ok ? 1 : 0);
  registry()
    .histogram(`${METRIC_PREFIX}_health_check_duration_seconds`, 'Health check probe latency in seconds.', ['check'])
    .observe({ check: name }, toSeconds(latencyMs));
}

// ── Runtime ──────────────────────────────────────────────────────────────────────────────────

export function recordRuntimeMetrics(sample: {
  residentMemoryBytes: number;
  heapUsedBytes: number;
  uptimeSeconds: number;
  eventLoopLagSeconds?: number;
}): void {
  registry().gauge(`${METRIC_PREFIX}_process_resident_memory_bytes`, 'Process resident set size in bytes.').set({}, sample.residentMemoryBytes);
  registry().gauge(`${METRIC_PREFIX}_process_heap_used_bytes`, 'V8 heap used in bytes.').set({}, sample.heapUsedBytes);
  registry().gauge(`${METRIC_PREFIX}_process_uptime_seconds`, 'Process uptime in seconds.').set({}, sample.uptimeSeconds);
  if (typeof sample.eventLoopLagSeconds === 'number') {
    registry()
      .gauge(`${METRIC_PREFIX}_event_loop_lag_seconds`, 'Event loop lag sampled by drift of a short timer.')
      .set({}, sample.eventLoopLagSeconds);
  }
}

export function setBuildInfo(info: { service: string; version: string; environment: string }): void {
  registry().gauge(`${METRIC_PREFIX}_build_info`, 'Build/runtime identity of the process (always 1).', [
    'service',
    'version',
    'environment',
  ]).set({ service: info.service, version: info.version, environment: info.environment }, 1);
}

/**
 * Samples memory/uptime/event-loop-lag on an interval. The timer is unref'd so it never keeps a
 * process alive, and each sample is cheap (one drift timer + process.memoryUsage()).
 */
export function startRuntimeMetricsCollector(intervalMs = 15_000): () => void {
  let stopped = false;

  const sample = async (): Promise<void> => {
    const lagSeconds = await measureEventLoopLag();
    if (stopped) return;
    const memory = process.memoryUsage();
    recordRuntimeMetrics({
      residentMemoryBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      uptimeSeconds: process.uptime(),
      eventLoopLagSeconds: lagSeconds,
    });
  };

  const timer = setInterval(() => {
    void sample().catch(() => undefined);
  }, intervalMs);
  timer.unref();
  void sample().catch(() => undefined);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

function measureEventLoopLag(): Promise<number> {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    setTimeout(() => {
      resolve(Number(process.hrtime.bigint() - started) / 1e9);
    }, 0).unref();
  });
}
