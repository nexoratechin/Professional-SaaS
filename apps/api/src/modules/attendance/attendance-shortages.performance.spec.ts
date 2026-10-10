/**
 * Attendance shortage-report performance.
 *
 * The report previously fan-out one percentage() call PER roster student — each of which re-ran
 * a session scan + an attendance scan, plus a per-student scope check: ~3×N queries for an
 * N-student roster. It now resolves the roster, authorization, session set and attendance totals
 * in a FIXED number of queries regardless of roster size. This spec pins that fixed cost and the
 * correctness of the aggregation at scale.
 */
import type { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import type { AppConfigService } from '../../config/app-config.service';
import type { AuditService } from '../audit/audit.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PermissionsService } from '../rbac/permissions.service';
import type { StudentsService } from '../students/students.service';
import { AttendanceService } from './attendance.service';

const TENANT = 'tenant-1';
const USER = 'user-1';
const ROSTER_SIZE = 1_000;

function roster(size: number) {
  return Array.from({ length: size }, (_, i) => ({
    id: `student-${i}`,
    fullName: `Student ${i}`,
    rollNumber: `R${i}`,
    admissionNumber: `A${i}`,
    section: { id: 'sec-1', code: 'A' },
  }));
}

function makeService() {
  const students = roster(ROSTER_SIZE);
  // Even-indexed students: 1/2 present (50% < 75% threshold) → shortage. Odd: 2/2 → on track.
  const buckets: Array<{ studentId: string; status: string; _count: { _all: number } }> = [];
  for (let i = 0; i < ROSTER_SIZE; i += 1) {
    if (i % 2 === 0) {
      buckets.push({ studentId: `student-${i}`, status: 'PRESENT', _count: { _all: 1 } });
      buckets.push({ studentId: `student-${i}`, status: 'ABSENT', _count: { _all: 1 } });
    } else {
      buckets.push({ studentId: `student-${i}`, status: 'PRESENT', _count: { _all: 2 } });
    }
  }

  const client = {
    tenantConfiguration: { findFirst: jest.fn().mockResolvedValue(null) },
    studentEnrollment: {
      findMany: jest.fn().mockResolvedValue(students.map((s) => ({ student: s }))),
    },
    attendanceSession: { findMany: jest.fn().mockResolvedValue([{ id: 'sess-1' }, { id: 'sess-2' }]) },
    studentAttendance: {
      groupBy: jest.fn().mockResolvedValue(buckets),
      findMany: jest.fn(),
    },
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const auditService = { record: jest.fn() } as unknown as AuditService;
  const permissionsService = {
    getScopeGrantsFor: jest.fn().mockResolvedValue([{ scopeType: 'GLOBAL' }]),
  } as unknown as PermissionsService;
  const notifications = { sendSystem: jest.fn() } as unknown as NotificationsService;
  const studentsService = {
    assertStudentInScope: jest.fn().mockResolvedValue(undefined),
    filterIdsInScope: jest.fn().mockImplementation(async (ids: string[]) => new Set(ids)),
  } as unknown as StudentsService;
  const appConfig = {} as AppConfigService;
  const service = new AttendanceService(tenantPrisma, auditService, permissionsService, notifications, studentsService, appConfig);
  return { service, client, studentsService };
}

describe('AttendanceService.shortages performance', () => {
  it('resolves a 1,000-student roster in a fixed number of queries (no N+1)', async () => {
    const { service, client, studentsService } = makeService();

    const start = Date.now();
    const result = await service.shortages(TENANT, USER, { sectionId: 'sec-1' });
    const elapsed = Date.now() - start;

    // Exactly half the roster is below the 75% threshold.
    expect(result.total).toBe(ROSTER_SIZE / 2);
    expect(result.data).toHaveLength(ROSTER_SIZE / 2);

    // Fixed query cost: roster + session set + one aggregate + one batched scope check.
    expect(client.studentEnrollment.findMany).toHaveBeenCalledTimes(1);
    expect(client.attendanceSession.findMany).toHaveBeenCalledTimes(1);
    expect(client.studentAttendance.groupBy).toHaveBeenCalledTimes(1);
    expect(studentsService.filterIdsInScope).toHaveBeenCalledTimes(1);
    // The old implementation's per-student attendance read is gone entirely.
    expect(client.studentAttendance.findMany).not.toHaveBeenCalled();

    // Sorted by ascending percentage and well within a generous wall-clock budget.
    expect(result.data[0]).toMatchObject({ percentage: 50 });
    expect(elapsed).toBeLessThan(2_000);
  });
});
