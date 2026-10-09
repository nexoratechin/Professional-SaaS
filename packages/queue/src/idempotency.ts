/**
 * Idempotency helpers for background jobs.
 *
 * BullMQ is at-least-once: a worker that crashes after doing the work but before acking will see
 * the job delivered again. Two independent guards make a duplicate delivery harmless:
 *   1. a deterministic BullMQ `jobId`, so re-enqueuing the same logical job while it is still
 *      waiting/active/delayed is deduped by BullMQ itself; and
 *   2. an application-level `idempotencyKey` recorded on the BackgroundJob registry, so the
 *      enqueue helper can recognize "this logical job already exists" even after the first copy
 *      has completed and been evicted from Redis.
 *
 * Keys are derived from stable business identifiers (never from timestamps or random values), so
 * two calls that mean the same thing collide by construction.
 */
export function buildIdempotencyKey(
  ...parts: Array<string | number | null | undefined>
): string {
  const normalized = parts
    .filter((part) => part !== null && part !== undefined && `${part}`.length > 0)
    .map((part) => `${part}`);
  if (normalized.length === 0) {
    throw new Error('buildIdempotencyKey requires at least one non-empty part.');
  }
  return normalized.join(':');
}

/**
 * BullMQ job ids may not contain `:`. Business keys frequently do (e.g. `report:{id}:{tenant}`),
 * so collapse every run of non-alphanumeric characters to a single `-` and trim the ends for a
 * clean Redis-side id while the registry keeps the original key.
 */
export function toBullJobId(idempotencyKey: string): string {
  return idempotencyKey
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Convenience: derive a deterministic BullMQ job id straight from the key parts. */
export function deterministicJobId(...parts: Array<string | number | null | undefined>): string {
  return toBullJobId(buildIdempotencyKey(...parts));
}
