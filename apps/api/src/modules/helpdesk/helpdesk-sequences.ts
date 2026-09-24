import type { HelpdeskSequenceKind } from '@college-erp/database';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Atomic per-tenant series allocator for helpdesk ticket numbers. Same contract as
 * inventory/library sequences: call inside the caller's $transaction — the upsert bumps
 * nextValue under the row lock so concurrent requests can never collide and the returned token
 * is ready to store as `<prefix>-<NNNNNN>`.
 */
export async function nextHelpdeskSeriesNumber(
  tx: any,
  tenantId: string,
  kind: HelpdeskSequenceKind,
  prefix: string,
): Promise<string> {
  const row = await tx.helpdeskSequence.upsert({
    where: { tenantId_kind: { tenantId, kind } },
    create: { tenantId, kind, prefix, nextValue: 1 },
    update: { nextValue: { increment: 1 } },
  });
  return `${prefix}-${String(row.nextValue).padStart(6, '0')}`;
}
