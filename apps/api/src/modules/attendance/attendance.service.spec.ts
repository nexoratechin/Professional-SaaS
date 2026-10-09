/**
 * AttendanceService rule/threshold behaviour — reports are pure derivations over
 * tenantConfiguration (thresholdPercent) + attendance rows, so they are exercised with a mocked
 * tenant-scoped client. Verifies the WARNING band, LEAVE-is-not-attended rule and the summary
 * grouping/status rules (NO_MARKS vs ON_TRACK vs SHORTAGE).
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
const STUDENT = 'student-1';

function makeService(clientOverrides: Record<string, unknown> = {}, attendanceConfig: unknown = undefined) {
  const client = {
    tenantConfiguration: {
      findFirst: jest.fn().mockResolvedValue(attendanceConfig === undefined ? null : { data: { attendance: attendanceConfig } }),
    },
    attendanceSession: { findMany: jest.fn().mockResolvedValue([]) },
    studentAttendance: { findMany: jest.fn().mockResolvedValue([]) },
    ...clientOverrides,
  };
  const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
  const auditService = { record: jest.fn() } as unknown as AuditService;
  const permissionsService = {
    getScopeGrantsFor: jest.fn().mockResolvedValue([{ scopeType: 'GLOBAL' }]),
  } as unknown as PermissionsService;
  const notifications = { sendSystem: jest.fn() } as unknown as NotificationsService;
  const studentsService = { assertStudentInScope: jest.fn().mockResolvedValue(undefined) } as unknown as StudentsService;
  const appConfig = {} as AppConfigService;
  const service = new AttendanceService(tenantPrisma, auditService, permissionsService, notifications, studentsService, appConfig);
  return { service, client, studentsService };
}

describe('AttendanceService.percentage', () => {
  it('rounds to two decimals and treats LATE as attended, LEAVE as not attended', async () => {
    const { service, client } = makeService();
    client.attendanceSession.findMany.mockResolvedValue([{ id: 's1' }, { id: 's2' }, { id: 's3' }, { id: 's4' }]);
    client.studentAttendance.findMany.mockResolvedValue([
      { status: 'PRESENT' },
      { status: 'PRESENT' },
      { status: 'LATE' },
      { status: 'LEAVE' },
      { status: 'ABSENT' },
    ]);

    const result = await service.percentage(TENANT, USER, { studentId: STUDENT });
    expect(result).toMatchObject({
      studentId: STUDENT,
      totalSessions: 5,
      present: 2,
      late: 1,
      absent: 1,
      leave: 1,
      attended: 3,
      percentage: 60,
      requiredPercent: 75,
      status: 'SHORTAGE',
    });
    expect(client.studentAttendance.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, studentId: STUDENT, sessionId: { in: ['s1', 's2', 's3', 's4'] } },
      select: { status: true },
    });
  });

  it('reports ON_TRACK exactly at the threshold and WARNING within 90% of it', async () => {
    // 3/4 = 75% => ON_TRACK at the default 75% threshold.
    const onTrack = makeService();
    onTrack.client.attendanceSession.findMany.mockResolvedValue([{ id: 's1' }]);
    onTrack.client.studentAttendance.findMany.mockResolvedValue([
      { status: 'PRESENT' },
      { status: 'PRESENT' },
      { status: 'LATE' },
      { status: 'ABSENT' },
    ]);
    await expect(onTrack.service.percentage(TENANT, USER, { studentId: STUDENT })).resolves.toMatchObject({
      percentage: 75,
      status: 'ON_TRACK',
    });

    // 7/10 = 70% => below 75 but >= 67.5 => WARNING.
    const warning = makeService();
    warning.client.attendanceSession.findMany.mockResolvedValue([{ id: 's1' }]);
    warning.client.studentAttendance.findMany.mockResolvedValue([
      ...Array.from({ length: 7 }, () => ({ status: 'PRESENT' })),
      ...Array.from({ length: 3 }, () => ({ status: 'ABSENT' })),
    ]);
    await expect(warning.service.percentage(TENANT, USER, { studentId: STUDENT })).resolves.toMatchObject({
      percentage: 70,
      status: 'WARNING',
    });
  });

  it('is ON_TRACK with zero sessions', async () => {
    const { service } = makeService();
    const result = await service.percentage(TENANT, USER, { studentId: STUDENT });
    expect(result).toMatchObject({ totalSessions: 0, percentage: 0, status: 'ON_TRACK' });
  });

  it('honours a tenant-configured threshold', async () => {
    const { service, client } = makeService({}, { thresholdPercent: 90, requiredPerSubject: true });
    client.attendanceSession.findMany.mockResolvedValue([{ id: 's1' }]);
    client.studentAttendance.findMany.mockResolvedValue([
      { status: 'PRESENT' },
      { status: 'PRESENT' },
      { status: 'PRESENT' },
      { status: 'ABSENT' },
    ]);
    const result = await service.percentage(TENANT, USER, { studentId: STUDENT });
    expect(result.requiredPercent).toBe(90);
    expect(result.percentage).toBe(75);
    // 75 is below 90*0.9 = 81 => SHORTAGE.
    expect(result.status).toBe('SHORTAGE');
  });

  it('enforces student scope before reporting', async () => {
    const { service, studentsService } = makeService();
    await service.percentage(TENANT, USER, { studentId: STUDENT });
    expect(studentsService.assertStudentInScope).toHaveBeenCalledWith(STUDENT, TENANT, USER);
  });
});

describe('AttendanceService.summary', () => {
  it('groups by subject and applies NO_MARKS / ON_TRACK / SHORTAGE status', async () => {
    const { service, client } = makeService();
    client.attendanceSession.findMany.mockResolvedValue([
      { id: 'm1', subjectCode: 'MATH', subjectName: 'Mathematics', records: [{ status: 'PRESENT' }, { status: 'PRESENT' }, { status: 'ABSENT' }] },
      { id: 'm2', subjectCode: 'MATH', subjectName: 'Mathematics', records: [{ status: 'PRESENT' }] },
      { id: 's1', subjectCode: 'SCI', subjectName: 'Science', records: [{ status: 'PRESENT' }, { status: 'LATE' }] },
      { id: 'e1', subjectCode: 'ENG', subjectName: 'English', records: [{ status: 'ABSENT' }] },
      { id: 'x1', subjectCode: 'PHY', subjectName: 'Physics', records: [] },
    ]);

    const result = await service.summary(TENANT, USER, {});
    expect(result.total).toBe(3);
    // Sorted by session count descending: MATH (2) first.
    expect(result.data[0]).toMatchObject({
      subjectCode: 'MATH',
      sessions: 2,
      present: 3,
      absent: 1,
      totalMarked: 4,
      attended: 3,
      percentage: 75,
      status: 'ON_TRACK',
    });
    const sci = result.data.find((row) => row.subjectCode === 'SCI');
    expect(sci).toMatchObject({ sessions: 1, attended: 2, percentage: 100, status: 'ON_TRACK' });
    const eng = result.data.find((row) => row.subjectCode === 'ENG');
    expect(eng).toMatchObject({ attended: 0, percentage: 0, status: 'NO_MARKS' });
    // The record-less session is skipped entirely.
    expect(result.data.find((row) => row.subjectCode === 'PHY')).toBeUndefined();
  });
});
