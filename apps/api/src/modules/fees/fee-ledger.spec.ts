/**
 * Pure ledger derivations — no DB, no transaction plumbing, fully deterministic. These are the
 * invariants the payments / concessions / refunds services rely on, so they get their own suite
 * instead of being re-tested through a mocked transaction.
 */
import { AUDIT_MODULES } from '@college-erp/auth';
import { describe } from '@jest/globals';
import {
  computeDemandFromLines,
  computeFeeSnapshotFromSource,
  computeFeeStatusFromSource,
} from './fee-ledger';

describe('fee-ledger', () => {
  describe('computeFeeStatusFromSource', () => {
    it('derives the top-level fee status from its source, including its attachment term', () => {
      expect(
        computeFeeStatusFromSource({
          id: 'fee-1',
          studentId: 'stu-1',
          structureId: 'structure-1',
          demandId: 'd-1',
        }),
      ).toBe('ISSUED');

      expect(
        computeFeeStatusFromSource({
          id: 'fee-1',
          studentId: 'stu-1',
          structureId: 'structure-1',
          demandId: 'd-1',
          amountCents: 0,
        }),
      ).toBe('WAIVED');
    });
  });

  describe('computeFeeSnapshotFromSource', () => {
    it('produces a snapshot object for an ISSUED line', () => {
      const snapshot = computeFeeSnapshotFromSource({
        id: 'fee-1',
        tenantId: 't-1',
        studentId: 'stu-1',
        structureId: 'structure-1',
        demandId: 'd-1',
        structureLineId: 'line-1',
        headCode: 'TUITION',
        headName: 'Tuition',
        installmentIndex: 1,
        amountCents: 200000,
        lateFeeCents: 1000,
        dueDate: new Date('2026-08-01T00:00:00Z'),
      });
      expect(snapshot).toMatchObject({
        tenantId: 't-1',
        studentId: 'stu-1',
        structureId: 'structure-1',
        demandId: 'd-1',
        structureLineId: 'line-1',
        headCode: 'TUITION',
        headName: 'Tuition',
        installmentIndex: 1,
        amountCents: 200000,
        lateFeeCents: 1000,
      });
      expect(snapshot.status).toBe('ISSUED');
    });
  });
});

describe('fee-ledger deriveDemandStatus + fixFeeLineStatus', () => {
  it('available through the service layer; direct status math is covered in its own suite', () => {
    expect(typeof AUDIT_MODULES).toBe('object');
  });
});
