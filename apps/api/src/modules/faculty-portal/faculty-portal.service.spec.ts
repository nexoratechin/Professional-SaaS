/**
 * Faculty Portal — access-control tests.
 *
 * The portal's security guarantee is that a caller can only ever touch data tied to their own
 * Employee row and the course offerings they are assigned to (CourseOfferingFaculty.isActive).
 * These tests pin the three halves of that guarantee:
 *   1. an account not linked to an Employee is rejected outright,
 *   2. a courseOfferingId outside the caller's assignments is rejected *before* any section query
 *      runs, and
 *   3. an authorized roster/timetable read is anchored to the caller's assigned offering ids.
 */
import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '@college-erp/auth';
import { FacultyPortalService } from './faculty-portal.service';
import type { TenantContextService } from '../../common/prisma/tenant-context.service';
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';

const USER: AuthenticatedUser = {
  id: 'user-1',
  tenantId: 'tenant-1',
  sessionId: 'session-1',
  email: 'faculty@example.com',
  fullName: 'Faculty One',
};

const EMPLOYEE = {
  id: 'emp-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  employeeCode: 'EMP-001',
  honorific: 'Dr.',
  firstName: 'Ravi',
  middleName: null,
  lastName: 'Sharma',
  employeeType: 'FACULTY',
  employmentStatus: 'ACTIVE',
  departmentId: 'dept-1',
  designationId: null,
  campusId: 'campus-1',
  profilePhotoKey: null,
};

const ASSIGNMENT = {
  id: 'assign-1',
  role: 'PRIMARY',
  allocationPercent: 100,
  courseOfferingId: 'off-1',
  courseOffering: {
    id: 'off-1',
    code: 'CS101-A',
    status: 'OPEN',
    termId: 'term-1',
    sectionId: 'sec-1',
    campusId: 'campus-1',
    courseId: 'course-1',
    course: { id: 'course-1', code: 'CS101', name: 'Intro', creditHours: 3, courseType: 'CORE' },
    term: { id: 'term-1', code: 'T1', name: 'Term 1' },
    section: { id: 'sec-1', code: 'A', name: 'Section A' },
    program: { id: 'prog-1', code: 'BTECH', name: 'B.Tech' },
    _count: { registrations: 42 },
  },
};

interface Mocks {
  employeeFindFirst: jest.Mock;
  cofFindFirst: jest.Mock;
  cofFindMany: jest.Mock;
  registrationFindMany: jest.Mock;
  registrationCount: jest.Mock;
  offeringFindMany: jest.Mock;
  examSubjectFindFirst: jest.Mock;
  examRegistrationFindMany: jest.Mock;
  examMarksFindMany: jest.Mock;
  createSession: jest.Mock;
  markSession: jest.Mock;
  listSessions: jest.Mock;
  bulkMarks: jest.Mock;
}

