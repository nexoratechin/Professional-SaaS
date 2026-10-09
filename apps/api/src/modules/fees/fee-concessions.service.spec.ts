/**
 * FeeConcessionsService — approval applies waivers (FLAT distributed oldest-first, or PERCENT of
 * each line's gross) and revocation reverses exactly the persisted distribution. Mocked
 * tenant-scoped client + transaction (no DB).
 */
import { BadRequestException } from '@nestjs/common';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { StudentsService } from '../students/students.service';
import { FeeConcessionsService } from './fee-concessions.service';

const TENANT = 'tenant-1';
const USER = 'user-1';

function makeService() {
  const tx = {
    studentFee: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
    feeDemand: {
      findUnique: jest.fn().mockResolvedValue({ dueDate: new Date('2099-01-01T00:00:00Z') }),
      update: jest.fn().mockResolvedValue({}),
    },
    feeConcession: { update: jest.fn().mockResolvedValue({ id: 'c1' }) },
  };
  const client = {
    feeConcession: { findFirst: jest.fn(), update: jest.fn() },
    studentFee: { findFirst: jest.fn(), findMany: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: (t: unknown) => unknown) => cb(tx)),
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const studentsService = { assertStudentInScope: jest.fn().mockResolvedValue(undefined) } as unknown as StudentsService;
  const service = new FeeConcessionsService(tenantPrisma, auditService, studentsService);
  return { service, client, tx };
}

describe('FeeConcessionsService.decide', () => {
  it('rejects a concession that is not PENDING', async () => {
    const { service, client } = makeService();
    client.feeConcession.findFirst.mockResolvedValue({ id: 'c1', status: 'APPROVED' });
    await expect(service.decide(TENANT, USER, 'c1', { approve: false })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('marks a rejected concession REJECTED without touching the ledger', async () => {
    const { service, client, tx } = makeService();
    client.feeConcession.findFirst.mockResolvedValue({ id: 'c1', status: 'PENDING' });
    client.feeConcession.update.mockResolvedValue({ id: 'c1', status: 'REJECTED' });

    const result = await service.decide(TENANT, USER, 'c1', { approve: false, remarks: 'ineligible' });
    expect(result).toMatchObject({ status: 'REJECTED' });
    expect(tx.studentFee.update).not.toHaveBeenCalled();
  });

  it('applies a FLAT concession to the targeted line', async () => {
    const { service, client, tx } = makeService();
    client.feeConcession.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'PENDING',
      studentId: 's1',
      studentFeeId: 'l1',
      basis: 'FLAT',
      amountCents: 3000,
    });
    const line = { id: 'l1', demandId: 'd1', amountCents: 10000, waivedCents: 0, paidCents: 0, status: 'ISSUED' };
    client.studentFee.findFirst.mockResolvedValue(line);
    tx.studentFee.findUnique.mockResolvedValue(line);

    await service.decide(TENANT, USER, 'c1', { approve: true });
    expect(tx.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1' }, data: expect.objectContaining({ waivedCents: 3000 }) }),
    );
    expect(tx.feeConcession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'APPROVED', appliedCents: 3000 }) }),
    );
  });

  it('distributes a PERCENT concession across every open line', async () => {
    const { service, client, tx } = makeService();
    client.feeConcession.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'PENDING',
      studentId: 's1',
      basis: 'PERCENT',
      percentBps: 1000, // 10%
    });
    const l1 = { id: 'l1', demandId: 'd1', amountCents: 10000, waivedCents: 0, paidCents: 0, status: 'ISSUED' };
    const l2 = { id: 'l2', demandId: 'd1', amountCents: 5000, waivedCents: 0, paidCents: 0, status: 'ISSUED' };
    client.studentFee.findMany.mockResolvedValue([l1, l2]);
    tx.studentFee.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => (where.id === 'l1' ? l1 : l2));

    await service.decide(TENANT, USER, 'c1', { approve: true });
    expect(tx.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1' }, data: expect.objectContaining({ waivedCents: 1000 }) }),
    );
    expect(tx.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l2' }, data: expect.objectContaining({ waivedCents: 500 }) }),
    );
    expect(tx.feeConcession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ appliedCents: 1500 }) }),
    );
  });

  it('rejects approval when no open lines match the target', async () => {
    const { service, client } = makeService();
    client.feeConcession.findFirst.mockResolvedValue({ id: 'c1', status: 'PENDING', studentId: 's1', basis: 'FLAT', amountCents: 3000 });
    client.studentFee.findMany.mockResolvedValue([]);
    await expect(service.decide(TENANT, USER, 'c1', { approve: true })).rejects.toThrow(/no open fee lines/i);
  });
});

describe('FeeConcessionsService.revoke', () => {
  it('reverses exactly the persisted distribution', async () => {
    const { service, client, tx } = makeService();
    client.feeConcession.findFirst.mockResolvedValue({
      id: 'c1',
      status: 'APPROVED',
      appliedCents: 3000,
      distribution: [{ studentFeeId: 'l1', amountCents: 3000 }],
    });
    tx.studentFee.findUnique.mockResolvedValue({ id: 'l1', demandId: 'd1', amountCents: 10000, waivedCents: 3000, paidCents: 0, status: 'ISSUED' });

    await service.revoke(TENANT, USER, 'c1');
    expect(tx.studentFee.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'l1' }, data: expect.objectContaining({ waivedCents: 0 }) }),
    );
    expect(tx.feeConcession.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'REVOKED', appliedCents: 0 }) }),
    );
  });

  it('refuses to revoke a concession that is not APPROVED', async () => {
    const { service, client } = makeService();
    client.feeConcession.findFirst.mockResolvedValue({ id: 'c1', status: 'REJECTED' });
    await expect(service.revoke(TENANT, USER, 'c1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
