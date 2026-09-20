import type { FeeSequenceKind } from '@college-erp/database';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Atomic per-tenant series allocator. Call inside the caller's $transaction: upsert bumps the
 * row's nextValue under the row lock and returns the freshly-consumed number, so two concurrent
 * requests can never produce the same receipt/demand/refund number. The returned token is ready
 * to be stored as `<prefix>-<NNNNNN>`.
 */
export async function nextFeeSeriesNumber(
  tx: any,
  tenantId: string,
  kind: FeeSequenceKind,
  prefix: string,
): Promise<string> {
  const row = await tx.feeSequence.upsert({
    where: { tenantId_kind_prefix: { tenantId, kind, prefix } },
    create: { tenantId, kind, prefix, nextValue: 1 },
    update: { nextValue: { increment: 1 } },
  });
  return `${prefix}-${String(row.nextValue).padStart(6, '0')}`;
}