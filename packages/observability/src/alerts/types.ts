/**
 * Alerting model.
 *
 * Rules are pure functions over a snapshot of already-collected signals (health probes, Redis
 * window counters, queue gauges). The API's AlertingService gathers the snapshot on an interval,
 * evaluates every rule, dedupes dispatches through Redis, persists SystemAlert rows and fans out
 * to the configured webhook. Keeping evaluation pure makes every threshold unit-testable without
 * infrastructure.
 */

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL';

export interface AlertSignalSnapshot {
  /** Health probes (false = dependency down / worker offline). */
  databaseUp: boolean;
  redisUp: boolean;
  storageUp: boolean;
  databaseLatencyMs: number;
  redisLatencyMs: number;
  /** Worker heartbeat fleet: online now vs expected replicas (0 expected = alert disabled). */
  workersOnline: number;
  workersExpected: number;
  /** Queue gauges, from QueueMonitor. */
  maxQueueBacklog: number;
  maxQueueBacklogQueue?: string;
  deadLetterBacklog: number;
  /** Redis time-window counters (see WINDOW_COUNTERS). */
  httpRequests15m: number;
  http5xx15m: number;
  authFailures15m: number;
  suspiciousLogins15m: number;
  queueFailures15m: number;
  deadLetterMoves15m: number;
  paymentFailures60m: number;
  notificationFailures60m: number;
  storageFailures60m: number;
  trackedErrors15m: number;
  /** Backup posture: whether backups are expected at all, when PostgreSQL last backed up
   *  (epoch seconds, null = never/unknown), and the RPO budget the rule compares against. */
  backupExpected: boolean;
  lastPostgresBackupAt: number | null;
  backupMaxAgeHours: number;
}

export interface AlertEvaluation {
  ruleKey: string;
  severity: AlertSeverity;
  title: string;
  description: string;
  /** Scopes dedupe/persistence: e.g. the dependency name or queue name that violated the rule. */
  dedupeKey: string;
  metricValue: number;
  threshold: number;
  details?: Record<string, unknown>;
}

export interface AlertRule {
  key: string;
  severity: AlertSeverity;
  title: string;
  /** Returns an evaluation when the rule fires, null when healthy. */
  evaluate(snapshot: AlertSignalSnapshot): AlertEvaluation | null;
}

export interface ActiveAlertState {
  ruleKey: string;
  dedupeKey: string;
  severity: AlertSeverity;
  metricValue: number | null;
  firing: boolean;
}

/** Thresholds — single source of truth, mirrored in docs/observability.md. */
export const ALERT_THRESHOLDS = {
  /** 5xx ratio (%) over the 15-minute window, with a minimum request volume. */
  apiErrorRatePercentWarning: 2,
  apiErrorRatePercentCritical: 5,
  apiErrorRateMinRequests: 50,
  /** db/redis latency (ms) that counts as degraded even while the probe succeeds. */
  databaseLatencyWarningMs: 1_000,
  redisLatencyWarningMs: 250,
  /** Queue backlog (mirrors packages/queue BACKLOG_WARNING_THRESHOLD). */
  queueBacklogWarning: 1_000,
  /** Window event counts. */
  queueFailuresWarning15m: 20,
  deadLetterMovesWarning15m: 1,
  deadLetterBacklogWarning: 1,
  paymentFailuresWarning60m: 5,
  notificationFailuresWarning60m: 20,
  storageFailuresWarning60m: 5,
  authFailuresWarning15m: 30,
  suspiciousLoginsWarning15m: 3,
  trackedErrorsWarning15m: 10,
} as const;
