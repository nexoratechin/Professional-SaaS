/**
 * Shared ledger helpers for the fees module.
 *
 * `refreshDemandFromLines` recloses the cached totals on a FeeDemand (paid/waived/late-fee/status)
 * from its authoritative student_fees lines after every payment / refund / concession mutation and
 * returns the refreshed demand. Run inside the caller's $transaction so totals never read stale.
 *
 * `deriveDemandStatus` is the pure status derivation mirroring the students-module recompute
 * semantics, per demand line set: settled by waiver → WAIVED; fully covered by payments → PAID;
 * anything paid/waived but not settled → PARTIALLY_PAID; past due date with a balance → OVERDUE;
 * else ISSUED.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface DemandLineSnapshot {
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  lateFeeCents: number;
}

export function deriveDemandStatus(lines: DemandLineSnapshot[], dueDate: Date): string {
  const totalCents = (l: DemandLineSnapshot) => Math.max(0, l.amountCents + l.lateFeeCents - l.waivedCents);
  const paidCents = lines.reduce((s, l) => s + l.paidCents, 0);
  const waivedCents = lines.reduce((s, l) => s + l.waivedCents, 0);
  if (lines.length > 0 && lines.every((l) => l.waivedCents >= l.amountCents)) return 'WAIVED';
  if (lines.length > 0 && lines.every((l) => l.paidCents >= totalCents(l))) return 'PAID';
  if (paidCents > 0 || waivedCents > 0) return 'PARTIALLY_PAID';
  if (dueDate.getTime() < Date.now()) return 'OVERDUE';
  return 'ISSUED';
}

/** Pure per-line status: covered by cash → PAID, covered by waivers → WAIVED, else OVERDUE/ISSUED. */
export function computeFeeLineStatus(line: {
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  dueDate?: Date | null;
}): string {
  const amount = Math.max(0, line.amountCents);
  const settled = line.paidCents + line.waivedCents >= amount;
  if (settled && line.paidCents >= amount) return 'PAID';
  if (settled) return 'WAIVED';
  if (line.dueDate && Date.now() > Date.parse(String(line.dueDate))) return 'OVERDUE';
  return 'ISSUED';
}

/** Recomputes and persists a demand's cached totals from its lines. Runs on the passed tx. */
export async function refreshDemandFromLines(tx: any, tenantId: string, demandId: string): Promise<any> {
  const lines: DemandLineSnapshot[] = await tx.studentFee.findMany({ where: { demandId, tenantId } });
  const paidCents = lines.reduce((s, l) => s + l.paidCents, 0);
  const waivedCents = lines.reduce((s, l) => s + l.waivedCents, 0);
  const lateFeeCents = lines.reduce((s, l) => s + l.lateFeeCents, 0);
  const totalCents = lines.reduce((s, l) => s + l.amountCents, 0);

  const dueDate = await tx.feeDemand.findUnique({ where: { id: demandId }, select: { dueDate: true } });
  const status = deriveDemandStatus(lines, dueDate?.dueDate ?? new Date());

  return tx.feeDemand.update({
    where: { id: demandId },
    data: { paidCents, waivedCents, lateFeeCents, totalCents, status },
  });
}