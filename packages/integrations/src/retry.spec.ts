import {
  classifyIntegrationFailure,
  computeBackoffDelayMs,
  DEFAULT_RETRY_POLICY,
  INTEGRATION_FAILURE_CATEGORIES,
  resolveRetryPolicy,
  shouldRetry,
} from './retry';

describe('classifyIntegrationFailure', () => {
  it('treats 401/403 as permanent AUTHENTICATION failures so bad credentials are not retried', () => {
    for (const status of [401, 403]) {
      const failure = classifyIntegrationFailure({ status, message: 'bad key' });
      expect(failure.category).toBe('AUTHENTICATION');
      expect(failure.retryable).toBe(false);
      expect(failure.providerCode).toBe(String(status));
    }
  });

  it('treats 400/404/409/422 as permanent PROVIDER_REJECTED failures', () => {
    for (const status of [400, 404, 409, 422]) {
      const failure = classifyIntegrationFailure({ status, message: 'nope' });
      expect(failure.category).toBe('PROVIDER_REJECTED');
      expect(failure.retryable).toBe(false);
    }
  });

  it('treats 429 as a transient RATE_LIMIT and surfaces Retry-After', () => {
    const failure = classifyIntegrationFailure({ status: 429, retryAfterMs: 30_000 });
    expect(failure.category).toBe('RATE_LIMIT');
    expect(failure.retryable).toBe(true);
    expect(failure.message).toContain('30s');
  });

  it('treats 408/425 as transient TIMEOUT', () => {
    for (const status of [408, 425]) {
      const failure = classifyIntegrationFailure({ status });
      expect(failure.category).toBe('TIMEOUT');
      expect(failure.retryable).toBe(true);
    }
  });

  it('treats every 5xx as transient, since the fault is the provider\'s', () => {
    for (const status of [500, 502, 503, 504]) {
      const failure = classifyIntegrationFailure({ status });
      expect(failure.retryable).toBe(true);
    }
  });

  it('treats a 2xx with an unusable body as a permanent SCHEMA mismatch, not a transient error', () => {
    const failure = classifyIntegrationFailure({ status: 200, message: 'unexpected shape' });
    expect(failure.category).toBe('SCHEMA');
    expect(failure.retryable).toBe(false);
  });

  it('classifies DNS/socket failures as transient NETWORK via the cause chain', () => {
    const error = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    const failure = classifyIntegrationFailure({ error });
    expect(failure.category).toBe('NETWORK');
    expect(failure.retryable).toBe(true);
  });

  it('classifies timeouts and aborts as transient TIMEOUT', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    const failure = classifyIntegrationFailure({ error });
    expect(failure.category).toBe('TIMEOUT');
    expect(failure.retryable).toBe(true);
  });

  it('falls back to a permanent UNKNOWN classification', () => {
    const failure = classifyIntegrationFailure({ error: new Error('boom') });
    expect(failure.category).toBe('UNKNOWN');
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain('boom');
  });

  it('handles a missing error entirely without throwing', () => {
    const failure = classifyIntegrationFailure({});
    expect(failure.category).toBe('UNKNOWN');
    expect(failure.message).toBeTruthy();
  });

  it('only uses failure categories the Prisma enum declares', () => {
    const allowed = new Set<string>(INTEGRATION_FAILURE_CATEGORIES);
    for (const status of [200, 401, 402, 429, 451, 500, 503]) {
      expect(allowed.has(classifyIntegrationFailure({ status }).category)).toBe(true);
    }
    expect(allowed.has(classifyIntegrationFailure({}).category)).toBe(true);
  });
});

