/**
 * Result process lifecycle: CALCULATED -> APPROVED -> PUBLISHED -> LOCKED (and back). Covers the
 * transition guards, the tenant anchor on every read, history + audit side effects, and bulk
 * actions. Uses a mocked tenant-scoped client (no DB).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PermissionsService } from '../rbac/permissions.service';
import { ResultsService } from './results.service';

const TENANT = 'tenant-1';
const USER = 'user-1';
const SESSION = 'session-1';
const STUDENT = 'student-1';

function makeService() {
  const client = {
    examSession: { findFirst: jest.fn() },
    resultProcess: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    resultHistory: { create: jest.fn().mockResolvedValue({}) },
    student: { findFirst: jest.fn().mockResolvedValue({ id: STUDENT, userId: 'u-student' }) },
    resultCalculation: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const permissionsService = {
    getScopeGrantsFor: jest.fn().mockResolvedValue([{ scopeType: 'GLOBAL' }]),
  } as unknown as PermissionsService;
  const notifications = { sendSystem: jest.fn() } as unknown as NotificationsService;
  const service = new ResultsService(tenantPrisma, auditService, permissionsService, notifications);
  return { service, client, auditService };
}

describe('ResultsService.approveProcess', () => {
  it('moves a CALCULATED process to APPROVED and records history + audit', async () => {
    const { service, client, auditService } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION, resultsLockedAt: null });
    client.resultProcess.findFirst.mockResolvedValue({ id: 'p1', state: 'CALCULATED' });
    client.resultProcess.update.mockResolvedValue({ id: 'p1', state: 'APPROVED' });

    const result = await service.approveProcess(TENANT, USER, SESSION, STUDENT);
    expect(result).toMatchObject({ state: 'APPROVED' });
    expect(client.resultProcess.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p1' }, data: expect.objectContaining({ state: 'APPROVED', approvedBy: USER }) }),
    );
    expect(client.resultHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ event: 'APPROVED', fromState: 'CALCULATED', toState: 'APPROVED' }),
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.RESULT_APPROVED, entityType: 'ResultProcess', tenantId: TENANT }),
    );
  });

  it('always anchors the process lookup on the tenant (no cross-tenant read)', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION, resultsLockedAt: null });
    client.resultProcess.findFirst.mockResolvedValue({ id: 'p1', state: 'CALCULATED' });
    client.resultProcess.update.mockResolvedValue({ id: 'p1', state: 'APPROVED' });

    await service.approveProcess(TENANT, USER, SESSION, STUDENT);
    expect(client.examSession.findFirst).toHaveBeenCalledWith({
      where: { id: SESSION, tenantId: TENANT, deletedAt: null },
    });
    expect(client.resultProcess.findFirst).toHaveBeenCalledWith({
      where: { tenantId: TENANT, sessionId: SESSION, studentId: STUDENT },
    });
  });

  it('refuses to approve when the session results are locked', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION, resultsLockedAt: new Date() });
    await expect(service.approveProcess(TENANT, USER, SESSION, STUDENT)).rejects.toBeInstanceOf(BadRequestException);
    expect(client.resultProcess.findFirst).not.toHaveBeenCalled();
  });

  it('refuses to approve an already PUBLISHED/LOCKED process', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION, resultsLockedAt: null });
    client.resultProcess.findFirst.mockResolvedValue({ id: 'p1', state: 'PUBLISHED' });
    await expect(service.approveProcess(TENANT, USER, SESSION, STUDENT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound when no process exists yet', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION, resultsLockedAt: null });
    client.resultProcess.findFirst.mockResolvedValue(null);
    await expect(service.approveProcess(TENANT, USER, SESSION, STUDENT)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ResultsService.publishProcess guards', () => {
  it('refuses to publish a process that is not APPROVED', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION, resultsLockedAt: null });
    client.resultProcess.findFirst.mockResolvedValue({ id: 'p1', state: 'CALCULATED' });
    await expect(service.publishProcess(TENANT, USER, SESSION, STUDENT)).rejects.toThrow(/only approved results can be published/i);
  });

  it('refuses to publish while the session is locked', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION, resultsLockedAt: new Date() });
    await expect(service.publishProcess(TENANT, USER, SESSION, STUDENT)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ResultsService.lockProcess / unlockProcess', () => {
  it('locks a PUBLISHED process and unlocks a LOCKED one', async () => {
    const lock = makeService();
    lock.client.examSession.findFirst.mockResolvedValue({ id: SESSION });
    lock.client.resultProcess.findFirst.mockResolvedValue({ id: 'p1', state: 'PUBLISHED' });
    lock.client.resultProcess.update.mockResolvedValue({ id: 'p1', state: 'LOCKED' });
    await expect(lock.service.lockProcess(TENANT, USER, SESSION, STUDENT)).resolves.toMatchObject({ state: 'LOCKED' });
    expect(lock.client.resultProcess.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: 'LOCKED' }) }),
    );

    const unlock = makeService();
    unlock.client.examSession.findFirst.mockResolvedValue({ id: SESSION });
    unlock.client.resultProcess.findFirst.mockResolvedValue({ id: 'p1', state: 'LOCKED' });
    unlock.client.resultProcess.update.mockResolvedValue({ id: 'p1', state: 'PUBLISHED' });
    await expect(unlock.service.unlockProcess(TENANT, USER, SESSION, STUDENT)).resolves.toMatchObject({ state: 'PUBLISHED' });
  });

  it('refuses to lock a non-PUBLISHED process', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION });
    client.resultProcess.findFirst.mockResolvedValue({ id: 'p1', state: 'APPROVED' });
    await expect(service.lockProcess(TENANT, USER, SESSION, STUDENT)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses to unlock a non-LOCKED process', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION });
    client.resultProcess.findFirst.mockResolvedValue({ id: 'p1', state: 'PUBLISHED' });
    await expect(service.unlockProcess(TENANT, USER, SESSION, STUDENT)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ResultsService.bulkAction', () => {
  it('approves every CALCULATED/PENDING_APPROVAL process and reports the count', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION });
    client.resultProcess.findMany.mockResolvedValue([
      { id: 'p1', studentId: 's1', state: 'CALCULATED' },
      { id: 'p2', studentId: 's2', state: 'PENDING_APPROVAL' },
    ]);
    client.resultProcess.update.mockResolvedValue({});

    const result = await service.bulkAction(TENANT, USER, SESSION, { action: 'APPROVE' });
    expect(result).toEqual({ action: 'APPROVE', affected: 2 });
    expect(client.resultProcess.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, sessionId: SESSION, state: { in: ['CALCULATED', 'PENDING_APPROVAL'] } },
      select: { id: true, studentId: true, state: true },
    });
    expect(client.resultHistory.create).toHaveBeenCalledTimes(2);
  });

  it('rejects an unknown bulk action', async () => {
    const { service, client } = makeService();
    client.examSession.findFirst.mockResolvedValue({ id: SESSION });
    await expect(service.bulkAction(TENANT, USER, SESSION, { action: 'EXPLODE' })).rejects.toBeInstanceOf(BadRequestException);
  });
});
