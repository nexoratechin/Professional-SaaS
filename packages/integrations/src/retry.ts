/**
 * Retry policy and transient/permanent failure classification.
 *
 * ## Why retry decisions live here and not in the adapter
 *
 * Whether a failure is worth retrying is a property of the *response*, not of the vendor: a 503 from
 * any gateway is transient, a 400 from any gateway is a bug in our request. Centralising the
 * classification means a new adapter inherits correct retry behaviour for free, and — more
 * importantly — means the API and the worker cannot disagree about whether to retry.
 *
 * ## Why this exists at all when BullMQ already retries
 *
 * BullMQ's `attempts` will happily re-send a request that failed because the API key is wrong, three
 * times, and then report a failure indistinguishable from a network blip. `classifyIntegrationFailure`
 * turns the failure into an explicit `retryable` boolean plus a category, so terminal failures stop
 * immediately and the operator gets "your credentials expired" instead of "it retried and failed".
 */

/** Mirrors the Prisma enum over the wire so the API/worker can classify without importing it. */
export const INTEGRATION_FAILURE_CATEGORIES = [
  'AUTHENTICATION',
  'CONFIGURATION',
  'NETWORK',
  'TIMEOUT',
  'RATE_LIMIT',
  'PROVIDER_REJECTED',
  'SIGNATURE',
  'SCHEMA',
  'UNKNOWN',
] as const;

export type FailureCategory = (typeof INTEGRATION_FAILURE_CATEGORIES)[number];

export interface ClassifiedFailure {
  category: FailureCategory;
  retryable: boolean;
  message: string;
  /** HTTP status or provider error code, when one was available. */
  providerCode?: string | null;
}

/**
 * The framework default. Every field is overridable per integration (`Integration.retryPolicy`), so
 * a flaky SMS gateway and a strict accounting API get different treatment without a code change.
 */
export const DEFAULT_RETRY_POLICY = {
  /** Total attempts including the first. 4 means one call + three retries. */
  maxAttempts: 4,
  /** First backoff delay in ms; doubles per attempt (exponential). */
  baseDelayMs: 2_000,
  /** Hard ceiling on a single backoff delay, so attempt 10 never waits an hour. */
  maxDelayMs: 60_000,
  /** Fraction of the delay randomised (0–1) to avoid a thundering herd across tenants. */
  jitterRatio: 0.2,
  /** Per-request ceiling. A hung provider must not hold a worker slot open. */
  timeoutMs: 20_000,
} as const;

/**
 * An interface rather than `typeof DEFAULT_RETRY_POLICY`: the defaults are `as const`, so deriving
 * the type from them would pin every field to its literal (`maxAttempts: 4`), and a clamped
 * override could never be assigned to a `RetryPolicy`. Widened to `number` so a resolved policy can
 * carry any value within the documented bounds.
 */
export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  timeoutMs: number;
}

export interface RetryPolicyOverrides {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  timeoutMs?: number;
}

/**
 * Merges a tenant's stored override onto the default, clamping every field.
 *
 * Clamping matters because the value comes from a tenant-controlled JSON column: an unbounded
 * maxAttempts would let a configuration mistake turn into an infinite retry loop, and an unbounded
 * delay would park jobs until Redis evicts them.
 */
export function resolveRetryPolicy(overrides?: RetryPolicyOverrides | null): RetryPolicy {
  /** Whole-number fields (attempts, milliseconds) are floored: a fractional delay is meaningless. */
  const clampInt = (value: number | undefined, fallback: number, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(value)));
  };

  /**
   * Ratio fields must NOT be floored. Flooring 0.5 jitter to 0 would silently disable jitter
   * entirely — which is exactly the thundering-herd protection the field exists for — and a
   * `jitterRatio: 0.9` would collapse to 0. Rounded to 4dp instead, which keeps a stored value
   * readable while staying well inside [min, max].
   */
  const clampRatio = (value: number | undefined, fallback: number, min: number, max: number): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.round(value * 10_000) / 10_000));
  };

  return {
    maxAttempts: clampInt(overrides?.maxAttempts, DEFAULT_RETRY_POLICY.maxAttempts, 1, 10),
    baseDelayMs: clampInt(overrides?.baseDelayMs, DEFAULT_RETRY_POLICY.baseDelayMs, 100, 600_000),
    maxDelayMs: clampInt(overrides?.maxDelayMs, DEFAULT_RETRY_POLICY.maxDelayMs, 1_000, 3_600_000),
    jitterRatio: clampRatio(overrides?.jitterRatio, DEFAULT_RETRY_POLICY.jitterRatio, 0, 1),
    timeoutMs: clampInt(overrides?.timeoutMs, DEFAULT_RETRY_POLICY.timeoutMs, 1_000, 120_000),
  };
}

/**
 * Backoff delay before `attempt` (1-based: attempt 1 has already happened).
 *
 * `random` is injectable so tests are deterministic; production passes nothing and gets real jitter.
 * Jitter is applied symmetrically around the delay, which spreads a fleet of workers that all failed
 * against the same provider at the same instant.
 */
export function computeBackoffDelayMs(
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  const exponential = policy.baseDelayMs * 2 ** (safeAttempt - 1);
  const capped = Math.min(policy.maxDelayMs, exponential);
  if (policy.jitterRatio <= 0) return capped;
  const spread = capped * policy.jitterRatio;
  const offset = (random() * 2 - 1) * spread;
  return Math.max(0, Math.round(capped + offset));
}