describe('resolveRetryPolicy', () => {
  it('returns the documented defaults when there is no override', () => {
    expect(resolveRetryPolicy(null)).toEqual(DEFAULT_RETRY_POLICY);
    expect(resolveRetryPolicy(undefined)).toEqual(DEFAULT_RETRY_POLICY);
  });

  it('applies overrides onto the defaults', () => {
    const policy = resolveRetryPolicy({ maxAttempts: 2, timeoutMs: 5_000 });
    expect(policy.maxAttempts).toBe(2);
    expect(policy.timeoutMs).toBe(5_000);
    expect(policy.baseDelayMs).toBe(DEFAULT_RETRY_POLICY.baseDelayMs);
  });

  it('clamps a tenant-supplied maxAttempts so a bad config cannot create an infinite loop', () => {
    expect(resolveRetryPolicy({ maxAttempts: 9_999 }).maxAttempts).toBe(10);
    expect(resolveRetryPolicy({ maxAttempts: 0 }).maxAttempts).toBe(1);
    expect(resolveRetryPolicy({ maxAttempts: -3 }).maxAttempts).toBe(1);
  });

  it('clamps delay and timeout to sane bounds', () => {
    expect(resolveRetryPolicy({ baseDelayMs: 1 }).baseDelayMs).toBe(100);
    expect(resolveRetryPolicy({ timeoutMs: 99_999_999 }).timeoutMs).toBe(120_000);
    expect(resolveRetryPolicy({ jitterRatio: 5 }).jitterRatio).toBe(1);
    expect(resolveRetryPolicy({ jitterRatio: -1 }).jitterRatio).toBe(0);
  });

  it('ignores non-numeric junk from the JSON column', () => {
    const policy = resolveRetryPolicy({ maxAttempts: 'lots' as never, timeoutMs: NaN });
    expect(policy.maxAttempts).toBe(DEFAULT_RETRY_POLICY.maxAttempts);
    expect(policy.timeoutMs).toBe(DEFAULT_RETRY_POLICY.timeoutMs);
  });
});

describe('computeBackoffDelayMs', () => {
  it('grows exponentially with the attempt number', () => {
    const policy = resolveRetryPolicy({ baseDelayMs: 1_000, maxDelayMs: 60_000, jitterRatio: 0 });
    expect(computeBackoffDelayMs(policy, 1)).toBe(1_000);
    expect(computeBackoffDelayMs(policy, 2)).toBe(2_000);
    expect(computeBackoffDelayMs(policy, 3)).toBe(4_000);
    expect(computeBackoffDelayMs(policy, 4)).toBe(8_000);
  });

  it('never exceeds maxDelayMs however many attempts have failed', () => {
    const policy = resolveRetryPolicy({ baseDelayMs: 1_000, maxDelayMs: 5_000, jitterRatio: 0 });
    expect(computeBackoffDelayMs(policy, 20)).toBe(5_000);
  });

  it('applies symmetric jitter around the delay to avoid a thundering herd', () => {
    const policy = resolveRetryPolicy({ baseDelayMs: 10_000, jitterRatio: 0.5 });
    expect(computeBackoffDelayMs(policy, 1, () => 0)).toBe(5_000);
    expect(computeBackoffDelayMs(policy, 1, () => 1)).toBe(15_000);
    expect(computeBackoffDelayMs(policy, 1, () => 0.5)).toBe(10_000);
  });

  it('is deterministic for a fixed random source', () => {
    const policy = resolveRetryPolicy({ baseDelayMs: 1_000 });
    const fixed = () => 0.3;
    expect(computeBackoffDelayMs(policy, 3, fixed)).toBe(computeBackoffDelayMs(policy, 3, fixed));
  });

  it('treats attempt numbers below 1 as the first attempt', () => {
    const policy = resolveRetryPolicy({ baseDelayMs: 1_000, jitterRatio: 0 });
    expect(computeBackoffDelayMs(policy, 0)).toBe(1_000);
    expect(computeBackoffDelayMs(policy, -5)).toBe(1_000);
  });
});

describe('shouldRetry', () => {
  it('retries a transient failure while attempts remain', () => {
    const policy = resolveRetryPolicy({ maxAttempts: 3 });
    expect(shouldRetry({ retryable: true }, policy, 1)).toBe(true);
    expect(shouldRetry({ retryable: true }, policy, 2)).toBe(true);
  });

  it('stops once the attempt budget is spent', () => {
    expect(shouldRetry({ retryable: true }, resolveRetryPolicy({ maxAttempts: 3 }), 3)).toBe(false);
  });

  it('never retries a permanent failure even with attempts left', () => {
    expect(shouldRetry({ retryable: false }, resolveRetryPolicy({ maxAttempts: 5 }), 1)).toBe(false);
  });
});
