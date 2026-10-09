import type { DeadLetterJobData } from '@college-erp/types';

export interface DeadLetterSource {
  sourceQueue: string;
  sourceJobId?: string | number | null;
  jobName?: string;
  tenantId?: string | null;
  attemptsMade: number;
  maxAttempts: number;
  failedReason: string;
  payload: unknown;
  failedAt?: Date;
}

/**
 * Normalize a terminal failure into the dead-letter payload. The original job payload is carried
 * verbatim so an operator can replay the exact same work from the DLQ by hand — nothing about the
 * failure is summarized away.
 */
export function buildDeadLetterPayload(source: DeadLetterSource): DeadLetterJobData {
  const reason = source.failedReason?.trim() || 'Unknown failure';
  return {
    sourceQueue: source.sourceQueue,
    sourceJobId: source.sourceJobId == null ? null : String(source.sourceJobId),
    jobName: source.jobName ?? 'unknown',
    tenantId: source.tenantId ?? null,
    attemptsMade: source.attemptsMade,
    maxAttempts: source.maxAttempts,
    failedReason: reason.slice(0, 2_000),
    failedAt: (source.failedAt ?? new Date()).toISOString(),
    payload: source.payload ?? null,
  };
}
