/**
 * Redaction for integration logs.
 *
 * `IntegrationOperation.request`, `IntegrationWebhookEvent.payload` and `IntegrationFailure.details`
 * are all operator-facing, searchable, long-lived rows. Writing a raw provider request into them
 * would put API keys, bearer tokens and card numbers into the database and into every admin screen
 * that renders the log — turning "an integration failed" into a credential-exfiltration incident.
 *
 * Two independent defences, because either alone is insufficient:
 *
 *  1. **Denylist by key name** — anything looking like a secret is masked. Catches the known cases
 *     across any nesting depth.
 *  2. **Pattern-based masking of value shapes** — catches secrets the key name does not reveal,
 *     e.g. a Stripe key pasted into a field called `data`, or a bearer token in a raw header dump.
 *
 * Both are lossy by design. A log is a debugging aid, not a system of record: the real payload stays
 * encrypted/unlogged, and an operator who needs the exact bytes should ask the provider.
 */

/** Key-name fragments that mark a value as secret. Matched case-insensitively as substrings. */
const SECRET_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'credential',
  'privatekey',
  'private_key',
  'clientsecret',
  'client_secret',
  'accesskey',
  'access_key',
  'secretkey',
  'secret_key',
  'signature',
  'sessionid',
  'session_id',
  'cookie',
  'otp',
  'pin',
  'cvv',
  'cvc',
  'cardnumber',
  'card_number',
  'accountnumber',
  'iban',
  'ssn',
  'aadhaar',
  'pan',
];

export const REDACTED = '[redacted]';

const MAX_DEPTH = 8;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2_000;

function isSecretKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_KEY_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

/** Value shapes that are secret regardless of what the key is called. */
function maskSecretShapedValue(value: string): string | null {
  // Provider-prefixed API keys: sk_live_…, rk_test_…, AKIA…, ghp_…, xoxb-…, SG.…, whsec_…
  if (/^(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}$/.test(value)) return REDACTED;
  if (/^AKIA[0-9A-Z]{12,}$/.test(value)) return REDACTED;
  if (/^(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}$/.test(value)) return REDACTED;
  if (/^xox[baprs]-[A-Za-z0-9-]{8,}$/.test(value)) return REDACTED;
  if (/^SG\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(value)) return REDACTED;
  if (/^whsec_[A-Za-z0-9]{16,}$/.test(value)) return REDACTED;
  if (/^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(value)) return REDACTED; // JWT
  // Basic-auth and bearer values pasted into a neutral-looking field.
  if (/^(Bearer|Basic)\s+\S{8,}$/i.test(value)) return REDACTED;
  // AWS SigV4-style signature query parameters.
  if (/^X-Amz-Signature=[0-9a-f]{32,}$/i.test(value)) return REDACTED;
  return null;
}

/**
 * Recursively redacts a JSON-ish value for safe persistence.
 *
 * Depth, breadth and string length are all bounded: a webhook body from an unfamiliar provider is
 * attacker-controlled, and an unbounded recursive copy of it would be both a log-filling DoS and a
 * way to smuggle megabytes into a JSONB column.
 *
 * Cycles are tracked with a `seen` set: a self-referential body would otherwise recurse until the
 * stack blew, which is an unauthenticated way to crash the webhook endpoint.
 */
export function redactForLog(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (depth > MAX_DEPTH) return '[truncated: max depth]';

  if (typeof value === 'string') {
    const shaped = maskSecretShapedValue(value);
    if (shaped) return shaped;
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}…[truncated]` : value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') return value;

  // Registered before descending, so a repeated *reference* (shared sub-object) is reported as
  // circular too. Acceptable: log payloads are trees in practice, and terminating beats looping.
  if (value !== null && typeof value === 'object') {
    if (seen.has(value as object)) return '[circular]';
    seen.add(value as object);
  }

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactForLog(item, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`[truncated: ${value.length - MAX_ARRAY_ITEMS} more items]`);
    return items;
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = isSecretKey(key) ? REDACTED : redactForLog(val, depth + 1, seen);
    }
    return out;
  }

  // Functions/symbols/bigints are not loggable payloads. String(fn) would splice the function
  // *source* into the log — noise at best, and a way to smuggle a hardcoded credential out of a
  // source line into a persisted row. A stable marker says "not serializable" and nothing more.
  if (typeof value === 'function') return '[function]';
  if (typeof value === 'symbol') return '[symbol]';
  if (typeof value === 'bigint') return '[bigint]';
  return String(value);
}

/**
 * Request headers safe to persist. An allow-list, not a deny-list: a full header dump would capture
 * `Authorization`, `Cookie` and provider-specific API-key headers, and a deny-list always misses the
 * next provider that invents a new header name.
 */
const LOGGABLE_HEADERS = new Set([
  'content-type',
  'content-length',
  'user-agent',
  'accept',
  'accept-encoding',
  'x-request-id',
  'x-correlation-id',
  'x-shopify-topic',
  'x-github-delivery',
  'x-github-event',
  'x-gitlab-event',
  'x-event-type',
  'x-webhook-id',
  'x-attempt',
]);

export function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined> | undefined | null,
): Record<string, string> | null {
  if (!headers) return null;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!LOGGABLE_HEADERS.has(name.toLowerCase())) continue;
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(', ') : String(value);
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Truncates a provider response body for storage. Providers return megabytes of HTML on error; the
 * first 2 KB is what identifies the failure, and the rest is cost plus a liability.
 */
export function truncateResponse(text: string, maxChars = MAX_STRING_LENGTH): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated ${text.length - maxChars} chars]`;
}
