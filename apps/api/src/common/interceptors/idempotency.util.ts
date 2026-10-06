import { createHash } from 'node:crypto';
import type { Request } from 'express';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const IDEMPOTENCY_REPLAYED_HEADER = 'Idempotency-Replayed';
/** How long an in-flight claim may take before a concurrent duplicate is told to wait again. */
export const IDEMPOTENCY_INFLIGHT_TTL_SECONDS = 30;

/** The request path surface that must NEVER be idempotency-replayed — inbound device/webhook
 *  callbacks identify themselves by random path tokens, and platform/public routes have their
 *  own auth story (a replayed platform mutation from a stale cache would be worse than none). */
export const IDEMPOTENCY_SKIP_PREFIXES = [
  '/health',
  '/api/docs',
  '/platform/',
  '/public/',
  '/attendance/devices/ingest/',
  '/integrations/webhooks/',
] as const;

export const IDEMPOTENCY_MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/**
 * Stable Redis key for an idempotent request. Scoped to (tenant, user, method, path, key) so two
 * tenants — or two users on the same tenant — can never collide, a replayed key minted against a
 * different path never short-circuits a real mutation, and a client can reuse one key across
 * distinct devices safely. Hashed (SHA-256) because Idempotency-Key values are client-controlled.
 */
export function buildIdempotencyKey(req: Request, key: string): string {
  const tenantScope = (req as Request & { resolvedTenant?: { id?: string } }).resolvedTenant?.id ?? 'no-tenant';
  const userScope = (req as Request & { user?: { id?: string } }).user?.id ?? 'no-user';
  const canonical = [userScope, tenantScope, req.method.toUpperCase(), req.path, key].join('|');
  return `idem:${createHash('sha256').update(canonical).digest('hex')}`;
}

/** Tells the interceptor whether the given request qualifies for idempotency handling. Kept pure
 *  so its edge cases are unit-testable without booting Nest. */
export function isIdempotencyCandidate(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (!(IDEMPOTENCY_MUTATING_METHODS as readonly string[]).includes(method)) return false;
  if (IDEMPOTENCY_SKIP_PREFIXES.some((prefix) => req.path?.startsWith(prefix))) return false;
  return Boolean(req.header(IDEMPOTENCY_HEADER));
}