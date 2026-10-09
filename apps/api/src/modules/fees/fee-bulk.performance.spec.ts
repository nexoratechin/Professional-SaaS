/**
 * Bulk fee-schedule generation performance — buildInstallmentPlan is the pure math that issues
 * (and previews) every fee demand for a whole batch. Checks exact conservation of cents across
 * thousands of lines and a generous wall-clock budget.
 */
import { buildInstallmentPlan } from './fee-splitting';

const LINE_COUNT = 5_000;
const INSTALLMENTS = 4;
const BUDGET_MS = 5_000;

function bigLines() {
  return Array.from({ length: LINE_COUNT }, (_, i) => ({
    id: `line-${i}`,
    headCode: `H${i % 10}`,
    headName: `Head ${i % 10}`,
    // Vary the amount so remainder distribution (the +1 cents) is exercised.
    amountCents: 10001 + (i % 7) * 13,
  }));
}

describe('buildInstallmentPlan performance', () => {
  it('splits 5k lines into 4 installments without losing a single cent', () => {
    const lines = bigLines();
    const total = lines.reduce((sum, l) => sum + l.amountCents, 0);

    const start = Date.now();
    const plan = buildInstallmentPlan(lines, INSTALLMENTS, new Date('2026-01-01T00:00:00Z'), 0, 30);
    const elapsed = Date.now() - start;

    expect(plan).toHaveLength(INSTALLMENTS);
    const planTotal = plan.reduce((sum, installment) => sum + installment.totalCents, 0);
    expect(planTotal).toBe(total);
    // Each installment carries exactly one allocation per source line.
    for (const installment of plan) {
      expect(installment.lines).toHaveLength(LINE_COUNT);
    }
    // Due dates step forward by the configured gap.
    expect(plan[1]!.dueDate.toISOString()).toBe('2026-01-31T00:00:00.000Z');
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});
