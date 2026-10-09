/**
 * Route normalization for HTTP metrics.
 *
 * Labeling requests by raw URL would explode metric cardinality (every id becomes a label value)
 * and leak tenant identifiers into the metrics store. Express exposes the matched route pattern on
 * `request.route.path` for most controller traffic; for unmatched URLs (404s, middleware-level
 * failures) we fall back to a structural template where ids are replaced by `:id`.
 */

export interface RouteAwareRequest {
  /** Express: the matched layer's route (`'/students/:id'`). */
  route?: { path?: string } | undefined;
  /** Mount path of the router that matched, without trailing slash. */
  baseUrl?: string | undefined;
  path?: string | undefined;
  url?: string | undefined;
  originalUrl?: string | undefined;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_ID_PATTERN = /^[0-9a-f]{16,}$/i;
const CUID_PATTERN = /^c[a-z0-9]{20,}$/i;
const LONG_TOKEN_PATTERN = /^[A-Za-z0-9_-]{24,}$/;
const NUMERIC_PATTERN = /^\d+$/;

/** Best-effort normalized route for a request: matched pattern if available, else a template. */
export function routePathOf(request: RouteAwareRequest): string {
  const matched = request.route?.path;
  if (matched) {
    const base = (request.baseUrl ?? '').replace(/\/$/, '');
    const full = `${base}${matched}`;
    return full.startsWith('/') ? full : `/${full}`;
  }
  return normalizeUrl(request.originalUrl ?? request.url ?? request.path ?? 'unknown');
}

/** Replaces identifier-looking path segments with `:id` and drops the query string. */
export function normalizeUrl(rawUrl: string): string {
  const withoutQuery = rawUrl.split(/[?#]/, 1)[0] ?? '';
  const segments = withoutQuery.split('/').map((segment) => (isIdentifierSegment(segment) ? ':id' : segment));
  return segments.join('/') || '/';
}

function isIdentifierSegment(segment: string): boolean {
  if (segment.length === 0) return false;
  if (NUMERIC_PATTERN.test(segment)) return true;
  if (UUID_PATTERN.test(segment)) return true;
  if (HEX_ID_PATTERN.test(segment)) return true;
  if (CUID_PATTERN.test(segment)) return true;
  // Long opaque tokens (webhook path tokens, signed-url fragments, api keys in paths).
  if (LONG_TOKEN_PATTERN.test(segment) && /[0-9]/.test(segment) && /[A-Za-z]/.test(segment)) return true;
  return false;
}

/** Buckets an HTTP status into its class label (`2xx`, `3xx`, `4xx`, `5xx`, `other`). */
export function statusClass(status: number): string {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500) return '5xx';
  return 'other';
}

/** Metrics helpers need bounded cardinality: cap label values at a sane length. */
export function truncateLabel(value: string, maxLength = 200): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}
