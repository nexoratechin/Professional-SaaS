/**
 * Attendance service — complete attendance management on top of the Student 360 attendance
 * ledger (StudentAttendance stays the single physical record table):
 *
 *  * AttendanceSession → a held class/day/period anchored on term/courseOffering/section/date,
 *    lifecycle OPEN → CLOSED, raised from a timetable entry or standalone.
 *  * Bulk marking against a session's roster (upsert by student+session), with the capture
 *    channel surfaced from the attendance entitlements (MANUAL/QR/BIOMETRIC).
 *  * AttendanceCorrectionRequest → a student self-service (or staff) request to flip a status;
 *    APPROVE applies the change transactionally.
 *  * FacultyAttendance → per-user-per-day logs with optional check-in/out.
 *  * Reports — student percentage (with required-threshold and shortage status), shortage list
 *    for a roster, and subject-wise summary; all read configurable rules (thresholdPercent,
 *    requiredPerSubject, gracePeriodMinutes, correctionWindowHours) from the tenant-configuration
 *    attendance section.
 *
 * Everything is tenant-scoped via TenantScopedPrismaService; durable events land in the audit
 * trail (module 'attendance'). Session reads/writes are gated by attendanceScopeFilter so an
 * OWN-scoped faculty/student never sees past their grants; student-level operations reuse the
 * students module's student-scope guard.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@college-erp/database';
import {
  AttendanceCorrectionStatus,
  AttendanceSessionStatus,
  AttendanceStatus,
  CourseRegistrationStatus,
} from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StudentsService } from '../students/students.service';
import {
  CreateCorrectionDto,
  CreateSessionDto,
  DecideCorrectionDto,
  ListCorrectionsQueryDto,
  ListFacultyQueryDto,
  ListSessionsQueryDto,
  MarkEntryDto,
  MarkSessionDto,
  PercentageQueryDto,
  ScopeReportQueryDto,
  UpdateCorrectionDto,
  UpdateFacultyAttendanceDto,
  UpdateSessionDto,
  UpsertFacultyAttendanceDto,
} from './attendance.dto';
import { attendanceScopeFilter, isOwnOnly } from './attendance-scope';
import type { ScopeGrantLike } from '../students/student-scope';

type Client = PrismaClient;

const ATTENDANCE_SESSION_INCLUDE = {
  term: true,
  section: true,
  courseOffering: { include: { course: true } },
  timetableEntry: {
    select: {
      id: true,
      dayOfWeek: true,
      title: true,
      period: { select: { sequence: true, startTime: true, endTime: true } },
    },
  },
} as const;

const ATTENDANCE_RECORD_INCLUDE = {
  student: { include: { section: true } },
} as const;

const ROSTER_STATUSES: CourseRegistrationStatus[] = [CourseRegistrationStatus.REGISTERED, CourseRegistrationStatus.CONFIRMED];

/** Defaults applied when the tenant-configuration attendance section omits a rule. */
const DEFAULT_RULES = {
  thresholdPercent: 75,
  requiredPerSubject: false,
  gracePeriodMinutes: 10,
  correctionWindowHours: 72,
  ruleDescription: null as string | null,
};

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly studentsService: StudentsService,
  ) {}

  // ── Shared helpers ────────────────────────────────────────────────────────

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  private async campusIdsFor(tenantId: string, grants: ScopeGrantLike[]): Promise<Set<string>> {
    const campusIds = new Set<string>();
    for (const g of grants) {
      if (g.scopeType === 'CAMPUS' && g.campusId) campusIds.add(g.campusId);
    }
    const deptIds = grants
      .filter((g) => g.scopeType === 'DEPARTMENT' && g.departmentId)
      .map((g) => g.departmentId as string);
    const progIds = grants
      .filter((g) => g.scopeType === 'PROGRAM' && g.programId)
      .map((g) => g.programId as string);
    if (deptIds.length > 0) {
      const depts = await this.client.department.findMany({
        where: { tenantId, id: { in: deptIds } },
        select: { campusId: true },
      });
      for (const d of depts) if (d.campusId) campusIds.add(d.campusId);
    }
    if (progIds.length > 0) {
      const programs = await this.client.program.findMany({
        where: { tenantId, id: { in: progIds } },
        select: { department: { select: { campusId: true } } },
      });
      for (const p of programs) if (p.department?.campusId) campusIds.add(p.department.campusId);
    }
    return campusIds;
  }

  private async scopeFor(tenantId: string, userId: string, permission: string) {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, permission);
    const campusIds = await this.campusIdsFor(tenantId, grants);
    const result = attendanceScopeFilter(grants, userId, campusIds);
    return { grants, ...result };
  }

  private ownSessionClause(userId: string): Record<string, unknown> {
    return {
      deletedAt: null,
      OR: [
        { createdBy: userId },
        { markedByUserId: userId },
        { timetableEntry: { assignedUserId: userId } },
        { courseOffering: { faculty: { some: { userId, isActive: true } } } },
        { section: { students: { some: { userId } } } },
        { courseOffering: { registrations: { some: { student: { userId } } } } },
      ],
    };
  }

  private async rules(tenantId: string) {
    const row = await this.client.tenantConfiguration.findFirst({ where: { tenantId } });
    const section = (row?.data as any)?.attendance ?? {};
    return {
      thresholdPercent: typeof section.thresholdPercent === 'number' ? section.thresholdPercent : DEFAULT_RULES.thresholdPercent,
      requiredPerSubject: typeof section.requiredPerSubject === 'boolean' ? section.requiredPerSubject : DEFAULT_RULES.requiredPerSubject,
      gracePeriodMinutes: typeof section.gracePeriodMinutes === 'number' ? section.gracePeriodMinutes : DEFAULT_RULES.gracePeriodMinutes,
      correctionWindowHours: typeof section.correctionWindowHours === 'number' ? section.correctionWindowHours : DEFAULT_RULES.correctionWindowHours,
      ruleDescription: typeof section.ruleDescription === 'string' ? section.ruleDescription : DEFAULT_RULES.ruleDescription,
    };
  }

  private async audit(
    tenantId: string,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    payload: { before?: unknown; after?: unknown },
  ) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action,
      module: 'attendance',
      entityType,
      entityId,
      before: payload.before,
      after: payload.after,
    });
  }

  private async notifyUser(tenantId: string, userId: string, subject: string, body: string) {
    try {
      await this.notifications.sendSystem(tenantId, { recipientUserId: userId, channel: 'IN_APP', subject, body });
    } catch (error) {
      this.logger.warn(`Failed to notify user ${userId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Resolves a SCALAR-scoped session (list/detail views). */
  private async requireSessionScoped(tenantId: string, userId: string, id: string, permission = 'attendance.view') {
    const scope = await this.scopeFor(tenantId, userId, permission);
    const session = await this.client.attendanceSession.findFirst({
      where: { id, tenantId, deletedAt: null, ...(scope.where ?? {}) },
    });
    if (!session) throw new NotFoundException('Attendance session not found.');
    return { session, own: scope.own, scope };
  }

  private async rosterStudents(tenantId: string, session: { courseOfferingId?: string | null; sectionId?: string | null }) {
    if (session.courseOfferingId) {
      const regs = await this.client.courseRegistration.findMany({
        where: {
          tenantId,
          courseOfferingId: session.courseOfferingId,
          status: { in: ROSTER_STATUSES },
        },
        select: {
          student: {
            include: { section: { select: { id: true, code: true, name: true } } },
          },
        },
      });
      return this.mapRoster(regs.map((r) => r.student));
    }
    if (session.sectionId) {
      const enrollments = await this.client.studentEnrollment.findMany({
        where: { tenantId, sectionId: session.sectionId, status: 'ACTIVE' },
        select: {
          student: {
            include: { section: { select: { id: true, code: true, name: true } } },
          },
        },
      });
      return this.mapRoster(enrollments.map((e) => e.student));
    }
    return [];
  }

  private mapRoster(students: Array<any>): Array<Record<string, any>> {
    return students.map((s) => ({
      ...this.pickStudentCard(s),
      section: s.section ? { id: s.section.id, code: s.section.code, name: s.section.name } : null,
      status: null,
      remarks: null,
      signInAt: null,
    }));
  }

  private pickStudentCard(student: any) {
    return {
      id: student.id,
      fullName: student.fullName,
      rollNumber: student.rollNumber,
      admissionNumber: student.admissionNumber,
      userId: student.userId,
    };
  }

  private async sessionDetail(tenantId: string, sessionId: string) {
    const session = await this.client.attendanceSession.findFirst({
      where: { id: sessionId, tenantId },
      include: {
        ...ATTENDANCE_SESSION_INCLUDE,
        records: {
          include: ATTENDANCE_RECORD_INCLUDE,
          orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
        },
      },
    });
    if (!session) throw new NotFoundException('Attendance session not found.');
    return session;
  }

  /** Enriches a session row with its roster and per-student marks for the marking UI. */
  private async withRoster(tenantId: string, session: any) {
    const roster = await this.rosterStudents(tenantId, session);
    const byStudent = new Map<string, any>();
    for (const r of session.records ?? []) {
      byStudent.set(r.studentId, r);
    }
    const rows = roster.map((row) => {
      const record = byStudent.get(row.id);
      if (record) {
        return {
          ...row,
          recordId: record.id,
          status: record.status,
          remarks: record.remarks,
          signInAt: record.signInAt,
          markMethod: record.markMethod,
        };
      }
      return row;
    });
    return rows;
  }

  private async percentageMetrics(tenantId: string, opts: { termId?: string; subjectCode?: string }) {
    const where: Prisma.AttendanceSessionWhereInput = {
      tenantId,
      status: AttendanceSessionStatus.CLOSED,
      deletedAt: null,
    };
    if (opts.termId) where.termId = opts.termId;
    if (opts.subjectCode) where.subjectCode = opts.subjectCode;
    const sessions = await this.client.attendanceSession.findMany({
      where,
      select: { id: true },
    });
    return sessions.map((s) => s.id);
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  async lookups(tenantId: string) {
    const [terms, sections, offerings, faculty, sessionStatuses, correctionStatuses] = await Promise.all([
      this.client.term.findMany({ where: { tenantId, deletedAt: null }, orderBy: { sequence: 'desc' }, select: { id: true, code: true, name: true, isCurrent: true } }),
      this.client.section.findMany({ where: { tenantId, deletedAt: null }, orderBy: { code: 'asc' }, select: { id: true, code: true, name: true, programId: true } }),
      this.client.courseOffering.findMany({
        where: { tenantId, deletedAt: null },
        orderBy: { code: 'asc' },
        select: {
          id: true,
          code: true,
          termId: true,
          sectionId: true,
          course: { select: { id: true, code: true, name: true } },
          section: { select: { id: true, code: true, name: true } },
        },
      }),
      this.client.user.findMany({
        where: { tenantId, status: { in: ['ACTIVE', 'INVITED'] } },
        orderBy: { fullName: 'asc' },
        select: { id: true, fullName: true, email: true },
      }),
      Promise.resolve(['OPEN', 'CLOSED']),
      Promise.resolve(['PENDING', 'APPROVED', 'REJECTED']),
    ]);
    return { terms, sections, offerings, faculty, sessionStatuses, correctionStatuses };
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async listSessions(tenantId: string, userId: string, query: ListSessionsQueryDto) {
    const scope = await this.scopeFor(tenantId, userId, 'attendance.view');
    const where: Prisma.AttendanceSessionWhereInput = { tenantId, deletedAt: null };
    if (scope.where) Object.assign(where, scope.where as Prisma.AttendanceSessionWhereInput);
    if (query.termId) where.termId = query.termId;
    if (query.sectionId) where.sectionId = query.sectionId;
    if (query.courseOfferingId) where.courseOfferingId = query.courseOfferingId;
    if (query.status) where.status = query.status as AttendanceSessionStatus;
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom) (where.date as any).gte = new Date(query.dateFrom);
      if (query.dateTo) (where.date as any).lte = new Date(query.dateTo);
    }
    if (query.myOnly === 'true') {
      Object.assign(where, this.ownSessionClause(userId) as Prisma.AttendanceSessionWhereInput);
    }

    const [data, total] = await Promise.all([
      this.client.attendanceSession.findMany({
        where,
        include: { ...ATTENDANCE_SESSION_INCLUDE, _count: { select: { records: true } } },
        orderBy: { date: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 100,
      }),
      this.client.attendanceSession.count({ where }),
    ]);
    return { data, total };
  }

  async getSession(tenantId: string, userId: string, id: string) {
    await this.requireSessionScoped(tenantId, userId, id);
    const session = await this.sessionDetail(tenantId, id);
    const roster = await this.withRoster(tenantId, session);
    const counts = { present: 0, absent: 0, late: 0, leave: 0 };
    for (const r of session.records ?? []) {
      const key = (r.status as string).toLowerCase();
      if (key in counts) (counts as any)[key] += 1;
    }
    const r = await this.rules(tenantId);
    return { session, roster, counts, requiredPercent: r.thresholdPercent, rules: r };
  }

  async createSession(tenantId: string, userId: string, dto: CreateSessionDto) {
    if (!dto.courseOfferingId && !dto.sectionId) {
      throw new BadRequestException('A session must target a course offering or a section.');
    }

    let termId = dto.termId;
    let sectionId = dto.sectionId;
    let subjectCode = dto.subjectCode;
    let subjectName = dto.subjectName;

    if (dto.courseOfferingId) {
      const offering = await this.client.courseOffering.findFirst({
        where: { id: dto.courseOfferingId, tenantId, deletedAt: null },
        include: { course: true },
      });
      if (!offering) throw new NotFoundException('Course offering not found.');
      termId = termId ?? offering.termId;
      sectionId = sectionId ?? offering.sectionId ?? undefined;
      subjectCode = subjectCode ?? offering.course.code;
      subjectName = subjectName ?? offering.course.name;
    }
    if (termId) {
      const term = await this.client.term.findFirst({ where: { id: termId, tenantId } });
      if (!term) throw new NotFoundException('Term not found.');
    }
    if (sectionId) {
      const section = await this.client.section.findFirst({ where: { id: sectionId, tenantId, deletedAt: null } });
      if (!section) throw new NotFoundException('Section not found.');
    }

    const session = await this.client.attendanceSession.create({
      data: {
        tenantId,
        termId: termId ?? null,
        courseOfferingId: dto.courseOfferingId ?? null,
        sectionId: sectionId ?? null,
        timetableEntryId: dto.timetableEntryId ?? null,
        date: new Date(dto.date),
        startTime: dto.startTime ?? null,
        endTime: dto.endTime ?? null,
        attendanceType: dto.attendanceType ?? 'CLASS',
        subjectCode: subjectCode ?? null,
        subjectName: subjectName ?? null,
        title: dto.title ?? null,
        notes: dto.notes ?? null,
        status: AttendanceSessionStatus.OPEN,
        markedByUserId: userId,
        createdBy: userId,
      },
      include: ATTENDANCE_SESSION_INCLUDE,
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.ATTENDANCE_SESSION_CREATED, 'AttendanceSession', session.id, { after: session });
    const roster = await this.withRoster(tenantId, session);
    return { session, roster };
  }

  async updateSession(tenantId: string, userId: string, id: string, dto: UpdateSessionDto) {
    const { session } = await this.requireSessionScoped(tenantId, userId, id, 'attendance.update');
    if (session.status !== 'OPEN') {
      throw new BadRequestException('Only open attendance sessions can be edited.');
    }
    const data: Prisma.AttendanceSessionUpdateInput = {};
    if (dto.date) data.date = new Date(dto.date);
    if (dto.attendanceType) data.attendanceType = dto.attendanceType;
    if (dto.subjectCode) data.subjectCode = dto.subjectCode;
    if (dto.subjectName) data.subjectName = dto.subjectName;
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.startTime !== undefined) data.startTime = dto.startTime;
    if (dto.endTime !== undefined) data.endTime = dto.endTime;
    if (dto.markedByUserId) data.markedByUserId = dto.markedByUserId;
    if (Object.keys(data).length === 0) throw new BadRequestException('Nothing to update.');

    data.updatedBy = userId;
    const updated = await this.client.attendanceSession.update({
      where: { id },
      data,
      include: ATTENDANCE_SESSION_INCLUDE,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ATTENDANCE_SESSION_UPDATED, 'AttendanceSession', id, { before: session, after: updated });
    return updated;
  }

  async closeSession(tenantId: string, userId: string, id: string) {
    const { session } = await this.requireSessionScoped(tenantId, userId, id, 'attendance.update');
    if (session.status === 'CLOSED') return this.getSession(tenantId, userId, id);
    const updated = await this.client.attendanceSession.update({
      where: { id },
      data: { status: AttendanceSessionStatus.CLOSED, closedAt: new Date(), closedById: userId, updatedBy: userId },
      include: ATTENDANCE_SESSION_INCLUDE,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ATTENDANCE_SESSION_CLOSED, 'AttendanceSession', id, { before: session, after: updated });
    return updated;
  }

  async removeSession(tenantId: string, userId: string, id: string) {
    const { session } = await this.requireSessionScoped(tenantId, userId, id, 'attendance.manage');
    await this.client.attendanceSession.delete({ where: { id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ATTENDANCE_SESSION_DELETED, 'AttendanceSession', id, { before: session });
    return { removed: true };
  }

  // ── Marking ───────────────────────────────────────────────────────────────

  async markSession(tenantId: string, userId: string, id: string, dto: MarkSessionDto) {
    const { session } = await this.requireSessionScoped(tenantId, userId, id, 'attendance.create');
    if (session.status !== 'OPEN') {
      throw new BadRequestException('Attendance can only be marked on an open session.');
    }
    if (!dto.entries.length) throw new BadRequestException('No attendance entries supplied.');

    const roster = await this.rosterStudents(tenantId, session);
    const rosterIds = new Set(roster.map((s) => s.id));
    const unknown = dto.entries.filter((e) => !rosterIds.has(e.studentId));
    if (unknown.length > 0) {
      throw new BadRequestException(`Attendance for ${unknown.length} student(s) not in this session's roster.`);
    }
    const duplicate = dto.entries.map((e) => e.studentId).filter((sid, i, all) => all.indexOf(sid) !== i);
    if (duplicate.length > 0) throw new BadRequestException('Duplicate student entries are not allowed.');

    const markMethod = dto.markMethod ?? 'MANUAL';
    const ops: Prisma.PrismaPromise<any>[] = dto.entries.map((entry: MarkEntryDto) =>
      this.client.studentAttendance.upsert({
        where: {
          tenantId_sessionId_studentId: { tenantId, sessionId: id, studentId: entry.studentId },
        },
        create: {
          tenantId,
          studentId: entry.studentId,
          sessionId: id,
          date: session.date,
          attendanceType: session.attendanceType,
          termId: session.termId,
          subjectCode: session.subjectCode,
          subjectName: session.subjectName,
          status: entry.status as AttendanceStatus,
          markMethod,
          signInAt: entry.signInAt ? new Date(entry.signInAt) : null,
          markedByUserId: userId,
          remarks: entry.remarks ?? null,
        },
        update: {
          status: entry.status as AttendanceStatus,
          markMethod,
          signInAt: entry.signInAt ? new Date(entry.signInAt) : null,
          markedByUserId: userId,
          remarks: entry.remarks ?? null,
        },
      }),
    );
    const records = await this.client.$transaction(ops);

    await this.audit(tenantId, userId, AUDIT_ACTIONS.ATTENDANCE_MARKED, 'AttendanceSession', id, {
      after: { sessionId: id, count: records.length, markMethod, studentIds: dto.entries.map((e) => e.studentId) },
    });

    const detail = await this.sessionDetail(tenantId, id);
    const rosterWith = await this.withRoster(tenantId, detail);
    return { session: detail, roster: rosterWith, marked: records.length };
  }

  // ── Corrections ───────────────────────────────────────────────────────────

  async listCorrections(tenantId: string, userId: string, query: ListCorrectionsQueryDto) {
    const scope = await this.scopeFor(tenantId, userId, 'attendance.update');
    const where: Prisma.AttendanceCorrectionRequestWhereInput = { tenantId };
    if (scope.where) {
      Object.assign(where, {
        OR: [
          { session: scope.where as Prisma.AttendanceSessionWhereInput },
          { requestedByUserId: userId },
          { student: { userId } },
        ],
      } as Prisma.AttendanceCorrectionRequestWhereInput);
    }
    if (query.status) where.status = query.status as AttendanceCorrectionStatus;
    if (query.studentId) where.studentId = query.studentId;

    const [data, total] = await Promise.all([
      this.client.attendanceCorrectionRequest.findMany({
        where,
        include: {
          student: { include: { section: true } },
          session: { include: ATTENDANCE_SESSION_INCLUDE },
          requestedBy: { select: { id: true, fullName: true, email: true } },
          decidedBy: { select: { id: true, fullName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 100,
      }),
      this.client.attendanceCorrectionRequest.count({ where }),
    ]);
    return { data, total };
  }

  async createCorrection(tenantId: string, userId: string, dto: CreateCorrectionDto) {
    if (!dto.sessionId && !dto.attendanceRecordId) {
      throw new BadRequestException('Provide a session or an attendance record to correct.');
    }

    const record = await this.findCorrectionRecord(tenantId, {
      sessionId: dto.sessionId,
      attendanceRecordId: dto.attendanceRecordId,
      studentId: dto.studentId,
    });
    if (!record) throw new NotFoundException('Attendance record not found.');

    const isSelf = record.student.userId === userId;
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'attendance.update');
    const principle = !isOwnOnly(grants);

    const r = await this.rules(tenantId);
    const sessionDate = record.session?.date ?? record.date;
    const windowMs = r.correctionWindowHours * 60 * 60 * 1000;
    const withinWindow = Date.now() - new Date(sessionDate).getTime() <= windowMs;
    if (!isSelf && !principle) {
      throw new BadRequestException('You may only request corrections for your own attendance.');
    }
    if (!withinWindow && !principle) {
      throw new BadRequestException('The correction window for this session has expired.');
    }

    const request = await this.client.attendanceCorrectionRequest.create({
      data: {
        tenantId,
        studentId: record.studentId,
        sessionId: record.sessionId,
        attendanceRecordId: record.id,
        fromStatus: record.status as AttendanceStatus,
        toStatus: dto.toStatus as AttendanceStatus,
        reason: dto.reason,
        remarks: dto.remarks ?? null,
        status: AttendanceCorrectionStatus.PENDING,
        requestedByUserId: userId,
      },
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.ATTENDANCE_CORRECTION_REQUESTED, 'AttendanceCorrectionRequest', request.id, {
      after: { studentId: record.studentId, sessionId: record.sessionId, fromStatus: record.status, toStatus: dto.toStatus },
    });
    await this.logActivity(tenantId, record.studentId, 'attendance.correction_requested', 'Attendance correction requested', userId, `Change ${record.status} → ${dto.toStatus}`);
    return this.getCorrection(tenantId, request.id);
  }

  private async findCorrectionRecord(
    tenantId: string,
    opts: { sessionId?: string; attendanceRecordId?: string; studentId?: string },
  ) {
    const where: Prisma.StudentAttendanceWhereInput = { tenantId };
    if (opts.attendanceRecordId) {
      where.id = opts.attendanceRecordId;
    } else if (opts.sessionId) {
      where.sessionId = opts.sessionId;
      if (opts.studentId) where.studentId = opts.studentId;
    }
    return this.client.studentAttendance.findFirst({
      where,
      include: { student: { select: { id: true, userId: true } }, session: { select: { id: true, date: true } } },
    });
  }

  async getCorrection(tenantId: string, id: string) {
    const request = await this.client.attendanceCorrectionRequest.findFirst({
      where: { id, tenantId },
      include: {
        student: { include: { section: true } },
        session: { include: ATTENDANCE_SESSION_INCLUDE },
        requestedBy: { select: { id: true, fullName: true, email: true } },
        decidedBy: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!request) throw new NotFoundException('Correction request not found.');
    return request;
  }

  async updateCorrection(tenantId: string, userId: string, id: string, dto: UpdateCorrectionDto) {
    const request = await this.client.attendanceCorrectionRequest.findFirst({ where: { id, tenantId } });
    if (!request) throw new NotFoundException('Correction request not found.');
    if (request.status !== 'PENDING') throw new BadRequestException('Only pending requests can be updated.');
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'attendance.update');
    const canEdit = request.requestedByUserId === userId || grants.some((g) => g.scopeType !== 'OWN');
    if (!canEdit) {
      throw new BadRequestException('Only the requester or a staff member can edit this request.');
    }
    const data: Prisma.AttendanceCorrectionRequestUpdateInput = {};
    if (dto.toStatus) data.toStatus = dto.toStatus as AttendanceStatus;
    if (dto.reason) data.reason = dto.reason;
    if (dto.remarks !== undefined) data.remarks = dto.remarks;
    const updated = await this.client.attendanceCorrectionRequest.update({ where: { id }, data });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ATTENDANCE_CORRECTION_UPDATED, 'AttendanceCorrectionRequest', id, {
      before: request,
      after: updated,
    });
    return updated;
  }

  async decideCorrection(tenantId: string, userId: string, id: string, decision: 'APPROVE' | 'REJECT', dto: DecideCorrectionDto) {
    const request = await this.client.attendanceCorrectionRequest.findFirst({
      where: { id, tenantId },
      include: { student: { select: { id: true, userId: true } } },
    });
    if (!request) throw new NotFoundException('Correction request not found.');
    if (request.status !== 'PENDING') throw new BadRequestException('This request has already been decided.');
    if (request.decidedByUserId === userId) {
      throw new BadRequestException('You already decided this request.');
    }
    if (request.sessionId) {
      await this.requireSessionScoped(tenantId, userId, request.sessionId, 'attendance.update');
    }

    const after: Record<string, unknown> = {
      status: decision === 'APPROVE' ? AttendanceCorrectionStatus.APPROVED : AttendanceCorrectionStatus.REJECTED,
      decidedByUserId: userId,
      decidedAt: new Date(),
      remarks: dto.remarks ?? request.remarks,
    };
    let updatedRecords: { count: number } = { count: 0 };

    await this.client.$transaction(async (tx) => {
      const updated = await (tx as any).attendanceCorrectionRequest.update({ where: { id }, data: after as any });
      if (decision === 'APPROVE') {
        const where = request.attendanceRecordId
          ? { id: request.attendanceRecordId, tenantId }
          : { sessionId: request.sessionId, studentId: request.studentId, tenantId };
        updatedRecords = await (tx as any).studentAttendance.updateMany({
          where,
          data: {
            status: request.toStatus,
            remarks: request.remarks ? `${request.remarks ?? ''} (corrected: ${request.reason})`.trim() : `corrected: ${request.reason}`,
          },
        });
      }
      return updated;
    });

    const action = decision === 'APPROVE' ? AUDIT_ACTIONS.ATTENDANCE_CORRECTION_APPROVED : AUDIT_ACTIONS.ATTENDANCE_CORRECTION_REJECTED;
    await this.audit(tenantId, userId, action, 'AttendanceCorrectionRequest', id, { before: request, after: { status: decision, requestsUpdated: updatedRecords.count } });
    const title = decision === 'APPROVE' ? 'Attendance correction approved' : 'Attendance correction rejected';
    if (request.requestedByUserId) {
      await this.notifyUser(tenantId, request.requestedByUserId, title, `Your request to change attendance to ${request.toStatus} was ${decision.toLowerCase()}.`);
    }
    if (request.student.userId && request.student.userId !== request.requestedByUserId) {
      await this.notifyUser(tenantId, request.student.userId, title, `Attendance corrected to ${request.toStatus} for ${this.subjectLabel(request)}.`);
    }
    await this.logActivity(tenantId, request.studentId, 'attendance.correction_decided', title, userId, `→ ${request.toStatus}`);

    const result = await this.getCorrection(tenantId, id);
    return { ...result, recordsUpdated: updatedRecords.count ?? 0 };
  }

  private subjectLabel(request: { session?: { subjectName?: string | null; subjectCode?: string | null } | null; attendanceRecordId?: string | null }) {
    return request.session?.subjectName ?? request.session?.subjectCode ?? 'the session';
  }

  private async logActivity(tenantId: string, studentId: string, eventType: string, title: string, actorUserId: string, description?: string) {
    await this.client.studentActivity.create({
      data: { tenantId, studentId, eventType, title, description: description ?? null, actorUserId },
    });
  }

  // ── Faculty / staff attendance ────────────────────────────────────────────

  async listFacultyAttendance(tenantId: string, userId: string, query: ListFacultyQueryDto) {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'attendance.view');
    const own = isOwnOnly(grants);
    const where: Prisma.FacultyAttendanceWhereInput = { tenantId };
    if (own) {
      where.userId = userId;
    } else if (query.userId) {
      where.userId = query.userId;
    }
    if (query.dateFrom || query.dateTo) {
      where.date = {};
      if (query.dateFrom) (where.date as any).gte = new Date(query.dateFrom);
      if (query.dateTo) (where.date as any).lte = new Date(query.dateTo);
    }

    const [data, total] = await Promise.all([
      this.client.facultyAttendance.findMany({
        where,
        include: { user: { select: { id: true, fullName: true, email: true } } },
        orderBy: { date: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 100,
      }),
      this.client.facultyAttendance.count({ where }),
    ]);
    return { data, total };
  }

  async upsertFacultyAttendance(tenantId: string, userId: string, dto: UpsertFacultyAttendanceDto) {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'attendance.create');
    const canMarkOthers = grants.some((g) => g.scopeType !== 'OWN');
    if (!canMarkOthers && dto.userId !== userId) {
      throw new BadRequestException('You may only mark your own faculty attendance.');
    }
    const target = await this.client.user.findFirst({ where: { id: dto.userId, tenantId } });
    if (!target) throw new NotFoundException('User not found.');

    const existing = await this.client.facultyAttendance.findUnique({
      where: { tenantId_userId_date: { tenantId, userId: dto.userId, date: new Date(dto.date) } },
    });
    let row: any;
    if (existing) {
      row = await this.client.facultyAttendance.update({
        where: { id: existing.id },
        data: {
          checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : existing.checkInAt,
          checkOutAt: dto.checkOutAt ? new Date(dto.checkOutAt) : existing.checkOutAt,
          status: (dto.status as AttendanceStatus) ?? existing.status,
          sessionId: dto.sessionId ?? existing.sessionId,
          markMethod: dto.markMethod ?? existing.markMethod,
          remarks: dto.remarks ?? existing.remarks,
        },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      });
    } else {
      row = await this.client.facultyAttendance.create({
        data: {
          tenantId,
          userId: dto.userId,
          date: new Date(dto.date),
          checkInAt: dto.checkInAt ? new Date(dto.checkInAt) : null,
          checkOutAt: dto.checkOutAt ? new Date(dto.checkOutAt) : null,
          status: (dto.status as AttendanceStatus) ?? AttendanceStatus.PRESENT,
          sessionId: dto.sessionId ?? null,
          markMethod: dto.markMethod ?? 'MANUAL',
          remarks: dto.remarks ?? null,
          markedByUserId: userId,
        },
        include: { user: { select: { id: true, fullName: true, email: true } } },
      });
    }
    const action = existing ? AUDIT_ACTIONS.ATTENDANCE_FACULTY_UPDATED : AUDIT_ACTIONS.ATTENDANCE_FACULTY_MARKED;
    await this.audit(tenantId, userId, action, 'FacultyAttendance', row.id, { after: row });
    return row;
  }

  async updateFacultyAttendance(tenantId: string, userId: string, id: string, dto: UpdateFacultyAttendanceDto) {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'attendance.create');
    const own = isOwnOnly(grants);
    const existing = await this.client.facultyAttendance.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Faculty attendance record not found.');
    if (own && existing.userId !== userId) {
      throw new BadRequestException('You may only edit your own faculty attendance.');
    }
    const data: Prisma.FacultyAttendanceUpdateInput = {};
    if (dto.checkInAt) data.checkInAt = new Date(dto.checkInAt);
    if (dto.checkOutAt) data.checkOutAt = new Date(dto.checkOutAt);
    if (dto.status) data.status = dto.status as AttendanceStatus;
    if (dto.remarks !== undefined) data.remarks = dto.remarks;
    const updated = await this.client.facultyAttendance.update({
      where: { id },
      data,
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ATTENDANCE_FACULTY_UPDATED, 'FacultyAttendance', id, { before: existing, after: updated });
    return updated;
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  async percentage(tenantId: string, userId: string, query: PercentageQueryDto) {
    let studentId = query.studentId;
    if (!studentId) {
      const me = await this.client.student.findFirst({ where: { tenantId, userId, deletedAt: null } });
      if (!me) throw new BadRequestException('Provide a studentId (no linked student profile found for this user).');
      studentId = me.id;
    }
    await this.studentsService.assertStudentInScope(studentId, tenantId, userId);

    const r = await this.rules(tenantId);
    const sessionIds = await this.percentageMetrics(tenantId, { termId: query.termId, subjectCode: query.subjectCode });
    let present = 0;
    let late = 0;
    let absent = 0;
    let leave = 0;
    if (sessionIds.length > 0) {
      const records = await this.client.studentAttendance.findMany({
        where: { tenantId, studentId, sessionId: { in: sessionIds } },
        select: { status: true },
      });
      for (const rec of records) {
        if (rec.status === 'PRESENT') present += 1;
        else if (rec.status === 'LATE') late += 1;
        else if (rec.status === 'LEAVE') leave += 1;
        else absent += 1;
      }
    }
    const total = present + late + absent + leave;
    const attended = present + late;
    const percentage = total === 0 ? 0 : Math.round((attended / total) * 10000) / 100;
    const required = r.thresholdPercent;
    return {
      studentId,
      totalSessions: total,
      present,
      late,
      absent,
      leave,
      attended,
      percentage,
      requiredPercent: required,
      status: total === 0 ? 'ON_TRACK' : percentage >= required ? 'ON_TRACK' : percentage >= required * 0.9 ? 'WARNING' : 'SHORTAGE',
    };
  }

  async shortages(tenantId: string, userId: string, query: ScopeReportQueryDto) {
    const students = await this.reportRoster(tenantId, query);
    const r = await this.rules(tenantId);
    const rows: Array<Record<string, unknown>> = [];
    for (const student of students) {
      const metrics = await this.percentage(tenantId, userId, {
        studentId: student.id,
        termId: query.termId,
      });
      if (metrics.totalSessions > 0 && metrics.percentage < r.thresholdPercent) {
        rows.push({
          studentId: student.id,
          fullName: student.fullName,
          rollNumber: student.rollNumber,
          admissionNumber: student.admissionNumber,
          sectionCode: student.section?.code ?? null,
          present: metrics.present,
          totalSessions: metrics.totalSessions,
          percentage: metrics.percentage,
          requiredPercent: r.thresholdPercent,
        });
      }
    }
    rows.sort((a, b) => (a.percentage as number) - (b.percentage as number));
    return { data: rows, total: rows.length, requiredPercent: r.thresholdPercent, requiredPerSubject: r.requiredPerSubject };
  }

  async summary(tenantId: string, userId: string, query: ScopeReportQueryDto) {
    const scope = await this.scopeFor(tenantId, userId, 'attendance.view');
    const where: Prisma.AttendanceSessionWhereInput = {
      tenantId,
      status: AttendanceSessionStatus.CLOSED,
      deletedAt: null,
    };
    if (scope.where) Object.assign(where, scope.where as Prisma.AttendanceSessionWhereInput);
    if (query.termId) where.termId = query.termId;
    if (query.sectionId) where.sectionId = query.sectionId;
    if (query.courseOfferingId) where.courseOfferingId = query.courseOfferingId;

    const sessions = await this.client.attendanceSession.findMany({
      where,
      select: { id: true, subjectCode: true, subjectName: true, records: { select: { status: true } } },
    });

    const groups = new Map<string, { subjectCode: string; subjectName: string; sessions: number; present: number; late: number; absent: number; leave: number }>();
    for (const session of sessions) {
      if (!session.records.length) continue;
      const key = session.subjectCode ?? session.subjectName ?? 'general';
      const group = groups.get(key) ?? {
        subjectCode: session.subjectCode ?? '',
        subjectName: session.subjectName ?? '',
        sessions: 0,
        present: 0,
        late: 0,
        absent: 0,
        leave: 0,
      };
      group.sessions += 1;
      for (const rec of session.records) {
        if (rec.status === 'PRESENT') group.present += 1;
        else if (rec.status === 'LATE') group.late += 1;
        else if (rec.status === 'LEAVE') group.leave += 1;
        else group.absent += 1;
      }
      groups.set(key, group);
    }

    const r = await this.rules(tenantId);
    const data = [...groups.values()].map((g) => {
      const total = g.present + g.late + g.absent + g.leave;
      const attended = g.present + g.late;
      return {
        ...g,
        totalMarked: total,
        attended,
        percentage: total === 0 ? 0 : Math.round((attended / total) * 10000) / 100,
        requiredPercent: r.thresholdPercent,
        status: attended === 0 ? 'NO_MARKS' : (attended / total) * 100 >= r.thresholdPercent ? 'ON_TRACK' : 'SHORTAGE',
      };
    });
    data.sort((a, b) => b.sessions - a.sessions);
    return { data, total: data.length };
  }

  private async reportRoster(tenantId: string, query: ScopeReportQueryDto) {
    if (query.courseOfferingId) {
      const regs = await this.client.courseRegistration.findMany({
        where: { tenantId, courseOfferingId: query.courseOfferingId, status: { in: ROSTER_STATUSES } },
        select: { student: { include: { section: { select: { id: true, code: true } } } } },
      });
      return regs.map((r) => ({ ...this.pickStudentCard(r.student), section: r.student.section }));
    }
    if (query.sectionId) {
      const enrollments = await this.client.studentEnrollment.findMany({
        where: { tenantId, sectionId: query.sectionId, status: 'ACTIVE' },
        select: { student: { include: { section: { select: { id: true, code: true } } } } },
      });
      return enrollments.map((e) => ({ ...this.pickStudentCard(e.student), section: e.student.section }));
    }
    throw new BadRequestException('Provide a sectionId or courseOfferingId for roster reports.');
  }
}