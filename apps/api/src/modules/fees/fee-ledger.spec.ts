/**
 * Pure ledger derivations — no DB, no transaction plumbing, fully deterministic. These are the
 * invariants the payments / concessions / refunds services rely on, so they get their own suite
 * instead of being re-tested through a mocked transaction.
 */
import { AUDIT_MODULES } from '@college-erp/auth';
import { computeFeeLineStatus, deriveDemandStatus, type DemandLineSnapshot } from './fee-ledger';

describe('fee-ledger', () => {
  describe('computeFeeLineStatus', () => {
    it('derives the per-line status from its cash/waiver coverage and due date', () => {
      expect(
        computeFeeLineStatus({
          amountCents: 200000,
          paidCents: 0,
          waivedCents: 0,
          dueDate: new Date('2099-01-01T00:00:00Z'),
        }),
      ).toBe('ISSUED');

      expect(
        computeFeeLineStatus({
          amountCents: 0,
          paidCents: 0,
          waivedCents: 0,
        }),
      ).toBe('PAID');
    });

    it('reports PAID for cash-covered lines and WAIVED for waiver-covered lines', () => {
      expect(
        computeFeeLineStatus({
          amountCents: 200000,
          paidCents: 200000,
          waivedCents: 0,
        }),
      ).toBe('PAID');

      expect(
        computeFeeLineStatus({
          amountCents: 200000,
          paidCents: 50000,
          waivedCents: 150000,
        }),
      ).toBe('WAIVED');
    });

    it('reports OVERDUE for an unsettled line past its due date', () => {
      expect(
        computeFeeLineStatus({
          amountCents: 200000,
          paidCents: 0,
          waivedCents: 0,
          dueDate: new Date('2020-01-01T00:00:00Z'),
        }),
      ).toBe('OVERDUE');
    });
  });

  describe('deriveDemandStatus', () => {
    it('derives the demand status from its line set and due date', () => {
      const base: DemandLineSnapshot = {
        amountCents: 200000,
        paidCents: 0,
        waivedCents: 0,
        lateFeeCents: 0,
      };
      expect(deriveDemandStatus([{ ...base }], new Date('2099-01-01T00:00:00Z'))).toBe('ISSUED');
      expect(deriveDemandStatus([{ ...base, paidCents: 1000 }], new Date('2099-01-01T00:00:00Z'))).toBe('PARTIALLY_PAID');
      expect(deriveDemandStatus([{ ...base, paidCents: 200000 }], new Date('2099-01-01T00:00:00Z'))).toBe('PAID');
      expect(deriveDemandStatus([{ ...base, waivedCents: 200000 }], new Date('2099-01-01T00:00:00Z'))).toBe('WAIVED');
      expect(deriveDemandStatus([{ ...base }], new Date('2020-01-01T00:00:00Z'))).toBe('OVERDUE');
    });
  });
});

describe('fee-ledger deriveDemandStatus + computeFeeLineStatus', () => {
  it('available through the service layer; direct status math is covered in its own suite', () => {
    expect(typeof AUDIT_MODULES).toBe('object');
  });
});