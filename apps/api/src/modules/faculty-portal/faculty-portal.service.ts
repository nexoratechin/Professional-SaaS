/**
 * Faculty Portal service — a self-service composition layer over the existing domain modules.
 *
 * It introduces NO new tables and NO parallel business logic:
 *   • The single access-control anchor is the caller's own Employee row (Employee.userId =
 *     authenticated user id). Every read/write is therefore constrained to that employee and to
 *     the course offerings they are assigned to via CourseOfferingFaculty (and the students
 *     registered in those offerings). A caller with no linked employee gets 403.
 *   • Writes reuse the owning module's service where one exists and is safe to call for the
 *     caller: AttendanceService (session lifecycle + bulk marking), ExamsService (marks entry and
 *     submission), HrLeaveService (leave application creation/listing, balances, catalogue) and
 *     HrService (workload, employee profile). Marks/subject ownership is verified here before
 *     delegating because the exams module's OWN scope is student-anchored, not offering-anchored.
 *   • Reads that have no owning service entry point (assigned courses, rosters, timetable,
 *     attendance reports, faculty reports) go directly through the tenant-guarded Prisma client,
 *     always anchored to the resolved employee.
 *
 * Feature flags are honoured per section via TenantFeaturesService so a plan that excludes a
 * module never serves that module's data through the portal.
 */
import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  FEATURE_KEYS,
  type AuthenticatedUser,
  type FeatureKey,
} from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { TenantFeaturesService } from '../rbac/tenant-features.service';
import { AuditService } from '../audit/audit.service';
import { AttendanceService } from '../attendance/attendance.service';
import { ExamsService } from '../exams/exams.service';
import { HrService } from '../hr/hr.service';
import { HrLeaveService } from '../hr/hr-leave.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  FacultyAttendanceQueryDto,
  FacultyBulkMarksDto,
  FacultyCreateAttendanceSessionDto,
  FacultyLeaveApplicationDto,
  FacultyLeaveQueryDto,
  FacultyMarkAttendanceDto,
  FacultyMarksQueryDto,
  FacultyPaginationDto,
  FacultyReportQueryDto,
  FacultyStudentsQueryDto,
  UpdateFacultyProfileDto,
} from './dto/faculty-portal.dto';

/** Minimal projection of the caller's Employee row used throughout the portal. */
interface LinkedFaculty {
  id: string;
  tenantId: string;
  userId: string | null;
  employeeCode: string;
  honorific: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  employeeType: string;
  employmentStatus: string;
  departmentId: string;
  designationId: string | null;
  campusId: string | null;
  profilePhotoKey: string | null;
}

const EDITABLE_PROFILE_FIELDS = [
  'honorific',
  'phone',
  'alternatePhone',
  'personalEmail',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'country',
  'emergencyContactName',
  'emergencyContactPhone',
  'emergencyContactRelation',
  'qualification',
  'specialization',
  'profilePhotoKey',
] as const;

function minutesOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return null;
  return hours * 60 + minutes;
}

function hoursBetween(start: string | null | undefined, end: string | null | undefined): number {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from === null || to === null || to <= from) return 0;
  return (to - from) / 60;
}

