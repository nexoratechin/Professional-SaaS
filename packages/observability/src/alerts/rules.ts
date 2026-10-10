import { ALERT_THRESHOLDS, type AlertEvaluation, type AlertRule, type AlertSignalSnapshot } from './types';

/**
 * The default rule set evaluated every ALERT_EVAL_INTERVAL_MS. Order matters only for output
 * readability; each rule is independent. `dedupeKey` partitions alerts so (for example) two
 * different queues backing up produce two distinct alerts.
 */
export const ALERT_RULES: readonly AlertRule[] = [
  {
    key: 'dependency_database_down',
    severity: 'CRITICAL',
    title: 'Database is unreachable',
    evaluate: (s) =>
      s.databaseUp
        ? null
        : firing('dependency_database_down', 'CRITICAL', 'Database is unreachable', {
            dedupeKey: 'database',
            metricValue: 0,
            threshold: 1,
            description: 'The PostgreSQL readiness probe is failing. All tenant operations are affected.',
          }),
  },
  {
    key: 'dependency_redis_down',
    severity: 'CRITICAL',
    title: 'Redis is unreachable',
    evaluate: (s) =>
      s.redisUp
        ? null
        : firing('dependency_redis_down', 'CRITICAL', 'Redis is unreachable', {
            dedupeKey: 'redis',
            metricValue: 0,
            threshold: 1,
            description: 'Redis PING is failing. Caching, throttling, idempotency and background queues are affected.',
          }),
  },
  {
    key: 'dependency_storage_down',
    severity: 'WARNING',
    title: 'Object storage is unreachable',
    evaluate: (s) =>
      s.storageUp
        ? null
        : firing('dependency_storage_down', 'WARNING', 'Object storage is unreachable', {
            dedupeKey: 'storage',
            metricValue: 0,
            threshold: 1,
            description: 'The S3/MinIO HeadBucket probe is failing. Uploads and exports will fail.',
          }),
  },
  {
    key: 'dependency_latency_high',
    severity: 'WARNING',
    title: 'Dependency latency above threshold',
    evaluate: (s) => {
      if (s.databaseUp && s.databaseLatencyMs >= ALERT_THRESHOLDS.databaseLatencyWarningMs) {
        return firing('dependency_latency_high', 'WARNING', 'Database latency above threshold', {
          dedupeKey: 'database',
          metricValue: Math.round(s.databaseLatencyMs),
          threshold: ALERT_THRESHOLDS.databaseLatencyWarningMs,
          description: `Database readiness probe took ${Math.round(s.databaseLatencyMs)}ms (threshold ${ALERT_THRESHOLDS.databaseLatencyWarningMs}ms).`,
        });
      }
      if (s.redisUp && s.redisLatencyMs >= ALERT_THRESHOLDS.redisLatencyWarningMs) {
        return firing('dependency_latency_high', 'WARNING', 'Redis latency above threshold', {
          dedupeKey: 'redis',
          metricValue: Math.round(s.redisLatencyMs),
          threshold: ALERT_THRESHOLDS.redisLatencyWarningMs,
          description: `Redis PING took ${Math.round(s.redisLatencyMs)}ms (threshold ${ALERT_THRESHOLDS.redisLatencyWarningMs}ms).`,
        });
      }
      return null;
    },
  },
  {
    key: 'worker_offline',
    severity: 'CRITICAL',
    title: 'No worker replicas are heartbeating',
    evaluate: (s) => {
      if (s.workersExpected <= 0) return null;
      if (s.workersOnline === 0) {
        return firing('worker_offline', 'CRITICAL', 'No worker replicas are heartbeating', {
          dedupeKey: 'fleet',
          metricValue: 0,
          threshold: s.workersExpected,
          description: 'Background jobs (notifications, payments, reports, scans) are not being processed.',
          details: { workersExpected: s.workersExpected },
        });
      }
      if (s.workersOnline < s.workersExpected) {
        return firing('worker_offline', 'WARNING', 'Worker fleet degraded', {
          dedupeKey: 'fleet',
          metricValue: s.workersOnline,
          threshold: s.workersExpected,
          description: `Only ${s.workersOnline}/${s.workersExpected} worker replicas are heartbeating.`,
          details: { workersExpected: s.workersExpected },
        });
      }
      return null;
    },
  },
  {
    key: 'api_error_rate_high',
    severity: 'CRITICAL',
    title: '5xx error rate is elevated',
    evaluate: (s) => {
      if (s.httpRequests15m < ALERT_THRESHOLDS.apiErrorRateMinRequests || s.http5xx15m <= 0) return null;
      const rate = (s.http5xx15m / s.httpRequests15m) * 100;
      if (rate >= ALERT_THRESHOLDS.apiErrorRatePercentCritical) {
        return firing('api_error_rate_high', 'CRITICAL', '5xx error rate is elevated', {
          dedupeKey: 'api',
          metricValue: round2(rate),
          threshold: ALERT_THRESHOLDS.apiErrorRatePercentCritical,
          description: `${s.http5xx15m}/${s.httpRequests15m} requests returned 5xx in the last 15 minutes (${round2(rate)}%).`,
        });
      }
      if (rate >= ALERT_THRESHOLDS.apiErrorRatePercentWarning) {
        return firing('api_error_rate_high', 'WARNING', '5xx error rate is above warning threshold', {
          dedupeKey: 'api',
          metricValue: round2(rate),
          threshold: ALERT_THRESHOLDS.apiErrorRatePercentWarning,
          description: `${s.http5xx15m}/${s.httpRequests15m} requests returned 5xx in the last 15 minutes (${round2(rate)}%).`,
        });
      }
      return null;
    },
  },
  {
    key: 'queue_backlog_high',
    severity: 'WARNING',
    title: 'Queue backlog is high',
    evaluate: (s) =>
      s.maxQueueBacklog >= ALERT_THRESHOLDS.queueBacklogWarning
        ? firing('queue_backlog_high', 'WARNING', 'Queue backlog is high', {
            dedupeKey: s.maxQueueBacklogQueue ?? 'unknown',
            metricValue: s.maxQueueBacklog,
            threshold: ALERT_THRESHOLDS.queueBacklogWarning,
            description: `Queue "${s.maxQueueBacklogQueue ?? 'unknown'}" has a backlog of ${s.maxQueueBacklog} jobs.`,
            details: { queue: s.maxQueueBacklogQueue ?? null },
          })
        : null,
  },
  {
    key: 'queue_failures_spike',
    severity: 'WARNING',
    title: 'Queue job failures above threshold',
    evaluate: (s) =>
      s.queueFailures15m >= ALERT_THRESHOLDS.queueFailuresWarning15m
        ? firing('queue_failures_spike', 'WARNING', 'Queue job failures above threshold', {
            dedupeKey: 'queues',
            metricValue: s.queueFailures15m,
            threshold: ALERT_THRESHOLDS.queueFailuresWarning15m,
            description: `${s.queueFailures15m} job failures in the last 15 minutes (threshold ${ALERT_THRESHOLDS.queueFailuresWarning15m}).`,
          })
        : null,
  },
  {
    key: 'dead_letter_backlog',
    severity: 'WARNING',
    title: 'Jobs are landing in the dead-letter queue',
    evaluate: (s) => {
      if (s.deadLetterBacklog >= ALERT_THRESHOLDS.deadLetterBacklogWarning) {
        return firing('dead_letter_backlog', 'WARNING', 'Dead-letter queue is not empty', {
          dedupeKey: 'dlq',
          metricValue: s.deadLetterBacklog,
          threshold: ALERT_THRESHOLDS.deadLetterBacklogWarning,
          description: `${s.deadLetterBacklog} job(s) await operator attention on the dead-letter queue.`,
        });
      }
      if (s.deadLetterMoves15m >= ALERT_THRESHOLDS.deadLetterMovesWarning15m) {
        return firing('dead_letter_backlog', 'WARNING', 'Jobs moved to the dead-letter queue', {
          dedupeKey: 'dlq-moves',
          metricValue: s.deadLetterMoves15m,
          threshold: ALERT_THRESHOLDS.deadLetterMovesWarning15m,
          description: `${s.deadLetterMoves15m} job(s) exhausted retries in the last 15 minutes.`,
        });
      }
      return null;
    },
  },
  {
    key: 'payment_failures_spike',
    severity: 'WARNING',
    title: 'Payment failures above threshold',
    evaluate: (s) =>
      s.paymentFailures60m >= ALERT_THRESHOLDS.paymentFailuresWarning60m
        ? firing('payment_failures_spike', 'WARNING', 'Payment failures above threshold', {
            dedupeKey: 'payments',
            metricValue: s.paymentFailures60m,
            threshold: ALERT_THRESHOLDS.paymentFailuresWarning60m,
            description: `${s.paymentFailures60m} payment failure(s) in the last 60 minutes.`,
          })
        : null,
  },
  {
    key: 'notification_failures_spike',
    severity: 'WARNING',
    title: 'Notification delivery failures above threshold',
    evaluate: (s) =>
      s.notificationFailures60m >= ALERT_THRESHOLDS.notificationFailuresWarning60m
        ? firing('notification_failures_spike', 'WARNING', 'Notification delivery failures above threshold', {
            dedupeKey: 'notifications',
            metricValue: s.notificationFailures60m,
            threshold: ALERT_THRESHOLDS.notificationFailuresWarning60m,
            description: `${s.notificationFailures60m} notification delivery failure(s) in the last 60 minutes.`,
          })
        : null,
  },
  {
    key: 'storage_failures_spike',
    severity: 'WARNING',
    title: 'Storage operation failures above threshold',
    evaluate: (s) =>
      s.storageFailures60m >= ALERT_THRESHOLDS.storageFailuresWarning60m
        ? firing('storage_failures_spike', 'WARNING', 'Storage operation failures above threshold', {
            dedupeKey: 'storage',
            metricValue: s.storageFailures60m,
            threshold: ALERT_THRESHOLDS.storageFailuresWarning60m,
            description: `${s.storageFailures60m} storage operation failure(s) in the last 60 minutes.`,
          })
        : null,
  },
  {
    key: 'auth_failures_spike',
    severity: 'WARNING',
    title: 'Authentication failures above threshold',
    evaluate: (s) =>
      s.authFailures15m >= ALERT_THRESHOLDS.authFailuresWarning15m
        ? firing('auth_failures_spike', 'WARNING', 'Authentication failures above threshold', {
            dedupeKey: 'auth',
            metricValue: s.authFailures15m,
            threshold: ALERT_THRESHOLDS.authFailuresWarning15m,
            description: `${s.authFailures15m} failed login attempts in the last 15 minutes — possible credential stuffing.`,
          })
        : null,
  },
  {
    key: 'suspicious_logins',
    severity: 'WARNING',
    title: 'Suspicious logins blocked',
    evaluate: (s) =>
      s.suspiciousLogins15m >= ALERT_THRESHOLDS.suspiciousLoginsWarning15m
        ? firing('suspicious_logins', 'WARNING', 'Suspicious logins blocked', {
            dedupeKey: 'security',
            metricValue: s.suspiciousLogins15m,
            threshold: ALERT_THRESHOLDS.suspiciousLoginsWarning15m,
            description: `${s.suspiciousLogins15m} logins were blocked as suspicious in the last 15 minutes.`,
          })
        : null,
  },
  {
    key: 'tracked_errors_spike',
    severity: 'WARNING',
    title: 'Unhandled errors above threshold',
    evaluate: (s) =>
      s.trackedErrors15m >= ALERT_THRESHOLDS.trackedErrorsWarning15m
        ? firing('tracked_errors_spike', 'WARNING', 'Unhandled errors above threshold', {
            dedupeKey: 'errors',
            metricValue: s.trackedErrors15m,
            threshold: ALERT_THRESHOLDS.trackedErrorsWarning15m,
            description: `${s.trackedErrors15m} tracked error(s) in the last 15 minutes.`,
          })
        : null,
  },
  {
    key: 'backup_stale',
    severity: 'WARNING',
    title: 'PostgreSQL backups are not current',
    evaluate: (s) => {
      if (!s.backupExpected) return null;
      if (s.lastPostgresBackupAt === null) {
        return firing('backup_stale', 'CRITICAL', 'No successful PostgreSQL backup recorded', {
          dedupeKey: 'postgres',
          metricValue: 0,
          threshold: s.backupMaxAgeHours,
          description:
            'Backups are expected in this environment but no successful backup has been recorded. ' +
            'Check the worker backup queue and the dead-letter queue — the RPO is unprotected.',
        });
      }
      const ageHours = Math.max(0, (Date.now() / 1000 - s.lastPostgresBackupAt) / 3600);
      // One missed schedule is a warning; two full windows is a critical RPO breach.
      if (ageHours >= s.backupMaxAgeHours * 2) {
        return firing('backup_stale', 'CRITICAL', 'PostgreSQL backups are far behind schedule', {
          dedupeKey: 'postgres',
          metricValue: round2(ageHours),
          threshold: s.backupMaxAgeHours,
          description: `The last successful backup is ${round2(ageHours)}h old (RPO budget ${s.backupMaxAgeHours}h). Restore protection is compromised.`,
        });
      }
      if (ageHours >= s.backupMaxAgeHours) {
        return firing('backup_stale', 'WARNING', 'PostgreSQL backups are behind schedule', {
          dedupeKey: 'postgres',
          metricValue: round2(ageHours),
          threshold: s.backupMaxAgeHours,
          description: `The last successful backup is ${round2(ageHours)}h old (RPO budget ${s.backupMaxAgeHours}h).`,
        });
      }
      return null;
    },
  },
];

/** Evaluates every rule, returning one evaluation per firing rule (a rule fires at most once). */
export function evaluateAlertRules(snapshot: AlertSignalSnapshot, rules: readonly AlertRule[] = ALERT_RULES): AlertEvaluation[] {
  const evaluations: AlertEvaluation[] = [];
  for (const rule of rules) {
    try {
      const evaluation = rule.evaluate(snapshot);
      if (evaluation) evaluations.push(evaluation);
    } catch {
      // A misbehaving rule must never stop the rest of the set.
    }
  }
  return evaluations;
}

interface FiringInput {
  dedupeKey: string;
  metricValue: number;
  threshold: number;
  description: string;
  details?: Record<string, unknown>;
}

function firing(ruleKey: string, severity: AlertEvaluation['severity'], title: string, input: FiringInput): AlertEvaluation {
  return {
    ruleKey,
    severity,
    title,
    description: input.description,
    dedupeKey: input.dedupeKey,
    metricValue: input.metricValue,
    threshold: input.threshold,
    ...(input.details ? { details: input.details } : {}),
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