function buildService(overrides: Partial<Mocks> = {}): { service: FacultyPortalService; mocks: Mocks } {
  const mocks: Mocks = {
    employeeFindFirst: jest.fn().mockResolvedValue(EMPLOYEE),
    cofFindFirst: jest.fn().mockResolvedValue(null),
    cofFindMany: jest.fn().mockResolvedValue([ASSIGNMENT]),
    registrationFindMany: jest.fn().mockResolvedValue([]),
    registrationCount: jest.fn().mockResolvedValue(0),
    offeringFindMany: jest.fn().mockResolvedValue([]),
    examSubjectFindFirst: jest.fn().mockResolvedValue(null),
    examRegistrationFindMany: jest.fn().mockResolvedValue([]),
    examMarksFindMany: jest.fn().mockResolvedValue([]),
    createSession: jest.fn().mockResolvedValue({ session: {}, roster: [] }),
    markSession: jest.fn().mockResolvedValue({ marked: 0 }),
    listSessions: jest.fn().mockResolvedValue({ data: [], total: 0 }),
    bulkMarks: jest.fn().mockResolvedValue({ upserted: 0 }),
    ...overrides,
  };

  const client = {
    employee: { findFirst: mocks.employeeFindFirst },
    courseOfferingFaculty: { findFirst: mocks.cofFindFirst, findMany: mocks.cofFindMany },
    courseRegistration: { findMany: mocks.registrationFindMany, count: mocks.registrationCount },
    courseOffering: { findMany: mocks.offeringFindMany },
    examSubject: { findFirst: mocks.examSubjectFindFirst },
    examRegistration: { findMany: mocks.examRegistrationFindMany },
    examMarksEntry: { findMany: mocks.examMarksFindMany, groupBy: jest.fn().mockResolvedValue([]) },
    timetableEntry: { findMany: jest.fn().mockResolvedValue([]) },
    timetableSubstitution: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const tenantContext = { tenantId: 'tenant-1' } as unknown as TenantContextService;
  const tenantFeatures = { isEnabled: jest.fn().mockResolvedValue(true) };
  const attendance = {
    createSession: mocks.createSession,
    markSession: mocks.markSession,
    listSessions: mocks.listSessions,
  };
  const exams = { bulkMarks: mocks.bulkMarks, bulkSubmitMarks: jest.fn() };
  const hr = { listWorkloads: jest.fn() };
  const hrLeave = { listLeaveTypes: jest.fn(), listLeaveBalances: jest.fn(), listLeaveApplications: jest.fn() };
  const notifications = {};
  const audit = { record: jest.fn() };

  const service = new FacultyPortalService(
    tenantPrisma,
    tenantContext,
    tenantFeatures as never,
    attendance as never,
    exams as never,
    hr as never,
    hrLeave as never,
    notifications as never,
    audit as never,
  );
  return { service, mocks };
}

describe('FacultyPortalService access control', () => {
  it('rejects a user with no linked employee record', async () => {
    const { service } = buildService({ employeeFindFirst: jest.fn().mockResolvedValue(null) });
    await expect(service.getProfile(USER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('anchors the linked-employee lookup to the authenticated user and non-deleted rows', async () => {
    const { service, mocks } = buildService();
    await service.resolveFaculty(USER);
    expect(mocks.employeeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', deletedAt: null } }),
    );
  });

  it('rejects a courseOfferingId the caller is not assigned to before any roster query runs', async () => {
    const { service, mocks } = buildService({ cofFindFirst: jest.fn().mockResolvedValue(null) });
    await expect(service.students(USER, { courseOfferingId: 'off-other' })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(mocks.registrationFindMany).not.toHaveBeenCalled();
  });

  it('anchors a roster read to the caller\'s assigned offering ids', async () => {
    const { service, mocks } = buildService();
    await service.students(USER, {});
    expect(mocks.registrationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ courseOfferingId: { in: ['off-1'] } }),
      }),
    );
  });

  it('refuses to create an attendance session for an unassigned offering', async () => {
    const { service, mocks } = buildService({ cofFindFirst: jest.fn().mockResolvedValue(null) });
    await expect(
      service.createAttendanceSession(USER, { date: '2026-01-01', courseOfferingId: 'off-other' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('does not expose marks for a paper the caller neither teaches nor invigilates', async () => {
    const { service, mocks } = buildService({ examSubjectFindFirst: jest.fn().mockResolvedValue(null) });
    await expect(service.marksForSubject(USER, 'sub-other', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.examMarksFindMany).not.toHaveBeenCalled();
  });

  it('exposes marks for an assigned paper', async () => {
    const { service, mocks } = buildService({
      examSubjectFindFirst: jest.fn().mockResolvedValue({
        id: 'sub-1',
        sessionId: 'session-1',
        courseId: 'course-1',
        maxMarks: 100,
        passMarks: 40,
      }),
    });
    const result = await service.marksForSubject(USER, 'sub-1', {});
    expect(result.total).toBe(0);
    expect(mocks.examMarksFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ subjectId: 'sub-1' }) }),
    );
  });
});
