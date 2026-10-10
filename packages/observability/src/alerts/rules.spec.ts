import { evaluateAlertRules } from './rules';
import { ALERT_THRESHOLDS, type AlertSignalSnapshot } from './types';

function healthySnapshot(): AlertSignalSnapshot {
  return {
    databaseUp: true,
    redisUp: true,
    storageUp: true,
    databaseLatencyMs: 5,
    redisLatencyMs: 2,
    workersOnline: 1,
    workersExpected: 1,
    maxQueueBacklog: 0,
    maxQueueBacklogQueue: 'emails',
    deadLetterBacklog: 0,
    httpRequests15m: 1_000,
    http5xx15m: 0,
    authFailures15m: 0,
    suspiciousLogins15m: 0,
    queueFailures15m: 0,
    deadLetterMoves15m: 0,
    paymentFailures60m: 0,
    notificationFailures60m: 0,
    storageFailures60m: 0,
    trackedErrors15m: 0,
    backupExpected: false,
    lastPostgresBackupAt: null,
    backupMaxAgeHours: 26,
  };
}

function keysFor(overrides: Partial<AlertSignalSnapshot>): string[] {
  return evaluateAlertRules({ ...healthySnapshot(), ...overrides }).map((alert) => alert.ruleKey);
}

describe('alert rules', () => {
  it('fires nothing on a healthy system', () => {
    expect(evaluateAlertRules(healthySnapshot())).toEqual([]);
  });

  it('fires critical alerts when the database or redis is down', () => {
    expect(keysFor({ databaseUp: false })).toContain('dependency_database_down');
    expect(keysFor({ redisUp: false })).toContain('dependency_redis_down');
  });

  it('fires a warning when storage is down', () => {
    const alerts = evaluateAlertRules({ ...healthySnapshot(), storageUp: false });
    expect(alerts.find((alert) => alert.ruleKey === 'dependency_storage_down')?.severity).toBe('WARNING');
  });

  it('detects elevated 5xx rates only with enough traffic', () => {
    // 1/5 = 20% but below the minimum request volume → no alert.
    expect(keysFor({ httpRequests15m: 5, http5xx15m: 1 })).not.toContain('api_error_rate_high');
    // 3% with enough traffic → warning.
    const warning = evaluateAlertRules({ ...healthySnapshot(), http5xx15m: 30 });
    expect(warning.find((a) => a.ruleKey === 'api_error_rate_high')?.severity).toBe('WARNING');
    // 6% → critical.
    const critical = evaluateAlertRules({ ...healthySnapshot(), http5xx15m: 60 });
    expect(critical.find((a) => a.ruleKey === 'api_error_rate_high')?.severity).toBe('CRITICAL');
  });

  it('fires when workers are offline but not when alerting is disabled', () => {
    const alerts = evaluateAlertRules({ ...healthySnapshot(), workersOnline: 0 });
    expect(alerts.find((a) => a.ruleKey === 'worker_offline')?.severity).toBe('CRITICAL');

    const disabled = evaluateAlertRules({ ...healthySnapshot(), workersOnline: 0, workersExpected: 0 });
    expect(disabled.find((a) => a.ruleKey === 'worker_offline')).toBeUndefined();
  });

  it('warns when the worker fleet is partially degraded', () => {
    const alerts = evaluateAlertRules({ ...healthySnapshot(), workersOnline: 1, workersExpected: 3 });
    expect(alerts.find((a) => a.ruleKey === 'worker_offline')?.severity).toBe('WARNING');
  });

  it('includes the offending queue in backlog alerts', () => {
    const alerts = evaluateAlertRules({
      ...healthySnapshot(),
      maxQueueBacklog: ALERT_THRESHOLDS.queueBacklogWarning,
      maxQueueBacklogQueue: 'pdf-generation',
    });
    const backlog = alerts.find((a) => a.ruleKey === 'queue_backlog_high');
    expect(backlog?.dedupeKey).toBe('pdf-generation');
    expect(backlog?.metricValue).toBe(ALERT_THRESHOLDS.queueBacklogWarning);
  });

  it('fires failure-spike alerts for queue, payments, notifications, storage and auth', () => {
    expect(keysFor({ queueFailures15m: ALERT_THRESHOLDS.queueFailuresWarning15m })).toContain('queue_failures_spike');
    expect(keysFor({ paymentFailures60m: ALERT_THRESHOLDS.paymentFailuresWarning60m })).toContain('payment_failures_spike');
    expect(keysFor({ notificationFailures60m: ALERT_THRESHOLDS.notificationFailuresWarning60m })).toContain('notification_failures_spike');
    expect(keysFor({ storageFailures60m: ALERT_THRESHOLDS.storageFailuresWarning60m })).toContain('storage_failures_spike');
    expect(keysFor({ authFailures15m: ALERT_THRESHOLDS.authFailuresWarning15m })).toContain('auth_failures_spike');
    expect(keysFor({ suspiciousLogins15m: ALERT_THRESHOLDS.suspiciousLoginsWarning15m })).toContain('suspicious_logins');
    expect(keysFor({ trackedErrors15m: ALERT_THRESHOLDS.trackedErrorsWarning15m })).toContain('tracked_errors_spike');
  });

  it('flags a non-empty dead-letter queue', () => {
    expect(keysFor({ deadLetterBacklog: 1 })).toContain('dead_letter_backlog');
    expect(keysFor({ deadLetterMoves15m: 1 })).toContain('dead_letter_backlog');
  });

  it('flags elevated dependency latency', () => {
    expect(keysFor({ databaseLatencyMs: ALERT_THRESHOLDS.databaseLatencyWarningMs })).toContain('dependency_latency_high');
    expect(keysFor({ redisLatencyMs: ALERT_THRESHOLDS.redisLatencyWarningMs })).toContain('dependency_latency_high');
  });

  it('produces one evaluation per firing rule and isolates rule crashes', () => {
    const crashingRule = {
      key: 'explodes',
      severity: 'INFO' as const,
      title: 'x',
      evaluate: () => {
        throw new Error('rule bug');
      },
    };
    expect(evaluateAlertRules(healthySnapshot(), [crashingRule])).toEqual([]);
    const firing = evaluateAlertRules(healthySnapshot(), [
      { ...crashingRule, key: 'boom' },
      {
        key: 'always',
        severity: 'INFO' as const,
        title: 'always fires',
        evaluate: () => ({
          ruleKey: 'always',
          severity: 'INFO' as const,
          title: 't',
          description: 'd',
          dedupeKey: 'k',
          metricValue: 1,
          threshold: 0,
        }),
      },
    ]);
    expect(firing.map((alert) => alert.ruleKey)).toEqual(['always']);
  });

  describe('backup_stale', () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fresh = nowSeconds - 3600;

    it('does not fire when backups are not expected in this environment', () => {
      expect(keysFor({ backupExpected: false, lastPostgresBackupAt: null })).not.toContain('backup_stale');
    });

    it('does not fire when the last backup is within the RPO budget', () => {
      expect(keysFor({ backupExpected: true, lastPostgresBackupAt: fresh })).not.toContain('backup_stale');
    });

    it('fires a warning after one missed window and a critical after two', () => {
      const warning = evaluateAlertRules({
        ...healthySnapshot(),
        backupExpected: true,
        lastPostgresBackupAt: nowSeconds - 26 * 3600 - 120,
      });
      expect(warning.find((alert) => alert.ruleKey === 'backup_stale')?.severity).toBe('WARNING');

      const critical = evaluateAlertRules({
        ...healthySnapshot(),
        backupExpected: true,
        lastPostgresBackupAt: nowSeconds - 53 * 3600,
      });
      expect(critical.find((alert) => alert.ruleKey === 'backup_stale')?.severity).toBe('CRITICAL');
    });

    it('fires critical when backups are expected but none were ever recorded', () => {
      const alerts = evaluateAlertRules({ ...healthySnapshot(), backupExpected: true, lastPostgresBackupAt: null });
      const backup = alerts.find((alert) => alert.ruleKey === 'backup_stale');
      expect(backup?.severity).toBe('CRITICAL');
      expect(backup?.description).toMatch(/no successful backup/i);
    });
  });
});
