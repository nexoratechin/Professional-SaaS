import type { LibrarySequenceKind } from '@college-erp/database';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Atomic per-tenant series allocator for library member numbers, copy barcodes and accession
 * numbers. Identical contract to fees/fee-sequences.ts: call inside the caller's $transaction —
 * the upsert bumps nextValue under the row lock, so concurrent requests can never collide and
 * the returned token is ready to store as `<prefix>-<NNNNNN>`.
 */
export async function nextLibrarySeriesNumber(
  tx: any,
  tenantId: string,
  kind: LibrarySequenceKind,
  prefix: string,
): Promise<string> {
  const row = await tx.librarySequence.upsert({
    where: { tenantId_kind_prefix: { tenantId, kind, prefix } },
    create: { tenantId, kind, prefix, nextValue: 1 },
    update: { nextValue: { increment: 1 } },
  });
  return `${prefix}-${String(row.nextValue).padStart(6, '0')}`;
}