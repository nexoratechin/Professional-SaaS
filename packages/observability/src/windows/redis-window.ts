/**
 * Redis-backed time-window counters.
 *
 * The API and the worker are separate processes with separate metric registries, but failure
 * classes live on both sides: HTTP errors and auth failures occur in the API, while payment /
 * notification / storage / queue failures occur in the worker. The alert engine runs in the API
 * and must see both sides, so selected low-volume events are additionally INCR'd into per-minute
 * Redis keys (`obs:win:<name>:<unixMinute>`, short TTL). Reading is a pipeline of MGETs over the
 * last N minute buckets — no SCAN, no KEYS, bounded work per evaluation.
 */

export interface RedisWindowClient {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  mget(...keys: string[]): Promise<Array<string | null>>;
}

const MINUTE_MS = 60_000;
export const WINDOW_KEY_PREFIX = 'obs:win';

export function minuteBucket(at: number = Date.now()): number {
  return Math.floor(at / MINUTE_MS);
}

export function windowKey(name: string, bucket: number): string {
  return `${WINDOW_KEY_PREFIX}:${name}:${bucket}`;
}

export interface BumpWindowOptions {
  amount?: number;
  /** Keys expire after window + margin so reads never see resurrected buckets. Default 90 min. */
  ttlMinutes?: number;
}

/** Increments the current minute's bucket. Failures must never break the caller's hot path. */
export async function bumpWindow(
  client: RedisWindowClient,
  name: string,
  options: BumpWindowOptions = {},
): Promise<void> {
  const key = windowKey(name, minuteBucket());
  const total = await client.incr(key);
  // Only set TTL when the bucket was just created — avoids refreshing the TTL on every hit.
  if (total === (options.amount ?? 1)) {
    await client.expire(key, Math.max(5, options.ttlMinutes ?? 90) * 60);
  }
}

/** Sums one counter across the last `windowMinutes` buckets (including the current minute). */
export async function readWindowSum(
  client: RedisWindowClient,
  name: string,
  windowMinutes: number,
  now: number = Date.now(),
): Promise<number> {
  const sums = await readWindowsSum(client, [name], windowMinutes, now);
  return sums[name] ?? 0;
}

/** Reads several counters in one round-trip per minute bucket (MGET of all names per bucket). */
export async function readWindowsSum(
  client: RedisWindowClient,
  names: readonly string[],
  windowMinutes: number,
  now: number = Date.now(),
): Promise<Record<string, number>> {
  const result: Record<string, number> = Object.fromEntries(names.map((name) => [name, 0]));
  if (names.length === 0 || windowMinutes <= 0) return result;

  const currentBucket = minuteBucket(now);
  for (let offset = 0; offset < windowMinutes; offset++) {
    const bucket = currentBucket - offset;
    const values = await client.mget(...names.map((name) => windowKey(name, bucket)));
    for (let i = 0; i < names.length; i++) {
      const raw = values[i];
      if (!raw) continue;
      const parsed = Number(raw);
      if (Number.isFinite(parsed)) {
        result[names[i] as string] = (result[names[i] as string] ?? 0) + parsed;
      }
    }
  }
  return result;
}

/** Well-known window counter names, shared by producers and the alert engine. */
export const WINDOW_COUNTERS = {
  httpRequests: 'http_requests',
  http5xx: 'http_5xx',
  authFailures: 'auth_failures',
  suspiciousLogins: 'suspicious_logins',
  queueFailures: 'queue_failures',
  deadLetterMoves: 'dead_letter_moves',
  paymentFailures: 'payment_failures',
  notificationFailures: 'notification_failures',
  storageFailures: 'storage_failures',
  trackedErrors: 'tracked_errors',
} as const;

/**
 * Worker heartbeat contract. The worker SETs `obs:worker:heartbeat:<id>` with a short TTL every
 * WORKER_HEARTBEAT_INTERVAL_MS; the API's readiness probe and alert engine SCAN for live keys.
 * A dead worker's key simply expires — no cleanup process needed.
 */
export const WORKER_HEARTBEAT_PREFIX = 'obs:worker:heartbeat:';

export function workerHeartbeatKey(workerId: string): string {
  return `${WORKER_HEARTBEAT_PREFIX}${workerId}`;
}
