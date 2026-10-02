/**
 * Parent/Guardian Portal — access-control tests.
 *
 * The portal's security guarantee is that a guardian can only ever read a student they are linked
 * to (Guardians.userId). These tests pin the two halves of that guarantee:
 *   1. the linked-children lookup is scoped to the authenticated user, and
 *   2. resolveChild rejects any studentId outside that set *before* any section query runs.
 */
import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '@college-erp/auth';
import { ParentPortalService } from './parent-portal.service';
import type { TenantContextService } from '../../common/prisma/tenant-context.service';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';

const USER: AuthenticatedUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 'session-1',
  email: 'parent@example.com',
  fullName: 'Parent One',
};

function studentRow(id: string, fullName: string) {
  return {
    id,
    campusId: 'campus-1',
    programId: null,
    sectionId: null,
    batchId: null,
    academicYearId: null,
    fullName,
    admissionNumber: `ADM-${id}`,
    rollNumber: null,
    status: 'ACTIVE',
    profilePhotoKey: null,
  };
}

function buildService(guardianRows: unknown[]) {
  const guardianFindMany = jest.fn().mockResolvedValue(guardianRows);
  const attendanceFindMany = jest.fn().mockResolvedValue([]);
  const attendanceCount = jest.fn().mockResolvedValue(0);
  const attendanceGroupBy = jest.fn().mockResolvedValue([]);

  const client = {
    guardian: { findMany: guardianFindMany },
    studentAttendance: { findMany: attendanceFindMany, count: attendanceCount, groupBy: attendanceGroupBy },
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const tenantContext = { tenantId: 'tenant-1' } as unknown as TenantContextService;
  const tenantFeatures = { isEnabled: jest.fn().mockResolvedValue(true) };
  const notifications = {};
  const storage = {};

  const service = new ParentPortalService(
    tenantPrisma,
    tenantContext,
    tenantFeatures as never,
    notifications as never,
    storage as never,
  );
  return { service, guardianFindMany, attendanceFindMany };
}

describe('ParentPortalService access control', () => {
  it('scopes the linked-children lookup to the authenticated user and to non-deleted students', async () => {
    const { service, guardianFindMany } = buildService([
      { id: 'g1', kind: 'FATHER', role: 'PRIMARY', studentId: 's1', student: studentRow('s1', 'Child One') },
    ]);

    const children = await service.listChildren(USER);

    expect(guardianFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', student: { deletedAt: null } } }),
    );
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ studentId: 's1', fullName: 'Child One', guardianRole: 'PRIMARY' });
  });

  it('deduplicates a student linked through more than one guardian row', async () => {
    const { service } = buildService([
      { id: 'g1', kind: 'FATHER', role: 'PRIMARY', studentId: 's1', student: studentRow('s1', 'Child One') },
      { id: 'g2', kind: 'MOTHER', role: 'SECONDARY', studentId: 's1', student: studentRow('s1', 'Child One') },
    ]);

    const children = await service.listChildren(USER);
    expect(children).toHaveLength(1);
    expect(children[0]!.guardianRole).toBe('PRIMARY');
  });

  it('refuses a user with no linked guardian rows', async () => {
    const { service } = buildService([]);
    await expect(service.resolveChild(USER, undefined)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects a studentId that is not one of the caller\'s linked children', async () => {
    const { service } = buildService([
      { id: 'g1', kind: 'FATHER', role: 'PRIMARY', studentId: 's1', student: studentRow('s1', 'Child One') },
    ]);

    await expect(service.resolveChild(USER, 's-other')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('never queries section data for an unauthorized studentId', async () => {
    const { service, attendanceFindMany } = buildService([
      { id: 'g1', kind: 'FATHER', role: 'PRIMARY', studentId: 's1', student: studentRow('s1', 'Child One') },
    ]);

    await expect(service.getAttendance(USER, { studentId: 's-other' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(attendanceFindMany).not.toHaveBeenCalled();
  });

  it('anchors an authorized section query to the resolved child id', async () => {
    const { service, attendanceFindMany } = buildService([
      { id: 'g1', kind: 'FATHER', role: 'PRIMARY', studentId: 's1', student: studentRow('s1', 'Child One') },
    ]);

    await service.getAttendance(USER, { studentId: 's1' });

    expect(attendanceFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { studentId: 's1' } }));
  });

  it('falls back to the first linked child when no studentId is supplied', async () => {
    const { service } = buildService([
      { id: 'g1', kind: 'FATHER', role: 'PRIMARY', studentId: 's1', student: studentRow('s1', 'Child One') },
      { id: 'g3', kind: 'FATHER', role: 'PRIMARY', studentId: 's2', student: studentRow('s2', 'Child Two') },
    ]);

    const child = await service.resolveChild(USER, undefined);
    expect(child.studentId).toBe('s1');
  });
});
