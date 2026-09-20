/**
 * Pure installment/preview math for the fees module — no I/O, deliberately unit-testable.
 *
 * Splitting rule: a line of A cents across N installments pays `base = floor(A / N)` per
 * installment plus the cent remainder distributed one-per-installment from the earliest
 * installment forward (so installment i of N gets `base + (i < A % N ? 1 : 0)`). This keeps the
 * sum exactly equal to A and front-loads the odd paisa — standard billing practice so late
 * installments never carry the rounding gap.
 */

export interface FeeSplitSource {
  id: string;
  headCode: string;
  headName: string;
  amountCents: number;
}

export interface FeeSplitAllocation {
  sourceId: string;
  headCode: string;
  headName: string;
  installmentAmountCents: number;
}

export interface InstallmentPlan {
  index: number; // 1-based
  dueDate: Date;
  totalCents: number; // sum of allocations in this installment
  lines: FeeSplitAllocation[];
}

/** Splits a single source amount into N ≥ 1 installment amounts summing to `amountCents`. */
export function splitAmount(amountCents: number, installmentCount: number): number[] {
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error(`amountCents must be a non-negative integer (got ${amountCents})`);
  }
  const n = Math.max(1, Math.floor(installmentCount));
  const base = Math.floor(amountCents / n);
  const remainder = amountCents % n;
  const parts: number[] = [];
  for (let i = 0; i < n; i += 1) {
    parts.push(base + (i < remainder ? 1 : 0));
  }
  return parts;
}

/** Splits a whole list of lines into per-installment allocations, line order preserved. */
export function splitLines(
  items: FeeSplitSource[],
  installmentCount: number,
): FeeSplitAllocation[][] {
  const n = Math.max(1, Math.floor(installmentCount));
  const installments: FeeSplitAllocation[][] = Array.from({ length: n }, () => []);
  for (const item of items) {
    const parts = splitAmount(item.amountCents, n);
    parts.forEach((amount, i) => {
      installments[i].push({
        sourceId: item.id,
        headCode: item.headCode,
        headName: item.headName,
        installmentAmountCents: amount,
      });
    });
  }
  return installments;
}

/** Anchored due dates: first installment lands `dueDayOffset` days after `anchor`, each further
 * installment adds `installmentGapDays`. */
export function installmentDates(
  anchor: Date,
  installmentCount: number,
  dueDayOffset: number,
  installmentGapDays: number,
): Date[] {
  const n = Math.max(1, Math.floor(installmentCount));
  const dates: Date[] = [];
  for (let i = 0; i < n; i += 1) {
    const d = new Date(anchor);
    d.setUTCDate(d.getUTCDate() + dueDayOffset + i * installmentGapDays);
    dates.push(d);
  }
  return dates;
}

/** Builds the full installment plan for a structure (used for issuance and for the preview
 * endpoint — issuance just persists the exact same array). */
export function buildInstallmentPlan(
  lines: { id: string; headCode: string; headName: string; amountCents: number }[],
  installmentCount: number,
  anchor: Date,
  dueDayOffset: number,
  installmentGapDays: number,
): InstallmentPlan[] {
  const allocated = splitLines(lines, installmentCount);
  const dates = installmentDates(anchor, installmentCount, dueDayOffset, installmentGapDays);
  return allocated.map((alloc, i) => ({
    index: i + 1,
    dueDate: dates[i],
    totalCents: alloc.reduce((sum, l) => sum + l.installmentAmountCents, 0),
    lines: alloc,
  }));
}