@Injectable()
export class FacultyPortalService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly tenantFeatures: TenantFeaturesService,
    private readonly attendance: AttendanceService,
    private readonly exams: ExamsService,
    private readonly hr: HrService,
    private readonly hrLeave: HrLeaveService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
  ) {}

  private tid(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) throw new ForbiddenException('Tenant context could not be established.');
    return tenantId;
  }

  private page(query: FacultyPaginationDto, defaultTake = 50): { skip: number; take: number } {
    const take = Math.min(query.take ?? defaultTake, 200);
    return { skip: query.skip ?? 0, take };
  }

  /** Runs a section query only when the tenant's plan enables the module. */
  private async section<T>(feature: FeatureKey, fn: () => Promise<T>): Promise<T | null> {
    const enabled = await this.tenantFeatures.isEnabled(this.tid(), feature);
    return enabled ? fn() : null;
  }

  private displayName(employee: {
    honorific: string | null;
    firstName: string;
    middleName?: string | null;
    lastName: string;
  }): string {
    return [employee.honorific, employee.firstName, employee.middleName, employee.lastName]
      .filter((part): part is string => Boolean(part && part.trim()))
      .join(' ');
  }

  /** Resolves the Employee row linked to the authenticated user, or 403 when none exists. This is
   *  the single access-control anchor for every portal read/write. */
  async resolveFaculty(user: AuthenticatedUser): Promise<LinkedFaculty> {
    const employee = await this.tenantPrisma.client.employee.findFirst({
      where: { userId: user.id, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        tenantId: true,
        userId: true,
        employeeCode: true,
        honorific: true,
        firstName: true,
        middleName: true,
        lastName: true,
        employeeType: true,
        employmentStatus: true,
        departmentId: true,
        designationId: true,
        campusId: true,
        profilePhotoKey: true,
      },
    });
    if (!employee) {
      throw new ForbiddenException(
        'Your account is not linked to an employee record. Please contact the HR office.',
      );
    }
    return employee as LinkedFaculty;
  }

  // ── Course assignments (the scope anchor) ──────────────────────────────────

  private async assignedOfferings(userId: string) {
    return this.tenantPrisma.client.courseOfferingFaculty.findMany({
      where: { userId, isActive: true, courseOffering: { deletedAt: null } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        role: true,
        allocationPercent: true,
        courseOfferingId: true,
        courseOffering: {
          select: {
            id: true,
            code: true,
            status: true,
            termId: true,
            sectionId: true,
            campusId: true,
            courseId: true,
            course: { select: { id: true, code: true, name: true, creditHours: true, courseType: true } },
            term: { select: { id: true, code: true, name: true } },
            section: { select: { id: true, code: true, name: true } },
            program: { select: { id: true, code: true, name: true } },
            _count: { select: { registrations: true } },
          },
        },
      },
    });
  }

  private async assignedOfferingIds(userId: string): Promise<string[]> {
    const rows = await this.assignedOfferings(userId);
    return rows.map((row) => row.courseOfferingId);
  }

  private async assignedCourseIds(userId: string): Promise<string[]> {
    const rows = await this.assignedOfferings(userId);
    return [...new Set(rows.map((row) => row.courseOffering.courseId))];
  }

  /** Throws 403 unless the offering is one the caller is actively assigned to. */
  private async assertOffering(userId: string, offeringId: string) {
    const row = await this.tenantPrisma.client.courseOfferingFaculty.findFirst({
      where: {
        userId,
        isActive: true,
        courseOfferingId: offeringId,
        courseOffering: { deletedAt: null },
      },
      select: {
        courseOffering: {
          select: { id: true, courseId: true, sectionId: true, termId: true, campusId: true },
        },
      },
    });
    if (!row) {
      throw new ForbiddenException('You are not assigned to this course offering.');
    }
    return row.courseOffering;
  }

  // ── Dashboard ───────────────────────────────────────────────────────────────

  async dashboard(user: AuthenticatedUser) {
    const faculty = await this.resolveFaculty(user);
    const [courses, timetable, attendance, marks, leave, workload, notices, reports] = await Promise.all([
      this.section(FEATURE_KEYS.ACADEMICS, () => this.listAssignedCourses(faculty)),
      this.section(FEATURE_KEYS.TIMETABLE, () => this.timetableSummary(faculty.userId as string)),
      this.section(FEATURE_KEYS.ATTENDANCE, () => this.attendanceOverview(faculty.userId as string)),
      this.section(FEATURE_KEYS.EXAMS, () => this.marksSummary(faculty.userId as string)),
      this.section(FEATURE_KEYS.HR, () => this.leaveOverview(user, faculty)),
      this.section(FEATURE_KEYS.HR, () => this.workloadOverview(user, faculty)),
      this.section(FEATURE_KEYS.NOTIFICATIONS, () => this.noticesOverview(user)),
      this.section(FEATURE_KEYS.REPORTS, () => this.reportsOverview(user, {})),
    ]);

    return {
      faculty: {
        id: faculty.id,
        employeeCode: faculty.employeeCode,
        fullName: this.displayName(faculty),
        employeeType: faculty.employeeType,
        employmentStatus: faculty.employmentStatus,
      },
      courses,
      timetable,
      attendance,
      marks,
      leave,
      workload,
      notices,
      reports,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Profile ────────────────────────────────────────────────────────────────

  async getProfile(user: AuthenticatedUser) {
    const faculty = await this.resolveFaculty(user);
    const row = await this.tenantPrisma.client.employee.findFirst({
      where: { id: faculty.id },
      include: {
        department: { select: { id: true, code: true, name: true } },
        designation: { select: { id: true, code: true, name: true } },
        campus: { select: { id: true, code: true, name: true } },
        user: { select: { id: true, email: true, fullName: true, status: true } },
      },
    });
    if (!row) throw new NotFoundException('Employee profile not found.');
    return { ...row, displayName: this.displayName(row) };
  }

  async updateProfile(user: AuthenticatedUser, dto: UpdateFacultyProfileDto) {
    const faculty = await this.resolveFaculty(user);
    const data: Prisma.EmployeeUpdateInput = { updatedBy: user.id };
    const source = dto as Record<string, unknown>;
    for (const field of EDITABLE_PROFILE_FIELDS) {
      const value = source[field];
      if (value !== undefined) {
        (data as Record<string, unknown>)[field] = value === null ? null : String(value);
      }
    }
    await this.tenantPrisma.client.employee.update({ where: { id: faculty.id }, data });
    await this.audit.record({
      scope: 'TENANT',
      tenantId: this.tid(),
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.EMPLOYEE_UPDATED,
      module: AUDIT_MODULES.HR,
      entityType: 'Employee',
      entityId: faculty.id,
      after: { source: 'FACULTY_PORTAL' },
    });
    return this.getProfile(user);
  }

  // ── Assigned courses / students ────────────────────────────────────────────

  async listAssignedCourses(faculty: LinkedFaculty) {
    const assignments = await this.assignedOfferings(faculty.userId as string);
    return assignments.map((assignment) => ({
      assignmentId: assignment.id,
      role: assignment.role,
      allocationPercent: assignment.allocationPercent,
      offering: assignment.courseOffering,
      studentCount: assignment.courseOffering._count.registrations,
    }));
  }

  async courses(user: AuthenticatedUser) {
    const faculty = await this.resolveFaculty(user);
    const courses = await this.listAssignedCourses(faculty);
    return { courses, total: courses.length };
  }

  async students(user: AuthenticatedUser, query: FacultyStudentsQueryDto) {
    const faculty = await this.resolveFaculty(user);
    const offeringIds = query.courseOfferingId
      ? [(await this.assertOffering(faculty.userId as string, query.courseOfferingId)).id]
      : await this.assignedOfferingIds(faculty.userId as string);
    if (offeringIds.length === 0) {
      return { students: [], total: 0, offerings: [] };
    }

    const where: Prisma.CourseRegistrationWhereInput = {
      courseOfferingId: { in: offeringIds },
      status: { in: ['REGISTERED', 'CONFIRMED'] },
      ...(query.search
        ? {
            student: {
              OR: [
                { fullName: { contains: query.search, mode: 'insensitive' } },
                { admissionNumber: { contains: query.search, mode: 'insensitive' } },
                { rollNumber: { contains: query.search, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };

    const { skip, take } = this.page(query);
    const [rows, total, offerings] = await Promise.all([
      this.tenantPrisma.client.courseRegistration.findMany({
        where,
        orderBy: { enrolledAt: 'desc' },
        skip,
        take,
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              admissionNumber: true,
              rollNumber: true,
              status: true,
              profilePhotoKey: true,
              userId: true,
            },
          },
          courseOffering: {
            select: {
              id: true,
              code: true,
              course: { select: { id: true, code: true, name: true } },
              section: { select: { id: true, code: true, name: true } },
              term: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
      this.tenantPrisma.client.courseRegistration.count({ where }),
      this.tenantPrisma.client.courseOffering.findMany({
        where: { id: { in: offeringIds } },
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          course: { select: { id: true, code: true, name: true } },
          section: { select: { id: true, code: true, name: true } },
          term: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);

    return { students: rows, total, offerings };
  }

  // ── Timetable ──────────────────────────────────────────────────────────────

  private async assignedTimetableEntries(userId: string) {
    return this.tenantPrisma.client.timetableEntry.findMany({
      where: { assignedUserId: userId, timetable: { status: 'PUBLISHED', deletedAt: null } },
      orderBy: [{ dayOfWeek: 'asc' }, { period: { sequence: 'asc' } }],
      include: {
        period: { select: { id: true, sequence: true, startTime: true, endTime: true, isBreak: true } },
        room: { select: { id: true, code: true, name: true } },
        section: { select: { id: true, code: true, name: true } },
        timetable: { select: { id: true, name: true, status: true } },
        courseOffering: {
          include: {
            course: { select: { id: true, code: true, name: true, creditHours: true } },
            term: { select: { id: true, code: true, name: true } },
          },
        },
      },
    });
  }

  private async substitutionsFor(userId: string) {
    return this.tenantPrisma.client.timetableSubstitution.findMany({
      where: { substituteUserId: userId, status: { in: ['REQUESTED', 'APPROVED', 'EXECUTED'] } },
      orderBy: { effectiveDate: 'asc' },
      include: {
        timetable: { select: { id: true, name: true } },
        entry: {
          include: {
            period: { select: { id: true, sequence: true, startTime: true, endTime: true } },
            section: { select: { id: true, code: true, name: true } },
            courseOffering: { include: { course: { select: { id: true, code: true, name: true } } } },
          },
        },
      },
    });
  }

  async timetable(user: AuthenticatedUser) {
    const faculty = await this.resolveFaculty(user);
    const [entries, substitutions] = await Promise.all([
      this.assignedTimetableEntries(faculty.userId as string),
      this.substitutionsFor(faculty.userId as string),
    ]);
    return { entries, substitutions, total: entries.length };
  }

  private async timetableSummary(userId: string) {
    const entries = await this.assignedTimetableEntries(userId);
    const today = new Date().getDay();
    return {
      weeklyClasses: entries.length,
      todayClasses: entries.filter((entry) => entry.dayOfWeek === today).length,
      teachingHoursPerWeek:
        Math.round(
          entries.reduce((sum, entry) => sum + hoursBetween(entry.period?.startTime, entry.period?.endTime), 0) * 100,
        ) / 100,
    };
  }

  // ── Attendance ─────────────────────────────────────────────────────────────

  async attendanceSessions(user: AuthenticatedUser, query: FacultyAttendanceQueryDto) {
    const faculty = await this.resolveFaculty(user);
    if (query.courseOfferingId) {
      await this.assertOffering(faculty.userId as string, query.courseOfferingId);
    }
    return this.attendance.listSessions(this.tid(), user.id, {
      termId: query.termId,
      courseOfferingId: query.courseOfferingId,
      status: query.status,
      dateFrom: query.dateFrom,
      dateTo: query.dateTo,
      skip: query.skip,
      take: query.take,
      myOnly: 'true',
    });
  }

  async createAttendanceSession(user: AuthenticatedUser, dto: FacultyCreateAttendanceSessionDto) {
    const faculty = await this.resolveFaculty(user);
    const offering = await this.assertOffering(faculty.userId as string, dto.courseOfferingId);
    return this.attendance.createSession(this.tid(), user.id, {
      date: dto.date,
      termId: offering.termId ?? undefined,
      courseOfferingId: dto.courseOfferingId,
      sectionId: offering.sectionId ?? undefined,
      timetableEntryId: dto.timetableEntryId,
      title: dto.title,
      notes: dto.notes,
      startTime: dto.startTime,
      endTime: dto.endTime,
      subjectCode: dto.subjectCode,
      subjectName: dto.subjectName,
      markMethod: dto.markMethod,
    });
  }

  async getAttendanceSession(user: AuthenticatedUser, id: string) {
    await this.resolveFaculty(user);
    return this.attendance.getSession(this.tid(), user.id, id);
  }

  async markAttendanceSession(user: AuthenticatedUser, id: string, dto: FacultyMarkAttendanceDto) {
    await this.resolveFaculty(user);
    return this.attendance.markSession(this.tid(), user.id, id, {
      entries: dto.entries,
      markMethod: dto.markMethod,
    });
  }

  async closeAttendanceSession(user: AuthenticatedUser, id: string) {
    await this.resolveFaculty(user);
    return this.attendance.closeSession(this.tid(), user.id, id);
  }

  private async attendanceOverview(userId: string) {
    const offeringIds = await this.assignedOfferingIds(userId);
    if (offeringIds.length === 0) {
      return { offerings: 0, sessions: 0, openSessions: 0, todaySessions: 0, marked: 0, percentage: null };
    }
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + 86_400_000);

    const [sessions, openSessions, todaySessions, grouped] = await Promise.all([
      this.tenantPrisma.client.attendanceSession.count({
        where: { courseOfferingId: { in: offeringIds }, deletedAt: null },
      }),
      this.tenantPrisma.client.attendanceSession.count({
        where: { courseOfferingId: { in: offeringIds }, deletedAt: null, status: 'OPEN' },
      }),
      this.tenantPrisma.client.attendanceSession.count({
        where: {
          courseOfferingId: { in: offeringIds },
          deletedAt: null,
          date: { gte: startOfDay, lt: endOfDay },
        },
      }),
      this.tenantPrisma.client.studentAttendance.groupBy({
        by: ['status'],
        where: { session: { courseOfferingId: { in: offeringIds } } },
        _count: { _all: true },
      }),
    ]);

    const counts: Record<string, number> = { PRESENT: 0, ABSENT: 0, LATE: 0, LEAVE: 0 };
    for (const row of grouped) counts[row.status] = row._count._all;
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    const presentLike = (counts.PRESENT ?? 0) + (counts.LATE ?? 0);

    return {
      offerings: offeringIds.length,
      sessions,
      openSessions,
      todaySessions,
      marked: total,
      percentage: total ? Math.round((presentLike / total) * 1000) / 10 : null,
    };
  }

  async attendanceReport(user: AuthenticatedUser, query: FacultyReportQueryDto) {
    const faculty = await this.resolveFaculty(user);
    const offeringIds = query.courseOfferingId
      ? [(await this.assertOffering(faculty.userId as string, query.courseOfferingId)).id]
      : await this.assignedOfferingIds(faculty.userId as string);
    if (offeringIds.length === 0) {
      return { rows: [], bySubject: [], summary: null };
    }

    const sessions = await this.tenantPrisma.client.attendanceSession.findMany({
      where: {
        courseOfferingId: { in: offeringIds },
        deletedAt: null,
        ...(query.termId ? { termId: query.termId } : {}),
      },
      select: {
        id: true,
        courseOfferingId: true,
        subjectCode: true,
        subjectName: true,
        records: { select: { studentId: true, status: true } },
      },
    });

    const perStudent = new Map<string, { present: number; late: number; absent: number; leave: number; total: number }>();
    const bySubject = new Map<
      string,
      { subjectCode: string; subjectName: string; sessions: number; present: number; late: number; absent: number; leave: number }
    >();

    for (const session of sessions) {
      const subjectKey = session.subjectCode ?? session.subjectName ?? 'general';
      const subject =
        bySubject.get(subjectKey) ??
        {
          subjectCode: session.subjectCode ?? '',
          subjectName: session.subjectName ?? '',
          sessions: 0,
          present: 0,
          late: 0,
          absent: 0,
          leave: 0,
        };
      if (session.records.length > 0) subject.sessions += 1;
      for (const record of session.records) {
        const bucket =
          perStudent.get(record.studentId) ?? { present: 0, late: 0, absent: 0, leave: 0, total: 0 };
        bucket.total += 1;
        if (record.status === 'PRESENT') {
          bucket.present += 1;
          subject.present += 1;
        } else if (record.status === 'LATE') {
          bucket.late += 1;
          subject.late += 1;
        } else if (record.status === 'LEAVE') {
          bucket.leave += 1;
          subject.leave += 1;
        } else {
          bucket.absent += 1;
          subject.absent += 1;
        }
        perStudent.set(record.studentId, bucket);
      }
      bySubject.set(subjectKey, subject);
    }

    const studentIds = [...perStudent.keys()];
    const students = studentIds.length
      ? await this.tenantPrisma.client.student.findMany({
          where: { id: { in: studentIds } },
          select: {
            id: true,
            fullName: true,
            admissionNumber: true,
            rollNumber: true,
            section: { select: { id: true, code: true, name: true } },
          },
        })
      : [];

    const rows = students
      .map((student) => {
        const metrics = perStudent.get(student.id) ?? { present: 0, late: 0, absent: 0, leave: 0, total: 0 };
        const presentLike = metrics.present + metrics.late;
        return {
          student,
          ...metrics,
          attended: presentLike,
          percentage: metrics.total ? Math.round((presentLike / metrics.total) * 1000) / 10 : 0,
        };
      })
      .sort((a, b) => a.percentage - b.percentage);

    const bySubjectRows = [...bySubject.values()].map((subject) => {
      const total = subject.present + subject.late + subject.absent + subject.leave;
      const presentLike = subject.present + subject.late;
      return {
        ...subject,
        totalMarked: total,
        attended: presentLike,
        percentage: total ? Math.round((presentLike / total) * 1000) / 10 : 0,
      };
    });

    const totals = rows.reduce(
      (acc, row) => {
        acc.present += row.present;
        acc.late += row.late;
        acc.absent += row.absent;
        acc.leave += row.leave;
        acc.total += row.total;
        return acc;
      },
      { present: 0, late: 0, absent: 0, leave: 0, total: 0 },
    );
    const presentLike = totals.present + totals.late;

    return {
      rows,
      bySubject: bySubjectRows,
      summary: {
        ...totals,
        attended: presentLike,
        percentage: totals.total ? Math.round((presentLike / totals.total) * 1000) / 10 : null,
        sessions: sessions.length,
        students: rows.length,
      },
    };
  }

  // ── Marks entry ────────────────────────────────────────────────────────────

  private async assignedSubjects(userId: string) {
    const courseIds = await this.assignedCourseIds(userId);
    return this.tenantPrisma.client.examSubject.findMany({
      where: {
        OR: [{ courseId: { in: courseIds } }, { invigilatorAssignments: { some: { userId } } }],
      },
      orderBy: [{ examDate: 'asc' }, { createdAt: 'asc' }],
      include: {
        session: { select: { id: true, name: true, code: true, examType: true, status: true, termId: true } },
        course: { select: { id: true, code: true, name: true } },
        _count: { select: { marksEntries: true } },
      },
    });
  }

  /** Throws 403 unless the paper's course is one the caller teaches or they invigilate it. */
  private async assertSubject(userId: string, subjectId: string) {
    const courseIds = await this.assignedCourseIds(userId);
    const subject = await this.tenantPrisma.client.examSubject.findFirst({
      where: {
        id: subjectId,
        OR: [{ courseId: { in: courseIds } }, { invigilatorAssignments: { some: { userId } } }],
      },
      select: { id: true, sessionId: true, courseId: true, maxMarks: true, passMarks: true },
    });
    if (!subject) {
      throw new ForbiddenException('This exam paper is not assigned to you.');
    }
    return subject;
  }

  async marksSubjects(user: AuthenticatedUser) {
    const faculty = await this.resolveFaculty(user);
    const subjects = await this.assignedSubjects(faculty.userId as string);
    return { subjects, total: subjects.length };
  }

  async marksForSubject(user: AuthenticatedUser, subjectId: string, query: FacultyMarksQueryDto) {
    const faculty = await this.resolveFaculty(user);
    const subject = await this.assertSubject(faculty.userId as string, subjectId);

    const [registrations, entries] = await Promise.all([
      this.tenantPrisma.client.examRegistration.findMany({
        where: { sessionId: subject.sessionId, status: { in: ['REGISTERED', 'CONFIRMED'] } },
        orderBy: { student: { rollNumber: 'asc' } },
        include: {
          student: {
            select: {
              id: true,
              fullName: true,
              admissionNumber: true,
              rollNumber: true,
              section: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
      this.tenantPrisma.client.examMarksEntry.findMany({
        where: { subjectId, ...(query.status ? { status: query.status as never } : {}) },
        include: { registration: { select: { id: true, studentId: true } } },
      }),
    ]);

    const entryByRegistration = new Map(entries.map((entry) => [entry.registrationId, entry]));
    const search = query.search?.trim().toLowerCase();
    let rows = registrations.map((registration) => ({
      registrationId: registration.id,
      studentId: registration.studentId,
      student: registration.student,
      marks: entryByRegistration.get(registration.id) ?? null,
    }));
    if (search) {
      rows = rows.filter(
        (row) =>
          row.student.fullName.toLowerCase().includes(search) ||
          row.student.admissionNumber.toLowerCase().includes(search) ||
          (row.student.rollNumber ?? '').toLowerCase().includes(search),
      );
    }

    const { skip, take } = this.page(query, 200);
    const paged = rows.slice(skip, skip + take);

    const statusCounts: Record<string, number> = {};
    for (const entry of entries) statusCounts[entry.status] = (statusCounts[entry.status] ?? 0) + 1;

    return {
      subject,
      rows: paged,
      total: rows.length,
      counts: statusCounts,
    };
  }

  async bulkMarks(user: AuthenticatedUser, subjectId: string, dto: FacultyBulkMarksDto) {
    const faculty = await this.resolveFaculty(user);
    await this.assertSubject(faculty.userId as string, subjectId);
    return this.exams.bulkMarks(this.tid(), user.id, subjectId, { entries: dto.entries });
  }

  async submitMarks(user: AuthenticatedUser, subjectId: string) {
    const faculty = await this.resolveFaculty(user);
    await this.assertSubject(faculty.userId as string, subjectId);
    return this.exams.bulkSubmitMarks(this.tid(), user.id, subjectId);
  }

  private async marksSummary(userId: string) {
    const subjects = await this.assignedSubjects(userId);
    const subjectIds = subjects.map((subject) => subject.id);
    const grouped = subjectIds.length
      ? await this.tenantPrisma.client.examMarksEntry.groupBy({
          by: ['status'],
          where: { subjectId: { in: subjectIds } },
          _count: { _all: true },
        })
      : [];
    const counts: Record<string, number> = { DRAFT: 0, SUBMITTED: 0, MODERATED: 0, APPROVED: 0 };
    for (const row of grouped) counts[row.status] = row._count._all;
    return {
      papers: subjects.length,
      entries: Object.values(counts).reduce((sum, value) => sum + value, 0),
      drafts: counts.DRAFT ?? 0,
      submitted: counts.SUBMITTED ?? 0,
      approved: counts.APPROVED ?? 0,
    };
  }

  // ── Assignments & academic information ─────────────────────────────────────

  async academics(user: AuthenticatedUser) {
    const faculty = await this.resolveFaculty(user);
    const [courses, invigilation, advising, calendar] = await Promise.all([
      this.listAssignedCourses(faculty),
      this.tenantPrisma.client.examInvigilatorAssignment.findMany({
        where: { userId: faculty.userId as string },
        orderBy: { createdAt: 'desc' },
        include: {
          subject: {
            include: {
              session: { select: { id: true, name: true, code: true, examType: true } },
              course: { select: { id: true, code: true, name: true } },
            },
          },
          room: { select: { id: true, code: true, name: true } },
        },
      }),
      this.tenantPrisma.client.academicAdvisingRecord.findMany({
        where: { advisorUserId: faculty.userId as string },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
          term: { select: { id: true, code: true, name: true } },
        },
      }),
      this.tenantPrisma.client.academicCalendarEvent.findMany({
        where: { isPublished: true },
        orderBy: { startAt: 'asc' },
        take: 50,
        include: {
          academicYear: { select: { id: true, name: true } },
          term: { select: { id: true, code: true, name: true } },
        },
      }),
    ]);
    return { courses, invigilation, advising, calendar };
  }

  // ── Leave ──────────────────────────────────────────────────────────────────

  private async leaveOverview(user: AuthenticatedUser, faculty: LinkedFaculty, query: FacultyLeaveQueryDto = {}) {
    const [types, balances, applications] = await Promise.all([
      this.hrLeave.listLeaveTypes(),
      this.hrLeave.listLeaveBalances(this.tid(), user, { employeeId: faculty.id }),
      this.hrLeave.listLeaveApplications(this.tid(), user, {
        employeeId: faculty.id,
        status: query.status,
        leaveTypeId: query.leaveTypeId,
        skip: query.skip,
        take: query.take,
      }),
    ]);
    const pending = applications.data.filter((application) => application.status === 'PENDING').length;
    const approved = applications.data.filter((application) => application.status === 'APPROVED').length;
    return {
      types,
      balances: balances.data,
      applications: applications.data,
      total: applications.total,
      pending,
      approved,
      year: new Date().getFullYear(),
    };
  }

  async leave(user: AuthenticatedUser, query: FacultyLeaveQueryDto) {
    const faculty = await this.resolveFaculty(user);
    return this.leaveOverview(user, faculty, query);
  }

  async applyLeave(user: AuthenticatedUser, dto: FacultyLeaveApplicationDto) {
    const faculty = await this.resolveFaculty(user);
    return this.hrLeave.createLeaveApplication(this.tid(), user, {
      employeeId: faculty.id,
      leaveTypeId: dto.leaveTypeId,
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      halfDayOption: dto.halfDayOption,
      reason: dto.reason,
      durationDays: dto.durationDays,
    });
  }

  async cancelLeave(user: AuthenticatedUser, id: string) {
    const faculty = await this.resolveFaculty(user);
    const application = await this.tenantPrisma.client.leaveApplication.findFirst({
      where: { id, employeeId: faculty.id },
      include: { employee: { select: { id: true, userId: true } } },
    });
    if (!application) throw new NotFoundException('Leave application not found.');
    if (application.status !== 'PENDING') {
      throw new BadRequestException('Only pending applications can be cancelled.');
    }
    const updated = await this.tenantPrisma.client.leaveApplication.update({
      where: { id },
      data: { status: 'CANCELLED', updatedBy: user.id },
    });
    await this.audit.record({
      scope: 'TENANT',
      tenantId: this.tid(),
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.LEAVE_APPLICATION_CANCELLED,
      module: AUDIT_MODULES.HR,
      entityType: 'LeaveApplication',
      entityId: id,
      after: { employeeId: faculty.id, source: 'FACULTY_PORTAL' },
    });
    return updated;
  }

  // ── Workload ───────────────────────────────────────────────────────────────

  private async workloadOverview(user: AuthenticatedUser, faculty: LinkedFaculty, query: FacultyReportQueryDto = {}) {
    const workloads = await this.hr.listWorkloads(this.tid(), user, {
      employeeId: faculty.id,
      termId: query.termId,
      take: 100,
    });
    const [entries, invigilationDuties] = await Promise.all([
      this.tenantPrisma.client.timetableEntry.findMany({
        where: { assignedUserId: faculty.userId as string, timetable: { status: 'PUBLISHED', deletedAt: null } },
        select: { period: { select: { startTime: true, endTime: true } } },
      }),
      this.tenantPrisma.client.examInvigilatorAssignment.count({
        where: { userId: faculty.userId as string },
      }),
    ]);

    const teachingHoursPerWeek =
      Math.round(
        entries.reduce((sum, entry) => sum + hoursBetween(entry.period?.startTime, entry.period?.endTime), 0) * 100,
      ) / 100;
    const declaredHoursPerWeek =
      Math.round(
        workloads.data.filter((workload) => workload.isActive).reduce((sum, workload) => sum + workload.hoursPerWeek, 0) * 100,
      ) / 100;

    const byType: Record<string, number> = {};
    for (const workload of workloads.data) {
      byType[workload.workloadType] = (byType[workload.workloadType] ?? 0) + workload.hoursPerWeek;
    }

    return {
      workloads: workloads.data,
      total: workloads.total,
      summary: {
        weeklyClasses: entries.length,
        teachingHoursPerWeek,
        declaredHoursPerWeek,
        totalHoursPerWeek: Math.round((teachingHoursPerWeek + declaredHoursPerWeek) * 100) / 100,
        invigilationDuties,
      },
      byType,
    };
  }

  async workload(user: AuthenticatedUser, query: FacultyReportQueryDto) {
    const faculty = await this.resolveFaculty(user);
    return this.workloadOverview(user, faculty, query);
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  private async noticesOverview(user: AuthenticatedUser, query: { skip?: number; take?: number; unreadOnly?: boolean } = {}) {
    const [items, unread, total] = await Promise.all([
      this.notifications.listInbox(user.id, {
        skip: query.skip,
        take: query.take,
        unreadOnly: query.unreadOnly,
      }),
      this.notifications.unreadCount(user.id),
      this.tenantPrisma.client.notification.count({ where: { recipientUserId: user.id } }),
    ]);
    return { items, summary: { unread, total } };
  }

  async notices(user: AuthenticatedUser, query: { skip?: number; take?: number; unreadOnly?: boolean }) {
    await this.resolveFaculty(user);
    return this.noticesOverview(user, query);
  }

  async markNoticeRead(user: AuthenticatedUser, id: string) {
    await this.resolveFaculty(user);
    const updated = await this.notifications.markInboxItemRead(user.id, id);
    return { notice: updated, summary: { unread: await this.notifications.unreadCount(user.id) } };
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  async reportsOverview(user: AuthenticatedUser, query: FacultyReportQueryDto) {
    const faculty = await this.resolveFaculty(user);
    const offeringIds = query.courseOfferingId
      ? [(await this.assertOffering(faculty.userId as string, query.courseOfferingId)).id]
      : await this.assignedOfferingIds(faculty.userId as string);

    const [offerings, attendanceSummary, subjects, leaveGrouped] = await Promise.all([
      offeringIds.length
        ? this.tenantPrisma.client.courseOffering.findMany({
            where: { id: { in: offeringIds } },
            orderBy: { code: 'asc' },
            select: {
              id: true,
              code: true,
              course: { select: { id: true, code: true, name: true } },
              section: { select: { id: true, code: true, name: true } },
              term: { select: { id: true, code: true, name: true } },
              _count: { select: { registrations: true } },
            },
          })
        : Promise.resolve([]),
      offeringIds.length
        ? this.attendance.summary(this.tid(), user.id, {
            termId: query.termId,
            courseOfferingId: query.courseOfferingId,
          })
        : Promise.resolve({ data: [], total: 0 }),
      this.assignedSubjects(faculty.userId as string),
      this.tenantPrisma.client.leaveApplication.groupBy({
        by: ['status'],
        where: { employeeId: faculty.id },
        _count: { _all: true },
      }),
    ]);

    const subjectIds = subjects.map((subject) => subject.id);
    const marksGrouped = subjectIds.length
      ? await this.tenantPrisma.client.examMarksEntry.groupBy({
          by: ['status'],
          where: { subjectId: { in: subjectIds } },
          _count: { _all: true },
        })
      : [];

    return {
      offerings: offerings.map((offering) => ({
        id: offering.id,
        code: offering.code,
        course: offering.course,
        section: offering.section,
        term: offering.term,
        studentCount: offering._count.registrations,
      })),
      attendance: attendanceSummary,
      papers: subjects.map((subject) => ({
        id: subject.id,
        course: subject.course,
        session: subject.session,
        examDate: subject.examDate,
        maxMarks: subject.maxMarks,
        passMarks: subject.passMarks,
        entered: subject._count.marksEntries,
      })),
      marks: marksGrouped.map((row) => ({ status: row.status, count: row._count._all })),
      leave: leaveGrouped.map((row) => ({ status: row.status, count: row._count._all })),
      generatedAt: new Date().toISOString(),
    };
  }
}
