/**
 * Pure installment math — the exact invariant every fee demand issuance path leans on: the
 * installments always sum back to the source amount (no rounding drift) and due dates are
 * strictly increasing. All functions are I/O-free; the issuance service only persists the exact
 * array these produce.
 */
import {
  buildInstallmentPlan,
  installmentDates,
  splitAmount,
  splitLines,
  type FeeSplitSource,
} from './fee-splitting';

describe('fee-splitting', () => {
  describe('splitAmount', () => {
    it('splits cents into N integer parts that sum exactly to the input', () => {
      const total = 100001;
      const parts = splitAmount(total, 3);
      expect(parts).toHaveLength(3);
      expect(parts.reduce((s, v) => s + v, 0)).toBe(total);
      // each part is floor or ceil of the mean — never drifts by more than 1 paisa
      expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
    });

    it('handles amounts smaller than the installment count', () => {
      expect(splitAmount(2, 5)).toEqual([1, 1, 0, 0, 0]);
    });

    it('returns a single element when there is one installment', () => {
      expect(splitAmount(12345, 1)).toEqual([12345]);
    });
  });

  describe('splitLines', () => {
    const sources: FeeSplitSource[] = [
      { id: 'a', headCode: 'TUITION', headName: 'Tuition', amountCents: 1001 },
      { id: 'b', headCode: 'LAB', headName: 'Lab', amountCents: 19 },
    ];

    it('produces N allocations per line preserving source order and exact sums', () => {
      const plan = splitLines(sources, 5);
      expect(plan).toHaveLength(5);
      for (const installment of plan) {
        expect(installment.map((l) => l.sourceId)).toEqual(['a', 'b']);
      }
      const sums: Record<string, number> = {};
      for (const installment of plan) {
        for (const alloc of installment) {
          sums[alloc.sourceId] = (sums[alloc.sourceId] ?? 0) + alloc.installmentAmountCents;
        }
      }
      expect(sums.a).toBe(1001);
      expect(sums.b).toBe(19);
    });
  });

  describe('installmentDates', () => {
    it('returns strictly increasing dates starting from the due-day-offset anchor', () => {
      const dates = installmentDates(new Date('2026-08-01T00:00:00Z'), 4, 15, 30);
      expect(dates).toHaveLength(4);
      expect(dates[0]!.getUTCDate()).toBe(16);
      for (let i = 1; i < dates.length; i += 1) {
        expect(dates[i]!.getTime()).toBeGreaterThan(dates[i - 1]!.getTime());
      }
    });
  });

  describe('buildInstallmentPlan', () => {
    it('builds a plan where per-source sums equal the source amounts across installments', () => {
      const plan = buildInstallmentPlan(
        [
          { id: 'a', headCode: 'TUITION', headName: 'Tuition', amountCents: 100001 },
          { id: 'b', headCode: 'LAB', headName: 'Lab', amountCents: 2 },
        ],
        4,
        new Date('2026-08-01T00:00:00Z'),
        10,
        21,
      );
      expect(plan).toHaveLength(4);
      const sums: Record<string, number> = {};
      for (const installment of plan) {
        for (const alloc of installment.lines) {
          sums[alloc.sourceId] = (sums[alloc.sourceId] ?? 0) + alloc.installmentAmountCents;
        }
        expect(installment.dueDate.getTime()).toBeGreaterThanOrEqual(new Date('2026-08-11').getTime());
      }
      expect(sums.a).toBe(100001);
      expect(sums.b).toBe(2);
    });
  });
});