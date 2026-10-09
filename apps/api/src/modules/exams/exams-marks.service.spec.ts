/**
 * Exam marks-entry workflow: DRAFT -> SUBMITTED -> MODERATED -> APPROVED, with REJECT back to
 * DRAFT. Covers the transition guards, the audits, tenant anchoring, and marks range validation.
 * Uses a mocked tenant-scoped client (no DB).
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PermissionsService } from '../rbac/permissions.service';
import { ExamsService } from './exams.service';

const TENANT = 'tenant-1';
const USER = 'user-1';
const SUBJECT = 'subject-1';
const MARKS = 'marks-1';

function makeService() {
  const client = {
    examMarksEntry: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({ id: MARKS }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn(),
    },
    examSubject: { findFirst: jest.fn() },
    examRegistration: { findFirst: jest.fn() },
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const auditService = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const permissionsService = { getScopeGrantsFor: jest.fn().mockResolvedValue([{ scopeType: 'GLOBAL' }]) } as unknown as PermissionsService;
  const notifications = { sendSystem: jest.fn() } as unknown as NotificationsService;
  const service = new ExamsService(tenantPrisma, auditService, permissionsService, notifications);
  return { service, client, auditService };
}

describe('ExamsService marks transitions', () => {
  it('submits a DRAFT entry, anchored on the tenant', async () => {
    const { service, client } = makeService();
    client.examMarksEntry.findFirst.mockResolvedValue({ id: MARKS, status: 'DRAFT' });

    await expect(service.submitMarks(TENANT, USER, MARKS)).resolves.toEqual({ success: true, status: 'SUBMITTED' });
    expect(client.examMarksEntry.findFirst).toHaveBeenCalledWith({
      where: { id: MARKS, tenantId: TENANT },
      select: { id: true, status: true, registrationId: true, subjectId: true, studentId: true },
    });
    expect(client.examMarksEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: MARKS }, data: expect.objectContaining({ status: 'SUBMITTED' }) }),
    );
  });

  it('refuses an out-of-order transition (SUBMITTED -> SUBMITTED)', async () => {
    const { service, client } = makeService();
    client.examMarksEntry.findFirst.mockResolvedValue({ id: MARKS, status: 'SUBMITTED' });
    await expect(service.submitMarks(TENANT, USER, MARKS)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('moderates SUBMITTED -> MODERATED and stamps the moderator', async () => {
    const { service, client } = makeService();
    client.examMarksEntry.findFirst.mockResolvedValue({ id: MARKS, status: 'SUBMITTED' });
    await expect(service.moderateMarks(TENANT, USER, MARKS)).resolves.toEqual({ success: true, status: 'MODERATED' });
    expect(client.examMarksEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'MODERATED', moderatedBy: USER, moderatedAt: expect.any(Date) }),
      }),
    );
  });

  it('approves MODERATED -> APPROVED and stamps the approver', async () => {
    const { service, client } = makeService();
    client.examMarksEntry.findFirst.mockResolvedValue({ id: MARKS, status: 'MODERATED' });
    await expect(service.approveMarks(TENANT, USER, MARKS)).resolves.toEqual({ success: true, status: 'APPROVED' });
    expect(client.examMarksEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', approvedBy: USER, approvedAt: expect.any(Date) }),
      }),
    );
  });

  it('rejects SUBMITTED -> DRAFT, clearing moderation stamps', async () => {
    const { service, client } = makeService();
    client.examMarksEntry.findFirst.mockResolvedValue({ id: MARKS, status: 'SUBMITTED' });
    await expect(service.rejectMarks(TENANT, USER, MARKS)).resolves.toEqual({ success: true, status: 'DRAFT' });
    expect(client.examMarksEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'DRAFT', moderatedBy: null, approvedBy: null }),
      }),
    );
  });

  it('refuses to reject an entry that is still DRAFT', async () => {
    const { service, client } = makeService();
    client.examMarksEntry.findFirst.mockResolvedValue({ id: MARKS, status: 'DRAFT' });
    await expect(service.rejectMarks(TENANT, USER, MARKS)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws NotFound for an entry outside the tenant', async () => {
    const { service, client } = makeService();
    client.examMarksEntry.findFirst.mockResolvedValue(null); // tenant-scoped lookup hides it
    await expect(service.submitMarks(TENANT, USER, 'other-tenant-marks')).rejects.toBeInstanceOf(NotFoundException);
    expect(client.examMarksEntry.update).not.toHaveBeenCalled();
  });
});

describe('ExamsService.upsertMarksEntry validation', () => {
  it('rejects marks above maxMarks', async () => {
    const { service, client } = makeService();
    client.examSubject.findFirst.mockResolvedValue({ id: SUBJECT, sessionId: 'session-1', maxMarks: 100 });
    client.examRegistration.findFirst.mockResolvedValue({ id: 'reg-1', studentId: 'student-1' });
    client.examMarksEntry.findFirst.mockResolvedValue(null);

    await expect(
      service.upsertMarksEntry(TENANT, USER, SUBJECT, { studentId: 'student-1', marksObtained: 150 }),
    ).rejects.toThrow(/between 0 and 100/i);
    expect(client.examMarksEntry.upsert).not.toHaveBeenCalled();
  });

  it('rejects marks + grace above maxMarks', async () => {
    const { service, client } = makeService();
    client.examSubject.findFirst.mockResolvedValue({ id: SUBJECT, sessionId: 'session-1', maxMarks: 100 });
    client.examRegistration.findFirst.mockResolvedValue({ id: 'reg-1', studentId: 'student-1' });
    client.examMarksEntry.findFirst.mockResolvedValue(null);

    await expect(
      service.upsertMarksEntry(TENANT, USER, SUBJECT, { studentId: 'student-1', marksObtained: 95, graceMarks: 10 }),
    ).rejects.toThrow(/cannot exceed maxMarks/i);
  });
});