/** True when another attempt is allowed and the failure itself is worth retrying. */
export function shouldRetry(failure: Pick<ClassifiedFailure, 'retryable'>, policy: RetryPolicy, attempt: number): boolean {
  return failure.retryable && attempt < policy.maxAttempts;
}

/**
 * Classifies an outbound failure from whatever the adapter could observe.
 *
 * The status-code rules are the load-bearing part and are deliberately conservative about retrying:
 *
 *  - 401/403 → AUTHENTICATION, permanent. Retrying bad credentials just locks accounts and, on some
 *    providers, counts toward fraud heuristics.
 *  - 400/404/409/422 → PROVIDER_REJECTED, permanent. Our request is wrong; sending it again
 *    produces the same rejection. 409 is included because an idempotency-key collision means the
 *    work is already done.
 *  - 408/425/429 → TIMEOUT / RATE_LIMIT, transient. 429 additionally carries Retry-After, which
 *    the adapter may surface via `retryAfterMs`.
 *  - 5xx → transient, always. The provider's fault, not ours.
 *  - network/abort → NETWORK/TIMEOUT, transient.
 *  - anything else (including 2xx bodies the adapter could not parse) → SCHEMA when a response was
 *    received, UNKNOWN otherwise, and permanent: retrying a schema mismatch cannot fix the mismatch.
 */
export function classifyIntegrationFailure(input: {
  status?: number | null;
  error?: unknown;
  message?: string | null;
  providerCode?: string | null;
  retryAfterMs?: number | null;
}): ClassifiedFailure {
  const status = typeof input.status === 'number' ? input.status : null;
  const rawMessage = input.message ?? errorMessage(input.error);

  if (status !== null) {
    if (status === 401 || status === 403) {
      return {
        category: 'AUTHENTICATION',
        retryable: false,
        message: `Provider rejected the credentials (HTTP ${status}). ${rawMessage}`.trim(),
        providerCode: input.providerCode ?? String(status),
      };
    }
    if (status === 408 || status === 425) {
      return { category: 'TIMEOUT', retryable: true, message: rawMessage || `Provider timed out (HTTP ${status}).`, providerCode: String(status) };
    }
    if (status === 429) {
      const wait = input.retryAfterMs ? ` Retry after ${Math.ceil(input.retryAfterMs / 1000)}s.` : '';
      return {
        category: 'RATE_LIMIT',
        retryable: true,
        message: rawMessage || `Provider rate limit reached (HTTP 429).${wait}`,
        providerCode: input.providerCode ?? String(status),
      };
    }
    if (status === 400 || status === 404 || status === 409 || status === 422) {
      return {
        category: 'PROVIDER_REJECTED',
        retryable: false,
        message: `Provider rejected the request (HTTP ${status}). ${rawMessage}`.trim(),
        providerCode: input.providerCode ?? String(status),
      };
    }
    if (status >= 500) {
      return {
        category: 'NETWORK',
        retryable: true,
        message: rawMessage || `Provider is unavailable (HTTP ${status}).`,
        providerCode: input.providerCode ?? String(status),
      };
    }
    if (status >= 200 && status < 300) {
      // A success status with an unusable body is a contract mismatch, not a transport problem.
      return {
        category: 'SCHEMA',
        retryable: false,
        message: rawMessage || `Provider returned HTTP ${status} but the response did not match the expected shape.`,
        providerCode: input.providerCode ?? String(status),
      };
    }
    // Uncommon 1xx/3xx/4xx (e.g. 402, 451) are treated as permanent rejections.
    return {
      category: 'PROVIDER_REJECTED',
      retryable: false,
      message: rawMessage || `Provider returned an unexpected HTTP ${status}.`,
      providerCode: input.providerCode ?? String(status),
    };
  }

  const name = errorName(input.error);
  if (name === 'TimeoutError' || name === 'AbortError') {
    return { category: 'TIMEOUT', retryable: true, message: rawMessage || 'Request to the provider timed out.' };
  }
  // fetch() surfaces DNS/TLS/socket failures as TypeError with a cause chain.
  if (name === 'TypeError' || isNetworkCause(input.error)) {
    return { category: 'NETWORK', retryable: true, message: rawMessage || 'Could not reach the provider.' };
  }
  return {
    category: 'UNKNOWN',
    retryable: false,
    message: rawMessage || 'Integration call failed for an unknown reason.',
    providerCode: input.providerCode ?? null,
  };
}

function errorName(error: unknown): string | null {
  if (error instanceof Error) return error.name;
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name?: unknown }).name;
    return typeof name === 'string' ? name : null;
  }
  return null;
}

/**
 * Errno codes that always mean "the transport failed", never "the provider rejected the request".
 *
 * Used against both a `code` property and the message text, because the two real-world shapes differ:
 * undici throws `TypeError: fetch failed` with the errno on `cause.code`, while a polyfilled or
 * intercepted fetch often surfaces a plain `Error: connect ECONNREFUSED 10.0.0.1:443` with the errno
 * only in the message. Classifying the second as a permanent UNKNOWN would silently disable retries
 * for a transient outage, which is the worst possible time to lose them.
 */
const NETWORK_ERRNOS = [
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
];

function isNetworkCause(error: unknown): boolean {
  // Walk the `cause` chain: undici nests the real errno two or three levels down.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current && typeof current === 'object') {
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string' && NETWORK_ERRNOS.includes(code)) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
    } else {
      break;
    }
  }
  // Fall back to the message, but only for the error we were actually handed — not for its causes,
  // whose messages are the vendor's own text and could contain a false match.
  const message = errorMessage(error);
  return message !== '' && NETWORK_ERRNOS.some((errno) => message.includes(errno));
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error) return error;
  return '';
}
