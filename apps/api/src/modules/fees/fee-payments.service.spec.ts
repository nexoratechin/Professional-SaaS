/**
 * FeePaymentsService.record — the money-in ledger. Covers greedy allocation across the oldest
 * open lines, the over-payment guard, receipt numbering, idempotent replay, settled-line
 * rejection and tenant anchoring. Mocked tenant-scoped client + transaction (no DB).
 */
import { BadRequestException, ConflictException } from '@nestjs/common';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { StudentsService } from '../students/students.service';
import type { TenantConfigurationService } from '../tenant-configuration/tenant-configuration.service';
import { FeePaymentsService } from './fee-payments.service';

const TENANT = 'tenant-1';
const USER = 'user-1';
const STUDENT = 'student-1';

const openLine = (id: string, amountCents: number, demandId = 'd1') => ({
  id,
  demandId,
  amountCents,
  paidCents: 0,
  waivedCents: 0,
  lateFeeCents: 0,
  status: 'ISSUED',
  dueDate: new Date('2099-01-01T00:00:00Z'),
});

function makeService() {
  const tx = {
    feeSequence: { upsert: jest.fn().mockResolvedValue({ nextValue: 1 }) },
    studentPayment: {
      create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'pay1',
        amountCents: data.amountCents,
        method: data.method,
        receiptNumber: data.receiptNumber,
      })),
      findUnique: jest.fn().mockResolvedValue({ id: 'pay1', amountCents: 12000, method: 'CASH', allocations: [] }),
    },
    studentFee: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    studentFeeAllocation: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    feeDemand: {
      findUnique: jest.fn().mockResolvedValue({ dueDate: new Date('2099-01-01T00:00:00Z') }),
      update: jest.fn().mockResolvedValue({}),
    },
  };
  const client = {
    studentPayment: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    studentFee: { findFirst: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
    feeDemand: { findFirst: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const studentsService = { assertStudentInScope: jest.fn().mockResolvedValue(undefined) } as unknown as StudentsService;
  const tenantConfiguration = { get: jest.fn().mockResolvedValue({}) } as unknown as TenantConfigurationService;
  const service = new FeePaymentsService(tenantPrisma, auditService, studentsService, tenantConfiguration);
  return { service, client, tx, auditService, studentsService };
}

describe('FeePaymentsService.record', () => {
  it('allocates greedily oldest-first, drawing a receipt number from the sequence', async () => {
    const { service, client, tx, auditService } = makeService();
    client.studentFee.findMany.mockResolvedValue([openLine('l1', 10000), openLine('l2', 5000)]);

    const result = await service.record(TENANT, USER, {
      studentId: STUDENT,
      amountCents: 12000,
      method: 'CASH',
    });

    expect(result).toMatchObject({ id: 'pay1' });
    // 10,000 to the first (oldest) line, the remaining 2,000 to the second.
    expect(tx.studentFee.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ where: { id: 'l1' }, data: expect.objectContaining({ paidCents: 10000, status: 'PAID' }) }),
    );
    expect(tx.studentFee.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ where: { id: 'l2' }, data: expect.objectContaining({ paidCents: 2000, status: 'ISSUED' }) }),
    );
    expect(tx.studentFeeAllocation.createMany).toHaveBeenCalledWith({
      data: [
        { tenantId: TENANT, paymentId: 'pay1', studentFeeId: 'l1', amountCents: 10000 },
        { tenantId: TENANT, paymentId: 'pay1', studentFeeId: 'l2', amountCents: 2000 },
      ],
    });
    expect(tx.studentPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ receiptNumber: 'RCT-000001', status: 'SUCCEEDED' }) }),
    );
    expect(auditService.record).toHaveBeenCalled();
  });

  it('scopes line selection to the tenant and the student and only open statuses', async () => {
    const { service, client } = makeService();
    client.studentFee.findMany.mockResolvedValue([openLine('l1', 10000)]);
    await service.record(TENANT, USER, { studentId: STUDENT, amountCents: 5000, method: 'CASH' });
    expect(client.studentFee.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, studentId: STUDENT, status: { in: ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'] } },
      orderBy: [{ dueDate: 'asc' }, { installmentIndex: 'asc' }],
      take: 20,
    });
  });

  it('rejects an over-payment against the open balance', async () => {
    const { service, client, tx } = makeService();
    client.studentFee.findMany.mockResolvedValue([openLine('l1', 10000)]);
    await expect(
      service.record(TENANT, USER, { studentId: STUDENT, amountCents: 20000, method: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.studentPayment.create).not.toHaveBeenCalled();
  });

  it('replays an idempotent payment without writing a second receipt', async () => {
    const { service, client, tx } = makeService();
    client.studentPayment.findUnique.mockResolvedValue({
      id: 'pay1',
      studentId: STUDENT,
      amountCents: 12000,
      method: 'CASH',
    });
    client.studentPayment.findFirst.mockResolvedValue({ id: 'pay1', receiptNumber: 'RCT-000001' });

    const result = await service.record(TENANT, USER, {
      studentId: STUDENT,
      amountCents: 12000,
      method: 'CASH',
      idempotencyKey: 'idem-1',
    });
    expect(result).toMatchObject({ id: 'pay1', duplicate: true });
    expect(tx.studentPayment.create).not.toHaveBeenCalled();
  });

  it('rejects an idempotency key reused with different payment details', async () => {
    const { service, client } = makeService();
    client.studentPayment.findUnique.mockResolvedValue({
      id: 'pay1',
      studentId: STUDENT,
      amountCents: 999,
      method: 'CASH',
    });
    await expect(
      service.record(TENANT, USER, { studentId: STUDENT, amountCents: 12000, method: 'CASH', idempotencyKey: 'idem-1' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects payment against an already-settled line', async () => {
    const { service, client } = makeService();
    client.studentFee.findFirst.mockResolvedValue({ ...openLine('l1', 10000), status: 'PAID' });
    await expect(
      service.record(TENANT, USER, { studentId: STUDENT, studentFeeId: 'l1', amountCents: 1000, method: 'CASH' }),
    ).rejects.toThrow(/already settled/i);
  });

  it('asserts student scope before touching the ledger', async () => {
    const { service, studentsService, tx } = makeService();
    // No open lines => nothing to allocate against => rejected before any write.
    await expect(
      service.record(TENANT, USER, { studentId: STUDENT, amountCents: 1000, method: 'CASH' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(studentsService.assertStudentInScope).toHaveBeenCalledWith(STUDENT, TENANT, USER);
    expect(tx.studentPayment.create).not.toHaveBeenCalled();
  });
});
