import type { TenantJobData } from '@college-erp/types';

/** The minimal job surface the guard needs — kept structural so this stays framework-free. */
export interface TenantJobLike<TData extends TenantJobData = TenantJobData> {
  name?: string;
  data?: TData | null;
}

/**
 * Enforce the worker's tenant-context invariant. An HTTP request gets its tenant from
 * TenantResolutionMiddleware + TenantMatchGuard; a queue consumer has no request, so the job
 * payload is the ONLY carrier of tenant context. A job without a tenantId is a bug (or a tampered
 * payload) and must fail loudly rather than fall back to an unscoped client.
 */
export function requireTenantId<TData extends TenantJobData>(job: TenantJobLike<TData>): string {
  const tenantId = job.data?.tenantId;
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error(`Job ${job.name ?? 'unknown'} is missing tenantId; refusing to process.`);
  }
  return tenantId;
}
