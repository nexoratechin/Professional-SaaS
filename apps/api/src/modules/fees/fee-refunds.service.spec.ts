/**
 * FeeRefundsService — REQUESTED -> APPROVED -> PROCESSED, plus the over-refund guard and the
 * ledger-reversal rollback. Mocked tenant-scoped client + transaction (no DB).
 */
import { BadRequestException } from '@nestjs/common';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { StudentsService } from '../students/students.service';
import { FeeRefundsService } from './fee-refunds.service';

const TENANT = 'tenant-1';
const USER = 'user-1';
const STUDENT = 'student-1';

function makeService() {
  const tx = {
    feeSequence: { upsert: jest.fn().mockResolvedValue({ nextValue: 1 }) },
    studentFee: { update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    feeDemand: {
      findUnique: jest.fn().mockResolvedValue({ dueDate: new Date('2099-01-01T00:00:00Z') }),
      update: jest.fn().mockResolvedValue({}),
    },
    feeRefund: {
      aggregate: jest.fn().mockResolvedValue({ _sum: { amountCents: 6000 } }),
      update: jest.fn().mockResolvedValue({ id: 'r1', status: 'PROCESSED' }),
      create: jest.fn(),
    },
    studentPayment: { update: jest.fn().mockResolvedValue({}) },
  };
  const client = {
    feeRefund: { findFirst: jest.fn(), aggregate: jest.fn(), update: jest.fn() },
    studentPayment: { findFirst: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const studentsService = { assertStudentInScope: jest.fn().mockResolvedValue(undefined) } as unknown as StudentsService;
  const service = new FeeRefundsService(tenantPrisma, auditService, studentsService);
  return { service, client, tx, auditService };
}

const approvedRefund = (overrides: Record<string, unknown> = {}) => ({
  id: 'r1',
  status: 'APPROVED',
  processedAt: null,
  amountCents: 6000,
  paymentId: 'pay1',
  payment: {
    id: 'pay1',
    amountCents: 6000,
    allocations: [
      {
        createdAt: new Date('2026-01-01T00:00:00Z'),
        line: { id: 'l1', demandId: 'd1', amountCents: 10000, paidCents: 6000, waivedCents: 0, lateFeeCents: 0, dueDate: new Date('2099-01-01') },
      },
    ],
  },
  ...overrides,
});

describe('FeeRefundsService.request', () => {
  it('rejects a refund larger than the remaining refundable amount', async () => {
    const { service, client } = makeService();
    client.studentPayment.findFirst.mockResolvedValue({ id: 'pay1', amountCents: 10000 });
    client.feeRefund.aggregate.mockResolvedValue({ _sum: { amountCents: 4000 } });

    await expect(
      service.request(TENANT, USER, { studentId: STUDENT, paymentId: 'pay1', amountCents: 7000, method: 'CASH', reason: 'x' }),
    ).rejects.toThrow(/remain refundable/i);
  });
});

describe('FeeRefundsService.decide', () => {
  it('approves a requested refund', async () => {
    const { service, client } = makeService();
    client.feeRefund.findFirst.mockResolvedValue({ id: 'r1', status: 'REQUESTED' });
    client.feeRefund.update.mockResolvedValue({ id: 'r1', status: 'APPROVED' });

    const result = await service.decide(TENANT, USER, 'r1', { approve: true });
    expect(result).toMatchObject({ status: 'APPROVED' });
    expect(client.feeRefund.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'r1' }, data: expect.objectContaining({ status: 'APPROVED', approvedBy: USER }) }),
    );
  });

  it('refuses to decide a refund that is not REQUESTED', async () => {
    const { service, client } = makeService();
    client.feeRefund.findFirst.mockResolvedValue({ id: 'r1', status: 'PROCESSED' });
    await expect(service.decide(TENANT, USER, 'r1', { approve: true })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FeeRefundsService.process', () => {
  it('reverses the payment ledger and marks the payment REFUNDED when fully refunded', async () => {
    const { service, client, tx } = makeService();
    client.feeRefund.findFirst.mockResolvedValue(approvedRefund());

    const result = await service.process(TENANT, USER, 'r1', { referenceNumber: 'UTR-1' });
    expect(result).toMatchObject({ status: 'PROCESSED' });
    expect(tx.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1' }, data: expect.objectContaining({ paidCents: 0 }) }),
    );
    expect(tx.studentPayment.update).toHaveBeenCalledWith({
      where: { id: 'pay1' },
      data: { status: 'REFUNDED' },
    });
  });

  it('refuses to process a refund that is not APPROVED', async () => {
    const { service, client } = makeService();
    client.feeRefund.findFirst.mockResolvedValue(approvedRefund({ status: 'REQUESTED' }));
    await expect(service.process(TENANT, USER, 'r1', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to process an already-processed refund', async () => {
    const { service, client } = makeService();
    client.feeRefund.findFirst.mockResolvedValue(approvedRefund({ processedAt: new Date() }));
    await expect(service.process(TENANT, USER, 'r1', {})).rejects.toThrow(/already processed/i);
  });

  it('rolls back when the ledger cannot cover the refund amount', async () => {
    const { service, client } = makeService();
    client.feeRefund.findFirst.mockResolvedValue(
      approvedRefund({
        amountCents: 8000,
        payment: {
          id: 'pay1',
          amountCents: 8000,
          allocations: [
            {
              createdAt: new Date('2026-01-01T00:00:00Z'),
              line: { id: 'l1', demandId: 'd1', amountCents: 10000, paidCents: 6000, waivedCents: 0, lateFeeCents: 0, dueDate: new Date('2099-01-01') },
            },
          ],
        },
      }),
    );
    await expect(service.process(TENANT, USER, 'r1', {})).rejects.toThrow(/could be unwound/i);
  });
});
