/**
 * Exams service — exam sessions & papers (subjects), data-driven eligibility rules, single/​bulk
 * registration with eligibility gating, hall-ticket generation (immutable per-subject snapshots),
 * seating plans + auto-allocation, invigilator duty lists, marks entry with an examiner-sheet
 * workflow (DRAFT → SUBMITTED → MODERATED → APPROVED), revaluation requests, and idempotent result
 * publication that syncs the student-360 StudentExam/StudentResult rows and clears open backlogs on
 * supplementary-paper passes. Every read is tenant-scoped and forced through the exams scope grants
 * (exams.view + friends); every mutation lands an audit event (module 'exams').
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PrismaClient } from '@college-erp/database';
import { AttendanceStatus, ResultOutcome } from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  examHallTicketScopeFilter,
  examMarksScopeFilter,
  examRegistrationScopeFilter,
  examSeatingPlanScopeFilter,
  examSessionScopeFilter,
  examSubjectScopeFilter,
} from './exams-scope';
import {
  AssignInvigilatorDto,
  BulkMarksDto,
  BulkRegisterDto,
  CheckEligibilityDto,
  CreateExamSessionDto,
  CreateExamSubjectDto,
  CreateRegistrationDto,
  CreateRevaluationDto,
  CreateSeatingPlanDto,
  ExamsPaginationDto,
  GenerateHallTicketsDto,
  ListHallTicketsQueryDto,
  ListMarksQueryDto,
  ListRegistrationsQueryDto,
  ListRevaluationQueryDto,
  ListSeatingPlansQueryDto,
  ListSessionsQueryDto,
  ListSubjectsQueryDto,
  MarksEntryInputDto,
  ResolveRevaluationDto,
  SetEligibilityRulesDto,
  SessionStatusDto,
  SubjectStatusDto,
  UpdateExamSessionDto,
  UpdateExamSubjectDto,
  UpdateInvigilatorDto,
  UpdateRegistrationStatusDto,
  UpdateSeatAllocationDto,
  UpdateSeatingPlanDto,
  UpsertMarksEntryDto,
} from './dto/exams.dto';

type Client = PrismaClient;

const SESSION_ACTIONABLE_STATUSES = ['DRAFT', 'SCHEDULED'] as const;
const DEFAULT_MIN_ATTENDANCE_PERCENT = 75;

type EligibilityReason = {
  ruleType: string;
  label: string;
  satisfied: boolean;
  detail?: string;
};

type EligibilityOutcome = {
  studentId: string;
  fullName: string;
  admissionNumber: string | null;
  eligible: boolean;
  attendancePercent: number | null;
  reasons: EligibilityReason[];
};

type PrerequisiteSubjectRow = {
  course: {
    code: string;
    name: string;
    requiredBy: { requiredCourse: { id: string; code: string } }[];
  };
};

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async grants(tenantId: string, userId: string) {
    return this.permissionsService.getScopeGrantsFor(tenantId, userId, 'exams.view');
  }

  private async sessionScope(tenantId: string, userId: string) {
    return examSessionScopeFilter(await this.grants(tenantId, userId), userId);
  }

  private async subjectScope(tenantId: string, userId: string) {
    return examSubjectScopeFilter(await this.grants(tenantId, userId), userId);
  }

  private async registrationScope(tenantId: string, userId: string) {
    return examRegistrationScopeFilter(await this.grants(tenantId, userId), userId);
  }

  private async marksScope(tenantId: string, userId: string) {
    return examMarksScopeFilter(await this.grants(tenantId, userId), userId);
  }

  private async hallTicketScope(tenantId: string, userId: string) {
    return examHallTicketScopeFilter(await this.grants(tenantId, userId), userId);
  }

  private async seatingPlanScope(tenantId: string, userId: string) {
    return examSeatingPlanScopeFilter(await this.grants(tenantId, userId), userId);
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
      module: 'exams',
      entityType,
      entityId,
      before: payload.before,
      after: payload.after,
    });
  }

  private page(query: ExamsPaginationDto) {
    return { skip: query.skip ?? 0, take: query.take ?? 50 };
  }

  private paginate<T extends { id: string }>(items: T[], total: number) {
    return { items, total };
  }

  private async assertSession(tenantId: string, sessionId: string) {
    const session = await (this.tenantPrisma.client as Client).examSession.findFirst({
      where: { id: sessionId, tenantId, deletedAt: null },
    });
    if (!session) throw new NotFoundException('Exam session not found.');
    return session;
  }

  private async assertSubject(tenantId: string, subjectId: string) {
    const subject = await (this.tenantPrisma.client as Client).examSubject.findFirst({
      where: { id: subjectId, tenantId },
      include: { course: { select: { id: true, code: true, name: true } }, room: true },
    });
    if (!subject) throw new NotFoundException('Exam subject not found.');
    return subject;
  }

  private async assertRegistration(tenantId: string, registrationId: string) {
    const registration = await (this.tenantPrisma.client as Client).examRegistration.findFirst({
      where: { id: registrationId, tenantId },
      include: {
        student: { select: { id: true, fullName: true, admissionNumber: true, userId: true } },
      },
    });
    if (!registration) throw new NotFoundException('Exam registration not found.');
    return registration;
  }

  private async assertStudent(tenantId: string, studentId: string) {
    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException('Student not found.');
    return student;
  }

  private async assertCourse(tenantId: string, courseId: string) {
    const course = await (this.tenantPrisma.client as Client).course.findFirst({
      where: { id: courseId, tenantId, deletedAt: null },
    });
    if (!course) throw new NotFoundException('Course not found.');
    return course;
  }

  private async assertRoom(tenantId: string, roomId: string) {
    const room = await (this.tenantPrisma.client as Client).room.findFirst({
      where: { id: roomId, tenantId, deletedAt: null },
    });
    if (!room) throw new NotFoundException('Room not found.');
    return room;
  }

  private async assertUser(tenantId: string, userId: string) {
    const user = await (this.tenantPrisma.client as Client).user.findFirst({
      where: { id: userId, tenantId },
    });
    if (!user) throw new NotFoundException('User not found.');
    return user;
  }

  /** True when the student already cleared `courseId` (COMPLETED registration or cleared backlog). */
  private async hasClearedCourse(tenantId: string, studentId: string, courseId: string): Promise<boolean> {
    const completed = await (this.tenantPrisma.client as Client).courseRegistration.count({
      where: { tenantId, studentId, status: 'COMPLETED', courseOffering: { courseId } },
    });
    if (completed > 0) return true;
    const cleared = await (this.tenantPrisma.client as Client).courseBacklog.count({
      where: { tenantId, studentId, courseId, status: 'CLEARED' },
    });
    return cleared > 0;
  }

  /** Overall attendance % for a student, optionally scoped to a term; null when there is no data. */
  private async attendancePercent(
    tenantId: string,
    studentId: string,
    termId?: string | null,
  ): Promise<number | null> {
    const where: Prisma.StudentAttendanceWhereInput = {
      tenantId,
      studentId,
      ...(termId ? { termId } : {}),
    };
    const total = await (this.tenantPrisma.client as Client).studentAttendance.count({ where });
    if (total === 0) return null;
    const attended = await (this.tenantPrisma.client as Client).studentAttendance.count({
      where: { ...where, status: { in: [AttendanceStatus.PRESENT, AttendanceStatus.LATE] } },
    });
    return Math.round((attended / total) * 100);
  }

  private async notifyStudent(tenantId: string, studentId: string, subject: string, body: string) {
    try {
      const student = await (this.tenantPrisma.client as Client).student.findFirst({
        where: { id: studentId, tenantId, deletedAt: null },
        select: { userId: true },
      });
      if (!student?.userId) return;
      await this.notifications.sendSystem(tenantId, {
        recipientUserId: student.userId,
        channel: 'IN_APP',
        subject,
        body,
      });
    } catch (error) {
      this.logger.warn(
        `Failed to notify student ${studentId}: ${error instanceof Error ? error.message : error}`,
      );
    }
  }

  // ── Exam sessions ─────────────────────────────────────────────────────────

  async listSessions(tenantId: string, userId: string, query: ListSessionsQueryDto) {
    const scope = await this.sessionScope(tenantId, userId);
    const where: Prisma.ExamSessionWhereInput = {
      tenantId,
      deletedAt: null,
      ...(scope ? scope : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.examType ? { examType: query.examType as never } : {}),
      ...(query.programId ? { programId: query.programId } : {}),
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.termId ? { termId: query.termId } : {}),
      ...(typeof query.supplementary === 'boolean' ? { isSupplementary: query.supplementary } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { code: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).examSession.findMany({
        where,
        include: {
          program: { select: { id: true, code: true, name: true } },
          academicYear: { select: { id: true, code: true, name: true } },
          term: { select: { id: true, code: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...this.page(query),
      }),
      (this.tenantPrisma.client as Client).examSession.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async getSession(tenantId: string, userId: string, sessionId: string) {
    const scope = await this.sessionScope(tenantId, userId);
    const session = await (this.tenantPrisma.client as Client).examSession.findFirst({
      where: { id: sessionId, tenantId, deletedAt: null, ...(scope ? scope : {}) },
      include: {
        program: { select: { id: true, code: true, name: true } },
        academicYear: { select: { id: true, code: true, name: true } },
        term: { select: { id: true, code: true, name: true } },
        baseSession: { select: { id: true, code: true, name: true } },
        _count: {
          select: { subjects: true, registrations: true, hallTickets: true, seatingPlans: true },
        },
      },
    });
    if (!session) throw new NotFoundException('Exam session not found.');
    return session;
  }

  async createSession(tenantId: string, userId: string, dto: CreateExamSessionDto) {
    const duplicate = await (this.tenantPrisma.client as Client).examSession.findFirst({
      where: { tenantId, code: dto.code },
    });
    if (duplicate) throw new ConflictException('An exam session with this code already exists.');

    const data: Prisma.ExamSessionCreateInput = {
      tenant: { connect: { id: tenantId } },
      name: dto.name,
      code: dto.code,
      program: { connect: { id: dto.programId } },
      academicYear: { connect: { id: dto.academicYearId } },
      examType: dto.examType as never,
      isSupplementary: dto.isSupplementary ?? false,
      status: (dto.status ?? 'DRAFT') as never,
    };
    if (dto.termId) data.term = { connect: { id: dto.termId } };
    if (dto.baseSessionId) data.baseSession = { connect: { id: dto.baseSessionId } };
    if (dto.startDate) data.startDate = new Date(dto.startDate);
    if (dto.endDate) data.endDate = new Date(dto.endDate);
    if (dto.resultDeclarationDate) data.resultDeclarationDate = new Date(dto.resultDeclarationDate);
    if (dto.eligibilityPolicy) data.eligibilityPolicy = dto.eligibilityPolicy;
    if (dto.remarks) data.remarks = dto.remarks;
    data.createdBy = userId;
    data.updatedBy = userId;

    const session = await (this.tenantPrisma.client as Client).examSession.create({ data });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SESSION_CREATED, 'ExamSession', session.id, {
      after: { code: session.code, programId: session.programId, examType: session.examType },
    });
    return session;
  }

  async updateSession(tenantId: string, userId: string, sessionId: string, dto: UpdateExamSessionDto) {
    const existing = await this.assertSession(tenantId, sessionId);
    if (existing.resultPublishedAt) {
      throw new BadRequestException('Cannot edit a session whose results have been published.');
    }

    const data: Prisma.ExamSessionUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.code !== undefined) data.code = dto.code;
    if (dto.termId !== undefined) data.term = dto.termId ? { connect: { id: dto.termId } } : { disconnect: true };
    if (dto.examType !== undefined) data.examType = dto.examType as never;
    if (dto.isSupplementary !== undefined) data.isSupplementary = dto.isSupplementary;
    if (dto.baseSessionId !== undefined) data.baseSession = dto.baseSessionId ? { connect: { id: dto.baseSessionId } } : { disconnect: true };
    if (dto.startDate !== undefined) data.startDate = dto.startDate ? new Date(dto.startDate) : null;
    if (dto.endDate !== undefined) data.endDate = dto.endDate ? new Date(dto.endDate) : null;
    if (dto.resultDeclarationDate !== undefined) data.resultDeclarationDate = dto.resultDeclarationDate ? new Date(dto.resultDeclarationDate) : null;
    if (dto.eligibilityPolicy !== undefined) data.eligibilityPolicy = dto.eligibilityPolicy;
    if (dto.remarks !== undefined) data.remarks = dto.remarks;
    data.updatedBy = userId;

    const session = await (this.tenantPrisma.client as Client).examSession.update({
      where: { id: sessionId },
      data,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SESSION_UPDATED, 'ExamSession', session.id, {
      before: { name: existing.name, code: existing.code },
      after: { name: session.name, code: session.code },
    });
    return session;
  }

  async changeSessionStatus(tenantId: string, userId: string, sessionId: string, dto: SessionStatusDto) {
    const existing = await this.assertSession(tenantId, sessionId);
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('A cancelled session cannot be re-activated.');
    }
    if (existing.resultPublishedAt && dto.status !== 'COMPLETED') {
      throw new BadRequestException('Only the COMPLETED status can be set after results are published.');
    }
    const session = await (this.tenantPrisma.client as Client).examSession.update({
      where: { id: sessionId },
      data: { status: dto.status as never, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SESSION_STATUS_CHANGED, 'ExamSession', session.id, {
      before: { status: existing.status },
      after: { status: session.status },
    });
    return session;
  }

  async deleteSession(tenantId: string, userId: string, sessionId: string) {
    const existing = await this.assertSession(tenantId, sessionId);
    if (existing.resultPublishedAt) {
      throw new BadRequestException('Unpublish results before deleting this session.');
    }
    await (this.tenantPrisma.client as Client).examSession.delete({ where: { id: sessionId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SESSION_DELETED, 'ExamSession', sessionId, {
      before: { code: existing.code, status: existing.status },
    });
    return { success: true };
  }

  // ── Subjects (papers) ─────────────────────────────────────────────────────

  async listSubjectsBySession(tenantId: string, userId: string, sessionId: string, query: ListSubjectsQueryDto) {
    const scope = await this.subjectScope(tenantId, userId);
    const where: Prisma.ExamSubjectWhereInput = {
      tenantId,
      sessionId,
      ...(scope ? scope : {}),
      ...(query.search
        ? {
            OR: [
              { course: { code: { contains: query.search, mode: 'insensitive' } } },
              { course: { name: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).examSubject.findMany({
        where,
        include: {
          course: { select: { id: true, code: true, name: true, creditHours: true } },
          room: { select: { id: true, code: true, name: true, buildingName: true } },
        },
        orderBy: [{ examDate: 'asc' }, { createdAt: 'asc' }],
        ...this.page(query),
      }),
      (this.tenantPrisma.client as Client).examSubject.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async createSubject(tenantId: string, userId: string, sessionId: string, dto: CreateExamSubjectDto) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.status === 'CANCELLED') throw new BadRequestException('Session is cancelled.');
    const course = await this.assertCourse(tenantId, dto.courseId);
    const duplicate = await (this.tenantPrisma.client as Client).examSubject.findFirst({
      where: { tenantId, sessionId, courseId: dto.courseId },
    });
    if (duplicate) throw new ConflictException('This course is already a subject in the session.');
    if (dto.passMarks > dto.maxMarks) throw new BadRequestException('passMarks cannot exceed maxMarks.');

    const data: Prisma.ExamSubjectCreateInput = {
      tenant: { connect: { id: tenantId } },
      session: { connect: { id: sessionId } },
      course: { connect: { id: course.id } },
      maxMarks: dto.maxMarks,
      passMarks: dto.passMarks,
    };
    if (dto.roomId) data.room = { connect: { id: dto.roomId } };
    if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;
    if (dto.pattern) data.pattern = dto.pattern;
    if (dto.examDate) data.examDate = new Date(dto.examDate);
    if (dto.startTime) data.startTime = dto.startTime;
    if (dto.endTime) data.endTime = dto.endTime;
    if (dto.remarks) data.remarks = dto.remarks;
    data.createdBy = userId;
    data.updatedBy = userId;

    const subject = await (this.tenantPrisma.client as Client).examSubject.create({ data });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SUBJECT_CREATED, 'ExamSubject', subject.id, {
      after: { sessionId, courseId: dto.courseId, maxMarks: dto.maxMarks },
    });
    return subject;
  }

  async updateSubject(tenantId: string, userId: string, subjectId: string, dto: UpdateExamSubjectDto) {
    const existing = await this.assertSubject(tenantId, subjectId);
    if (existing.status === 'COMPLETED') throw new BadRequestException('Subject already completed.');

    const data: Prisma.ExamSubjectUpdateInput = {};
    if (dto.roomId !== undefined) data.room = dto.roomId ? { connect: { id: dto.roomId } } : { disconnect: true };
    if (dto.maxMarks !== undefined) data.maxMarks = dto.maxMarks;
    if (dto.passMarks !== undefined) data.passMarks = dto.passMarks;
    if (dto.durationMinutes !== undefined) data.durationMinutes = dto.durationMinutes;
    if (dto.pattern !== undefined) data.pattern = dto.pattern;
    if (dto.examDate !== undefined) data.examDate = dto.examDate ? new Date(dto.examDate) : null;
    if (dto.startTime !== undefined) data.startTime = dto.startTime;
    if (dto.endTime !== undefined) data.endTime = dto.endTime;
    if (dto.remarks !== undefined) data.remarks = dto.remarks;
    data.updatedBy = userId;

    const subject = await (this.tenantPrisma.client as Client).examSubject.update({
      where: { id: subjectId },
      data,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SUBJECT_UPDATED, 'ExamSubject', subject.id, {
      before: { maxMarks: existing.maxMarks, passMarks: existing.passMarks },
      after: { maxMarks: subject.maxMarks, passMarks: subject.passMarks },
    });
    return subject;
  }

  async changeSubjectStatus(tenantId: string, userId: string, subjectId: string, dto: SubjectStatusDto) {
    const existing = await this.assertSubject(tenantId, subjectId);
    if (existing.status === 'COMPLETED' && dto.status !== 'COMPLETED') {
      throw new BadRequestException('A completed subject cannot be re-opened.');
    }
    const subject = await (this.tenantPrisma.client as Client).examSubject.update({
      where: { id: subjectId },
      data: { status: dto.status as never, updatedBy: userId },
    });
    await this.audit(
      tenantId,
      userId,
      AUDIT_ACTIONS.EXAM_SUBJECT_STATUS_CHANGED,
      'ExamSubject',
      subject.id,
      { before: { status: existing.status }, after: { status: subject.status } },
    );
    return subject;
  }

  // ── Eligibility rules & evaluation ────────────────────────────────────────

  async getEligibilityRules(tenantId: string, userId: string, sessionId: string) {
    await this.assertSession(tenantId, sessionId);
    return (this.tenantPrisma.client as Client).examEligibilityRule.findMany({
      where: { tenantId, sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async setEligibilityRules(tenantId: string, userId: string, sessionId: string, dto: SetEligibilityRulesDto) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.status !== 'DRAFT' && session.status !== 'SCHEDULED') {
      throw new BadRequestException('Eligibility rules can only be edited before the exam begins.');
    }

    await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      for (const rule of dto.rules) {
        const data: Prisma.ExamEligibilityRuleUpsertArgs = {
          where: { tenantId_sessionId_ruleType: { tenantId, sessionId, ruleType: rule.ruleType as never } },
          create: {
            tenant: { connect: { id: tenantId } },
            session: { connect: { id: sessionId } },
            ruleType: rule.ruleType as never,
            enabled: rule.enabled ?? true,
            ...(rule.minAttendancePercent !== undefined
              ? { minAttendancePercent: rule.minAttendancePercent }
              : {}),
            remarks: rule.remarks,
            createdBy: userId,
          },
          update: {
            enabled: rule.enabled ?? true,
            ...(rule.minAttendancePercent !== undefined
              ? { minAttendancePercent: rule.minAttendancePercent }
              : {}),
            remarks: rule.remarks,
          },
        };
        await tx.examEligibilityRule.upsert(data);
      }
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_ELIGIBILITY_RULE_UPDATED, 'ExamSession', sessionId, {
      after: { rules: dto.rules },
    });
    return this.getEligibilityRules(tenantId, userId, sessionId);
  }

  async checkEligibility(tenantId: string, userId: string, sessionId: string, dto: CheckEligibilityDto) {
    const session = await this.assertSession(tenantId, sessionId);
    const rules = await (this.tenantPrisma.client as Client).examEligibilityRule.findMany({
      where: { tenantId, sessionId, enabled: true },
    });

    const students = dto.studentIds?.length
      ? await (this.tenantPrisma.client as Client).student.findMany({
          where: { id: { in: dto.studentIds }, tenantId, deletedAt: null },
        })
      : await (this.tenantPrisma.client as Client).student.findMany({
          where: {
            tenantId,
            deletedAt: null,
            programId: session.programId,
            status: { in: ['ENROLLED', 'ACTIVE'] as never },
          },
        });

    const results: EligibilityOutcome[] = [];
    for (const student of students) {
      results.push(
        await this.evaluateStudent(tenantId, session, rules as never, student as never),
      );
    }
    results.sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
    return { items: results, total: results.length };
  }

  /** Leaf eligibility check for one student given a session, its enabled rules and the tenant. */
  private async evaluateStudent(
    tenantId: string,
    session: { id: string; programId: string; termId: string | null },
    rules: { ruleType: string; minAttendancePercent: number | null }[],
    student: { id: string; status: string; programId: string; fullName: string; admissionNumber: string | null },
  ): Promise<EligibilityOutcome> {
    const reasons: EligibilityReason[] = [];
    let attendancePercent: number | null = null;

    // Prerequisite info is shared across students for this session; fetch only when the rule is enabled.
    let prerequisiteSubjects: PrerequisiteSubjectRow[] | null = null;

    for (const rule of rules) {
      switch (rule.ruleType) {
        case 'ACTIVE_STUDENT': {
          const satisfied = student.status === 'ACTIVE';
          reasons.push({
            ruleType: rule.ruleType,
            label: 'Active student',
            satisfied,
            detail: satisfied ? undefined : 'Student is not ACTIVE.',
          });
          break;
        }
        case 'PROGRAM_ENROLLMENT': {
          const satisfied = student.programId === session.programId;
          reasons.push({
            ruleType: rule.ruleType,
            label: 'Enrolled in the session program',
            satisfied,
            detail: satisfied ? undefined : 'Student is not enrolled in this session\'s program.',
          });
          break;
        }
        case 'MINIMUM_ATTENDANCE': {
          const threshold = rule.minAttendancePercent ?? DEFAULT_MIN_ATTENDANCE_PERCENT;
          attendancePercent = await this.attendancePercent(tenantId, student.id, session.termId);
          const satisfied = attendancePercent !== null && attendancePercent >= threshold;
          reasons.push({
            ruleType: rule.ruleType,
            label: `Minimum attendance (${threshold}%)`,
            satisfied,
            detail:
              attendancePercent === null
                ? 'No attendance records found for the term.'
                : satisfied
                  ? undefined
                  : `Attendance is ${attendancePercent}% below ${threshold}%.`,
          });
          break;
        }
        case 'CLEARED_PREREQUISITES': {
          if (prerequisiteSubjects === null) {
            prerequisiteSubjects = await (this.tenantPrisma.client as Client).examSubject.findMany({
              where: { tenantId, sessionId: session.id },
              select: {
                course: {
                  select: {
                    code: true,
                    name: true,
                    requiredBy: {
                      where: { tenantId },
                      select: { requiredCourse: { select: { id: true, code: true } } },
                    },
                  },
                },
              },
            }) as unknown as PrerequisiteSubjectRow[];
          }
          const subjectsWithPrereqs = prerequisiteSubjects ?? [];
          const unmet: string[] = [];
          for (const subject of subjectsWithPrereqs) {
            if (!subject.course.requiredBy.length) continue;
            for (const prereq of subject.course.requiredBy) {
              const cleared = await this.hasClearedCourse(tenantId, student.id, prereq.requiredCourse.id);
              if (!cleared) unmet.push(`${subject.course.code} → ${prereq.requiredCourse.code}`);
            }
          }
          const satisfied = unmet.length === 0;
          reasons.push({
            ruleType: rule.ruleType,
            label: 'Prerequisites cleared',
            satisfied,
            detail: satisfied ? undefined : `Missing: ${unmet.join(', ')}.`,
          });
          break;
        }
        case 'OPEN_BACKLOG': {
          const openBacklogs = await (this.tenantPrisma.client as Client).courseBacklog.count({
            where: { tenantId, studentId: student.id, status: 'OPEN' },
          });
          const satisfied = openBacklogs === 0;
          reasons.push({
            ruleType: rule.ruleType,
            label: 'No open backlogs',
            satisfied,
            detail: satisfied ? undefined : `Student has ${openBacklogs} open backlog(s).`,
          });
          break;
        }
        default:
          break;
      }
    }

    const eligible = reasons.length > 0 ? reasons.every((r) => r.satisfied) : true;
    return {
      studentId: student.id,
      fullName: student.fullName,
      admissionNumber: student.admissionNumber,
      eligible,
      attendancePercent,
      reasons,
    };
  }

  /** Convenience eligibility gate used when registering a single student (re-uses evaluateStudent). */
  private async evaluateRegistrationEligibility(
    tenantId: string,
    session: { id: string; programId: string; termId: string | null },
    studentId: string,
  ): Promise<{ eligible: boolean; reasons: EligibilityReason[] }> {
    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: {
        id: true,
        status: true,
        programId: true,
        fullName: true,
        admissionNumber: true,
      },
    });
    if (!student) throw new NotFoundException('Student not found.');
    const rules = await (this.tenantPrisma.client as Client).examEligibilityRule.findMany({
      where: { tenantId, sessionId: session.id, enabled: true },
      select: { ruleType: true, minAttendancePercent: true },
    });
    const result = await this.evaluateStudent(tenantId, session, rules as never, student as never);
    return { eligible: result.eligible, reasons: result.reasons };
  }

  // ── Registrations ─────────────────────────────────────────────────────────

  async listRegistrations(tenantId: string, userId: string, query: ListRegistrationsQueryDto) {
    const scope = await this.registrationScope(tenantId, userId);
    const where: Prisma.ExamRegistrationWhereInput = {
      tenantId,
      ...(scope ? scope : {}),
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.programId ? { session: { programId: query.programId } } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { student: { fullName: { contains: query.search, mode: 'insensitive' } } },
              { student: { admissionNumber: { contains: query.search, mode: 'insensitive' } } },
              { student: { rollNumber: { contains: query.search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).examRegistration.findMany({
        where,
        include: {
          session: { select: { id: true, name: true, code: true, examType: true, status: true } },
          student: {
            select: {
              id: true,
              fullName: true,
              admissionNumber: true,
              rollNumber: true,
              userId: true,
              program: { select: { id: true, code: true, name: true } },
            },
          },
          hallTicket: { select: { id: true, ticketNumber: true, status: true } },
          _count: { select: { marksEntries: true } },
        },
        orderBy: [{ registeredAt: 'desc' }, { createdAt: 'desc' }],
        ...this.page(query),
      }),
      (this.tenantPrisma.client as Client).examRegistration.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async getRegistration(tenantId: string, userId: string, registrationId: string) {
    const scope = await this.registrationScope(tenantId, userId);
    const registration = await (this.tenantPrisma.client as Client).examRegistration.findFirst({
      where: { id: registrationId, tenantId, ...(scope ? scope : {}) },
      include: {
        session: {
          select: {
            id: true, name: true, code: true, examType: true, isSupplementary: true, status: true,
            program: { select: { code: true, name: true } },
          },
        },
        student: {
          select: {
            id: true, fullName: true, admissionNumber: true, rollNumber: true, userId: true,
            program: { select: { code: true, name: true } },
            section: { select: { id: true, code: true, name: true } },
          },
        },
        hallTicket: {
          include: {
            subjects: {
              orderBy: { createdAt: 'asc' },
              include: { subject: { select: { id: true, courseId: true } } },
            },
          },
        },
        seatAllocations: {
          include: {
            plan: { include: { room: { select: { id: true, name: true, code: true } } } },
          },
        },
        marksEntries: {
          include: {
            subject: { select: { id: true, courseId: true } },
          },
        },
        revaluationRequests: true,
      },
    });
    if (!registration) throw new NotFoundException('Exam registration not found.');
    return registration;
  }

  async createRegistration(tenantId: string, userId: string, dto: CreateRegistrationDto) {
    const session = await this.assertSession(tenantId, dto.sessionId);
    if (!SESSION_ACTIONABLE_STATUSES.includes(session.status as (typeof SESSION_ACTIONABLE_STATUSES)[number])) {
      throw new BadRequestException('Registrations are closed for this session.');
    }
    const student = await this.assertStudent(tenantId, dto.studentId);
    if (student.programId !== session.programId) {
      throw new BadRequestException('Student is not enrolled in this session\'s program.');
    }

    const duplicate = await (this.tenantPrisma.client as Client).examRegistration.findFirst({
      where: { tenantId, sessionId: dto.sessionId, studentId: dto.studentId },
    });
    if (duplicate) throw new ConflictException('Student is already registered for this session.');

    const likelyEligible = await this.evaluateRegistrationEligibility(tenantId, session, student.id);
    if (!likelyEligible.eligible) {
      throw new BadRequestException(
        `Student is not eligible: ${likelyEligible.reasons.filter((r) => !r.satisfied).map((r) => r.detail ?? r.label).join('; ')}`,
      );
    }

    const registration = await (this.tenantPrisma.client as Client).examRegistration.create({
      data: {
        tenant: { connect: { id: tenantId } },
        session: { connect: { id: dto.sessionId } },
        student: { connect: { id: dto.studentId } },
        status: 'REGISTERED',
        remarks: dto.remarks,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_REGISTRATION_CREATED, 'ExamRegistration', registration.id, {
      after: { sessionId: dto.sessionId, studentId: dto.studentId },
    });
    return registration;
  }

  async bulkRegister(tenantId: string, userId: string, dto: BulkRegisterDto) {
    const session = await this.assertSession(tenantId, dto.sessionId);
    if (!SESSION_ACTIONABLE_STATUSES.includes(session.status as (typeof SESSION_ACTIONABLE_STATUSES)[number])) {
      throw new BadRequestException('Registrations are closed for this session.');
    }

    const studentWhere: Prisma.StudentWhereInput = { tenantId, deletedAt: null };
    if (dto.sectionId) studentWhere.sectionId = dto.sectionId;
    if (dto.batchId) studentWhere.batchId = dto.batchId;
    if (dto.studentIds?.length) studentWhere.id = { in: dto.studentIds };
    else studentWhere.programId = session.programId;

    const candidates = await (this.tenantPrisma.client as Client).student.findMany({
      where: studentWhere,
      select: { id: true, fullName: true, admissionNumber: true, programId: true, status: true },
    });

    const eligibleOnly = dto.eligibleOnly ?? true;
    const registered: string[] = [];
    const skipped: { studentId: string; reasons: string[] }[] = [];
    const already: string[] = [];

    for (const student of candidates) {
      if (student.programId !== session.programId) continue;
      const dup = await (this.tenantPrisma.client as Client).examRegistration.findFirst({
        where: { tenantId, sessionId: dto.sessionId, studentId: student.id },
        select: { id: true },
      });
      if (dup) {
        already.push(student.id);
        continue;
      }
      const result = await this.evaluateRegistrationEligibility(tenantId, session, student.id);
      if (eligibleOnly && !result.eligible) {
        skipped.push({
          studentId: student.id,
          reasons: result.reasons.filter((r) => !r.satisfied).map((r) => r.detail ?? r.label),
        });
        continue;
      }
      await (this.tenantPrisma.client as Client).examRegistration.create({
        data: {
          tenant: { connect: { id: tenantId } },
          session: { connect: { id: dto.sessionId } },
          student: { connect: { id: student.id } },
          status: 'REGISTERED',
          createdBy: userId,
          updatedBy: userId,
        },
      });
      registered.push(student.id);
    }

    if (registered.length) {
      await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_REGISTRATION_BULK_CREATED, 'ExamSession', dto.sessionId, {
        after: { count: registered.length, eligibleOnly },
      });
    }
    return { registered: registered.length, alreadyRegistered: already.length, skipped };
  }

  async updateRegistrationStatus(tenantId: string, userId: string, registrationId: string, dto: UpdateRegistrationStatusDto) {
    const existing = await this.assertRegistration(tenantId, registrationId);
    if (dto.status === 'CANCELLED') {
      const ticket = await (this.tenantPrisma.client as Client).examHallTicket.findFirst({
        where: { tenantId, registrationId },
        select: { id: true },
      });
      if (ticket) {
        throw new BadRequestException('Recall the hall ticket before cancelling the registration.');
      }
    }
    const registration = await (this.tenantPrisma.client as Client).examRegistration.update({
      where: { id: registrationId },
      data: { status: dto.status as never, remarks: dto.remarks ?? existing.remarks, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_REGISTRATION_STATUS_CHANGED, 'ExamRegistration', registration.id, {
      before: { status: existing.status },
      after: { status: registration.status },
    });
    return registration;
  }

  // ── Hall tickets ──────────────────────────────────────────────────────────

  async listHallTickets(tenantId: string, userId: string, query: ListHallTicketsQueryDto) {
    const scope = await this.hallTicketScope(tenantId, userId);
    const where: Prisma.ExamHallTicketWhereInput = {
      tenantId,
      ...(scope ? scope : {}),
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.studentId ? { registration: { studentId: query.studentId } } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { ticketNumber: { contains: query.search, mode: 'insensitive' } },
              { registration: { student: { fullName: { contains: query.search, mode: 'insensitive' } } } },
              { registration: { student: { admissionNumber: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).examHallTicket.findMany({
        where,
        include: {
          session: { select: { id: true, code: true, name: true, examType: true } },
          registration: {
            select: {
              id: true,
              student: {
                select: {
                  id: true, fullName: true, admissionNumber: true, rollNumber: true,
                  program: { select: { code: true, name: true } },
                },
              },
            },
          },
          subjects: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: [{ createdAt: 'desc' }],
        ...this.page(query),
      }),
      (this.tenantPrisma.client as Client).examHallTicket.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async getHallTicket(tenantId: string, userId: string, ticketId: string) {
    const scope = await this.hallTicketScope(tenantId, userId);
    const ticket = await (this.tenantPrisma.client as Client).examHallTicket.findFirst({
      where: { id: ticketId, tenantId, ...(scope ? scope : {}) },
      include: {
        session: {
          select: {
            id: true, code: true, name: true, examType: true, isSupplementary: true,
            program: { select: { code: true, name: true } },
          },
        },
        registration: {
          include: {
            student: {
              select: {
                id: true, fullName: true, admissionNumber: true, rollNumber: true, userId: true,
                program: { select: { code: true, name: true } },
                section: { select: { code: true, name: true } },
              },
            },
          },
        },
        subjects: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!ticket) throw new NotFoundException('Hall ticket not found.');
    return ticket;
  }

  async generateHallTickets(tenantId: string, userId: string, dto: GenerateHallTicketsDto) {
    const session = await this.assertSession(tenantId, dto.sessionId);
    if (session.status === 'DRAFT') {
      throw new BadRequestException('Publish the session (SCHEDULED) before generating hall tickets.');
    }

    const registrationWhere: Prisma.ExamRegistrationWhereInput = {
      tenantId,
      sessionId: dto.sessionId,
      status: { in: ['REGISTERED', 'CONFIRMED'] as never },
      hallTicket: null,
      ...(dto.studentIds?.length ? { studentId: { in: dto.studentIds } } : {}),
    };

    const registrations = await (this.tenantPrisma.client as Client).examRegistration.findMany({
      where: registrationWhere,
      include: {
        student: { select: { id: true, fullName: true } },
      },
      orderBy: { student: { rollNumber: 'asc' } },
    });

    const subjects = await (this.tenantPrisma.client as Client).examSubject.findMany({
      where: { tenantId, sessionId: dto.sessionId },
      include: {
        course: { select: { id: true, code: true, name: true } },
        room: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (subjects.length === 0) {
      throw new BadRequestException('Add subjects to the session before generating hall tickets.');
    }

    const existingTicketCount = await (this.tenantPrisma.client as Client).examHallTicket.count({
      where: { tenantId, sessionId: dto.sessionId },
    });

    const now = new Date();
    const prefix = `HT-${session.code.replace(/\s+/g, '-').toUpperCase()}`;
    const created: string[] = [];

    await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      for (const [index, registration] of registrations.entries()) {
        const serial = existingTicketCount + index + 1;
        const lines: Prisma.ExamHallTicketSubjectCreateWithoutHallTicketInput[] = [];
        for (const subject of subjects) {
          const seat = await tx.examSeatAllocation.findFirst({
            where: { tenantId, registrationId: registration.id, plan: { subjectId: subject.id } },
            include: { plan: { include: { room: { select: { name: true } } } } },
          });
          lines.push({
            tenant: { connect: { id: tenantId } },
            subject: { connect: { id: subject.id } },
            courseCode: subject.course.code,
            courseName: subject.course.name,
            maxMarks: subject.maxMarks,
            passMarks: subject.passMarks,
            examDate: subject.examDate,
            startTime: subject.startTime,
            endTime: subject.endTime,
            roomName: seat?.plan.room.name ?? subject.room?.name ?? null,
            seatNo: seat?.seatNo ?? null,
          });
        }
        const ticket = await tx.examHallTicket.create({
          data: {
            tenant: { connect: { id: tenantId } },
            registration: { connect: { id: registration.id } },
            session: { connect: { id: dto.sessionId } },
            ticketNumber: `${prefix}-${serial}`,
            status: 'ISSUED',
            issuedAt: now,
            issuedBy: userId,
            subjects: { create: lines },
          },
        });
        await tx.examRegistration.update({
          where: { id: registration.id },
          data: { status: 'CONFIRMED', updatedBy: userId },
        });
        created.push(ticket.id);
      }
    });

    for (const registration of registrations) {
      await this.notifyStudent(
        tenantId,
        registration.studentId,
        'Hall ticket issued',
        `Your hall ticket for ${session.name} (${session.code}) has been issued.`,
      );
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_HALL_TICKET_GENERATED, 'ExamSession', dto.sessionId, {
      after: { count: created.length, sessionCode: session.code },
    });
    return { generated: created.length, total: registrations.length };
  }

  async recallHallTicket(tenantId: string, userId: string, ticketId: string) {
    const ticket = await (this.tenantPrisma.client as Client).examHallTicket.findFirst({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException('Hall ticket not found.');
    await (this.tenantPrisma.client as Client).examHallTicket.delete({ where: { id: ticketId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_HALL_TICKET_RECALLED, 'ExamHallTicket', ticketId, {
      after: { ticketNumber: ticket.ticketNumber },
    });
    return { success: true };
  }

  // ── Seating plans & allocation ────────────────────────────────────────────

  async listSeatingPlans(tenantId: string, userId: string, query: ListSeatingPlansQueryDto) {
    const scope = await this.seatingPlanScope(tenantId, userId);
    const where: Prisma.ExamSeatingPlanWhereInput = {
      tenantId,
      ...(scope ? scope : {}),
      ...(query.sessionId ? { sessionId: query.sessionId } : {}),
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).examSeatingPlan.findMany({
        where,
        include: {
          room: { select: { id: true, code: true, name: true, capacity: true, buildingName: true } },
          subject: {
            select: {
              id: true,
              course: { select: { code: true, name: true } },
              examDate: true,
            },
          },
          session: { select: { id: true, code: true, name: true } },
          _count: { select: { allocations: true } },
        },
        orderBy: { createdAt: 'desc' },
        ...this.page(query),
      }),
      (this.tenantPrisma.client as Client).examSeatingPlan.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async getSeatingPlan(tenantId: string, userId: string, planId: string) {
    const scope = await this.seatingPlanScope(tenantId, userId);
    const plan = await (this.tenantPrisma.client as Client).examSeatingPlan.findFirst({
      where: { id: planId, tenantId, ...(scope ? scope : {}) },
      include: {
        room: { select: { id: true, code: true, name: true, buildingName: true } },
        subject: {
          select: {
            id: true,
            course: { select: { code: true, name: true } },
            maxMarks: true,
            examDate: true,
            startTime: true,
            endTime: true,
          },
        },
        session: { select: { id: true, code: true, name: true, examType: true } },
        allocations: {
          include: {
            registration: {
              include: {
                student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
              },
            },
          },
          orderBy: [{ status: 'asc' }, { seatNo: 'asc' }],
        },
      },
    });
    if (!plan) throw new NotFoundException('Seating plan not found.');
    return plan;
  }

  async createSeatingPlan(tenantId: string, userId: string, dto: CreateSeatingPlanDto) {
    await this.assertSession(tenantId, dto.sessionId);
    if (dto.subjectId) await this.assertSubject(tenantId, dto.subjectId);
    const room = await this.assertRoom(tenantId, dto.roomId);

    const plan = await (this.tenantPrisma.client as Client).examSeatingPlan.create({
      data: {
        tenant: { connect: { id: tenantId } },
        session: { connect: { id: dto.sessionId } },
        subject: dto.subjectId ? { connect: { id: dto.subjectId } } : undefined,
        room: { connect: { id: room.id } },
        label: dto.label,
        capacity: dto.capacity ?? room.capacity ?? null,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SEATING_PLAN_CREATED, 'ExamSeatingPlan', plan.id, {
      after: { sessionId: dto.sessionId, roomId: room.id, capacity: plan.capacity },
    });
    return plan;
  }

  async updateSeatingPlan(tenantId: string, userId: string, planId: string, dto: UpdateSeatingPlanDto) {
    const existing = await (this.tenantPrisma.client as Client).examSeatingPlan.findFirst({
      where: { id: planId, tenantId },
    });
    if (!existing) throw new NotFoundException('Seating plan not found.');
    if (dto.subjectId) await this.assertSubject(tenantId, dto.subjectId);
    if (dto.roomId) await this.assertRoom(tenantId, dto.roomId);

    const data: Prisma.ExamSeatingPlanUpdateInput = {
      subject: dto.subjectId ? { connect: { id: dto.subjectId } } : undefined,
      room: dto.roomId ? { connect: { id: dto.roomId } } : undefined,
      label: dto.label,
      capacity: dto.capacity,
    };
    const plan = await (this.tenantPrisma.client as Client).examSeatingPlan.update({
      where: { id: planId },
      data,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SEATING_PLAN_UPDATED, 'ExamSeatingPlan', planId, {
      before: { capacity: existing.capacity, roomId: existing.roomId },
      after: dto,
    });
    return plan;
  }

  async allocateSeating(tenantId: string, userId: string, planId: string) {
    const plan = await (this.tenantPrisma.client as Client).examSeatingPlan.findFirst({
      where: { id: planId, tenantId },
      include: { room: { select: { capacity: true } } },
    });
    if (!plan) throw new NotFoundException('Seating plan not found.');

    const registrations = await (this.tenantPrisma.client as Client).examRegistration.findMany({
      where: {
        tenantId,
        sessionId: plan.sessionId,
        status: { in: ['REGISTERED', 'CONFIRMED'] as never },
      },
      include: { student: { select: { rollNumber: true, admissionNumber: true } } },
      orderBy: [{ student: { rollNumber: 'asc' } }, { student: { admissionNumber: 'asc' } }],
    });

    const existing = await (this.tenantPrisma.client as Client).examSeatAllocation.findMany({
      where: { tenantId, planId },
      select: { registrationId: true },
    });
    const allocatedIds = new Set(existing.map((a) => a.registrationId));
    const toAllocate = registrations.filter((r) => !allocatedIds.has(r.id));

    const capacity = plan.capacity ?? plan.room.capacity ?? toAllocate.length;
    if (toAllocate.length > capacity) {
      throw new BadRequestException(
        `Room has ${capacity} seat(s) but ${toAllocate.length} registration(s) need allocating.`,
      );
    }

    const startSeat = allocatedIds.size + 1;
    await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      for (const [index, registration] of toAllocate.entries()) {
        await tx.examSeatAllocation.create({
          data: {
            tenant: { connect: { id: tenantId } },
            plan: { connect: { id: planId } },
            registration: { connect: { id: registration.id } },
            student: { connect: { id: registration.studentId } },
            seatNo: `${startSeat + index}`,
            status: 'ALLOCATED',
            createdBy: userId,
            updatedBy: userId,
          },
        });
      }
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SEAT_ALLOCATED, 'ExamSeatingPlan', planId, {
      after: { allocated: toAllocate.length },
    });
    return {
      allocated: toAllocate.length,
      alreadyAllocated: allocatedIds.size,
      capacity,
    };
  }

  async updateSeatAllocation(tenantId: string, userId: string, allocationId: string, dto: UpdateSeatAllocationDto) {
    const existing = await (this.tenantPrisma.client as Client).examSeatAllocation.findFirst({
      where: { id: allocationId, tenantId },
    });
    if (!existing) throw new NotFoundException('Seat allocation not found.');

    const data: Prisma.ExamSeatAllocationUpdateInput = {
      ...(dto.status ? { status: dto.status as never } : {}),
      ...(dto.seatNo ? { seatNo: dto.seatNo } : {}),
      updatedBy: userId,
    };
    try {
      const allocation = await (this.tenantPrisma.client as Client).examSeatAllocation.update({
        where: { id: allocationId },
        data,
      });
      await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SEAT_ALLOCATION_UPDATED, 'ExamSeatAllocation', allocationId, {
        before: { seatNo: existing.seatNo, status: existing.status },
        after: dto,
      });
      return allocation;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('That seat number is already taken in this plan.');
      }
      throw error;
    }
  }

  async deleteSeatingPlan(tenantId: string, userId: string, planId: string) {
    const existing = await (this.tenantPrisma.client as Client).examSeatingPlan.findFirst({
      where: { id: planId, tenantId },
    });
    if (!existing) throw new NotFoundException('Seating plan not found.');
    await (this.tenantPrisma.client as Client).examSeatingPlan.delete({ where: { id: planId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_SEATING_PLAN_DELETED, 'ExamSeatingPlan', planId, {
      before: { roomId: existing.roomId, capacity: existing.capacity },
    });
    return { success: true };
  }

  // ── Invigilators ──────────────────────────────────────────────────────────

  async assignInvigilator(tenantId: string, userId: string, subjectId: string, dto: AssignInvigilatorDto) {
    await this.assertSubject(tenantId, subjectId);
    await this.assertUser(tenantId, dto.userId);
    if (dto.roomId) await this.assertRoom(tenantId, dto.roomId);

    const role = dto.role ?? 'INVIGILATOR';
    const assignment = await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      if (role === 'CHIEF_INVIGILATOR') {
        await tx.examInvigilatorAssignment.updateMany({
          where: { tenantId, subjectId, role: 'CHIEF_INVIGILATOR' },
          data: { role: 'INVIGILATOR' },
        });
      }
      return tx.examInvigilatorAssignment.upsert({
        where: { tenantId_subjectId_userId: { tenantId, subjectId, userId: dto.userId } },
        create: {
          tenant: { connect: { id: tenantId } },
          subject: { connect: { id: subjectId } },
          user: { connect: { id: dto.userId } },
          role: role as never,
          room: dto.roomId ? { connect: { id: dto.roomId } } : undefined,
          assignedAt: dto.assignedAt ? new Date(dto.assignedAt) : new Date(),
          createdBy: userId,
        },
        update: {
          role: role as never,
          room: dto.roomId ? { connect: { id: dto.roomId } } : undefined,
          assignedAt: dto.assignedAt ? new Date(dto.assignedAt) : undefined,
        },
      });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_INVIGILATOR_ASSIGNED, 'ExamInvigilatorAssignment', assignment.id, {
      after: { subjectId, userId: dto.userId, role },
    });
    return assignment;
  }

  async updateInvigilator(tenantId: string, userId: string, assignmentId: string, dto: UpdateInvigilatorDto) {
    const existing = await (this.tenantPrisma.client as Client).examInvigilatorAssignment.findFirst({
      where: { id: assignmentId, tenantId },
    });
    if (!existing) throw new NotFoundException('Invigilator assignment not found.');
    if (dto.roomId) await this.assertRoom(tenantId, dto.roomId);

    const data: Prisma.ExamInvigilatorAssignmentUpdateInput = {
      role: dto.role ? (dto.role as never) : undefined,
      room: dto.roomId ? { connect: { id: dto.roomId } } : undefined,
      assignedAt: dto.assignedAt ? new Date(dto.assignedAt) : undefined,
    };
    const assignment = await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      if (dto.role === 'CHIEF_INVIGILATOR') {
        await tx.examInvigilatorAssignment.updateMany({
          where: { tenantId, subjectId: existing.subjectId, role: 'CHIEF_INVIGILATOR' },
          data: { role: 'INVIGILATOR' },
        });
      }
      return tx.examInvigilatorAssignment.update({ where: { id: assignmentId }, data });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_INVIGILATOR_UPDATED, 'ExamInvigilatorAssignment', assignmentId, {
      before: { role: existing.role, roomId: existing.roomId },
      after: dto,
    });
    return assignment;
  }

  async removeInvigilator(tenantId: string, userId: string, assignmentId: string) {
    const existing = await (this.tenantPrisma.client as Client).examInvigilatorAssignment.findFirst({
      where: { id: assignmentId, tenantId },
    });
    if (!existing) throw new NotFoundException('Invigilator assignment not found.');
    await (this.tenantPrisma.client as Client).examInvigilatorAssignment.delete({
      where: { id: assignmentId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_INVIGILATOR_REMOVED, 'ExamInvigilatorAssignment', assignmentId, {
      before: { userId: existing.userId },
    });
    return { success: true };
  }

  // ── Marks entry & approval workflow ─────────────────────────────────────────

  async listMarks(tenantId: string, userId: string, subjectId: string, query: ListMarksQueryDto) {
    await this.assertSubject(tenantId, subjectId);
    const scope = await this.marksScope(tenantId, userId);
    const where: Prisma.ExamMarksEntryWhereInput = {
      tenantId,
      subjectId,
      ...(scope ? scope : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { registration: { student: { fullName: { contains: query.search, mode: 'insensitive' } } } },
              { registration: { student: { admissionNumber: { contains: query.search, mode: 'insensitive' } } } },
              { registration: { student: { rollNumber: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).examMarksEntry.findMany({
        where,
        include: {
          registration: {
            include: {
              student: {
                select: { id: true, fullName: true, admissionNumber: true, rollNumber: true },
              },
            },
          },
          subject: { select: { id: true } },
        },
        orderBy: [{ createdAt: 'asc' }],
        ...this.page(query),
      }),
      (this.tenantPrisma.client as Client).examMarksEntry.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  private async resolveMarksRegistration(
    tenantId: string,
    sessionId: string,
    registrationId?: string,
    studentId?: string,
  ) {
    if (registrationId) {
      const registration = await (this.tenantPrisma.client as Client).examRegistration.findFirst({
        where: { id: registrationId, tenantId, sessionId },
      });
      if (!registration) {
        throw new NotFoundException('Registration not found in this subject\'s session.');
      }
      return registration;
    }
    if (studentId) {
      const registration = await (this.tenantPrisma.client as Client).examRegistration.findFirst({
        where: { tenantId, sessionId, studentId },
      });
      if (!registration) {
        throw new NotFoundException('Student is not registered in this subject\'s session.');
      }
      return registration;
    }
    throw new BadRequestException('Provide either registrationId or studentId.');
  }

  private async upsertMarksEntryFor(
    tenantId: string,
    userId: string,
    subjectId: string,
    dto: MarksEntryInputDto | UpsertMarksEntryDto,
  ) {
    const subject = await this.assertSubject(tenantId, subjectId);
    const registration = await this.resolveMarksRegistration(
      tenantId,
      subject.sessionId,
      dto.registrationId,
      dto.studentId,
    );

    const existing = await (this.tenantPrisma.client as Client).examMarksEntry.findFirst({
      where: { tenantId, registrationId: registration.id, subjectId },
    });
    if (existing && existing.status !== 'DRAFT') {
      throw new BadRequestException(
        'Marks for this student are already submitted/approved; record them again only after moderation reopens.',
      );
    }

    const marksObtained = dto.marksObtained ?? existing?.marksObtained ?? null;
    const graceMarks = dto.graceMarks ?? existing?.graceMarks ?? 0;
    if (marksObtained !== null && (marksObtained > subject.maxMarks || marksObtained < 0)) {
      throw new BadRequestException(`marksObtained must be between 0 and ${subject.maxMarks}.`);
    }
    if (marksObtained !== null && marksObtained + graceMarks > subject.maxMarks) {
      throw new BadRequestException('marksObtained + graceMarks cannot exceed maxMarks.');
    }

    const entry = await (this.tenantPrisma.client as Client).examMarksEntry.upsert({
      where: {
        tenantId_registrationId_subjectId: {
          tenantId,
          registrationId: registration.id,
          subjectId,
        },
      },
      create: {
        tenant: { connect: { id: tenantId } },
        registration: { connect: { id: registration.id } },
        subject: { connect: { id: subjectId } },
        student: { connect: { id: registration.studentId } },
        marksObtained,
        graceMarks,
        attendanceStatus: dto.attendanceStatus ?? existing?.attendanceStatus ?? 'PRESENT',
        remark: dto.remark ?? existing?.remark,
        createdBy: userId,
        updatedBy: userId,
      },
      update: {
        marksObtained,
        graceMarks,
        ...(dto.attendanceStatus ? { attendanceStatus: dto.attendanceStatus } : {}),
        ...(dto.remark !== undefined ? { remark: dto.remark } : {}),
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_MARKS_ENTRY_UPDATED, 'ExamMarksEntry', entry.id, {
      after: { registrationId: registration.id, subjectId, marksObtained, graceMarks },
    });
    return entry;
  }

  async upsertMarksEntry(tenantId: string, userId: string, subjectId: string, dto: UpsertMarksEntryDto) {
    return this.upsertMarksEntryFor(tenantId, userId, subjectId, dto);
  }

  async bulkMarks(tenantId: string, userId: string, subjectId: string, dto: BulkMarksDto) {
    const subject = await this.assertSubject(tenantId, subjectId);
    const entries: any[] = [];
    for (const line of dto.entries) {
      const registration = await this.resolveMarksRegistration(
        tenantId,
        subject.sessionId,
        line.registrationId,
        line.studentId,
      );
      const existing = await (this.tenantPrisma.client as Client).examMarksEntry.findFirst({
        where: { tenantId, registrationId: registration.id, subjectId },
      });
      const marksObtained = line.marksObtained ?? existing?.marksObtained ?? null;
      const graceMarks = line.graceMarks ?? existing?.graceMarks ?? 0;
      if (marksObtained !== null && marksObtained + graceMarks > subject.maxMarks) {
        throw new BadRequestException(`Marks for ${registration.studentId} exceed maxMarks.`);
      }
      entries.push({
        tenantId,
        registrationId: registration.id,
        subjectId,
        studentId: registration.studentId,
        marksObtained,
        graceMarks,
        attendanceStatus: line.attendanceStatus ?? existing?.attendanceStatus ?? 'PRESENT',
        remark: line.remark ?? existing?.remark,
        createdBy: userId,
        updatedBy: userId,
      });
    }

    await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      for (const line of entries) {
        await tx.examMarksEntry.upsert({
          where: {
            tenantId_registrationId_subjectId: {
              tenantId: line.tenantId,
              registrationId: line.registrationId,
              subjectId: line.subjectId,
            },
          },
          create: line,
          update: {
            marksObtained: line.marksObtained,
            graceMarks: line.graceMarks,
            attendanceStatus: line.attendanceStatus,
            ...(line.remark !== undefined ? { remark: line.remark } : {}),
            updatedBy: line.updatedBy,
          },
        });
      }
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_MARKS_ENTRY_BULK_CREATED, 'ExamSubject', subjectId, {
      after: { count: entries.length, subjectId },
    });
    return { upserted: entries.length };
  }

  private async transitionMarks(
    tenantId: string,
    userId: string,
    marksId: string,
    from: string | string[],
    to: string,
    action: string,
  ) {
    const entry = await (this.tenantPrisma.client as Client).examMarksEntry.findFirst({
      where: { id: marksId, tenantId },
      select: { id: true, status: true, registrationId: true, subjectId: true, studentId: true },
    });
    if (!entry) throw new NotFoundException('Marks entry not found.');
    const allowed = Array.isArray(from) ? from : [from];
    if (!allowed.includes(entry.status)) {
      throw new BadRequestException(`Cannot move marks entry from ${entry.status} to ${to}.`);
    }
    const now = new Date();
    const data: Prisma.ExamMarksEntryUpdateInput = {
      status: to as never,
      updatedBy: userId,
    };
    if (to === 'MODERATED') {
      data.moderatedBy = userId;
      data.moderatedAt = now;
    }
    if (to === 'APPROVED') {
      data.approvedBy = userId;
      data.approvedAt = now;
    }
    if (to === 'DRAFT') {
      data.moderatedBy = null;
      data.moderatedAt = null;
      data.approvedBy = null;
      data.approvedAt = null;
    }
    const updated = await (this.tenantPrisma.client as Client).examMarksEntry.update({
      where: { id: marksId },
      data,
    });
    void updated;
    await this.audit(tenantId, userId, action, 'ExamMarksEntry', marksId, {
      before: { status: entry.status },
      after: { status: to },
    });
    return { success: true, status: to };
  }

  async submitMarks(tenantId: string, userId: string, marksId: string) {
    return this.transitionMarks(tenantId, userId, marksId, 'DRAFT', 'SUBMITTED', AUDIT_ACTIONS.EXAM_MARKS_SUBMITTED);
  }

  async moderateMarks(tenantId: string, userId: string, marksId: string) {
    return this.transitionMarks(tenantId, userId, marksId, 'SUBMITTED', 'MODERATED', AUDIT_ACTIONS.EXAM_MARKS_MODERATED);
  }

  async approveMarks(tenantId: string, userId: string, marksId: string) {
    return this.transitionMarks(tenantId, userId, marksId, 'MODERATED', 'APPROVED', AUDIT_ACTIONS.EXAM_MARKS_APPROVED);
  }

  async rejectMarks(tenantId: string, userId: string, marksId: string, remark?: string) {
    const entry = await (this.tenantPrisma.client as Client).examMarksEntry.findFirst({
      where: { id: marksId, tenantId },
    });
    if (!entry) throw new NotFoundException('Marks entry not found.');
    if (entry.status !== 'SUBMITTED' && entry.status !== 'MODERATED') {
      throw new BadRequestException('Only submitted or moderated entries can be rejected.');
    }
    await this.transitionMarks(tenantId, userId, marksId, ['SUBMITTED', 'MODERATED'], 'DRAFT', AUDIT_ACTIONS.EXAM_MARKS_REJECTED);
    if (remark) {
      await (this.tenantPrisma.client as Client).examMarksEntry.update({
        where: { id: marksId },
        data: { remark, updatedBy: userId },
      });
    }
    return { success: true, status: 'DRAFT' };
  }

  async bulkSubmitMarks(tenantId: string, userId: string, subjectId: string) {
    await this.assertSubject(tenantId, subjectId);
    const result = await (this.tenantPrisma.client as Client).examMarksEntry.updateMany({
      where: { tenantId, subjectId, status: 'DRAFT' },
      data: { status: 'SUBMITTED', updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_MARKS_SUBMITTED, 'ExamSubject', subjectId, {
      after: { submitted: result.count, subjectId },
    });
    return { submitted: result.count };
  }

  async bulkModerateMarks(tenantId: string, userId: string, subjectId: string) {
    await this.assertSubject(tenantId, subjectId);
    const now = new Date();
    const result = await (this.tenantPrisma.client as Client).examMarksEntry.updateMany({
      where: { tenantId, subjectId, status: 'SUBMITTED' },
      data: { status: 'MODERATED', moderatedBy: userId, moderatedAt: now, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_MARKS_MODERATED, 'ExamSubject', subjectId, {
      after: { moderated: result.count, subjectId },
    });
    return { moderated: result.count };
  }

  // ── Revaluation ───────────────────────────────────────────────────────────

  async listRevaluation(tenantId: string, userId: string, query: ListRevaluationQueryDto) {
    const regScope = await this.registrationScope(tenantId, userId);
    const where: Prisma.ExamRevaluationRequestWhereInput = {
      tenantId,
      ...(regScope ? { registration: regScope } : {}),
      ...(query.studentId ? { registration: { studentId: query.studentId } } : {}),
      ...(query.status ? { status: query.status as never } : {}),
      ...(query.search
        ? {
            OR: [
              { registration: { student: { fullName: { contains: query.search, mode: 'insensitive' } } } },
              { registration: { student: { admissionNumber: { contains: query.search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).examRevaluationRequest.findMany({
        where,
        include: {
          registration: {
            include: {
              student: {
                select: { id: true, fullName: true, admissionNumber: true, rollNumber: true, userId: true },
              },
            },
          },
          subject: {
            select: { id: true, course: { select: { code: true, name: true } }, maxMarks: true, passMarks: true },
          },
          marksEntry: true,
        },
        orderBy: [{ requestedAt: 'desc' }],
        ...this.page(query),
      }),
      (this.tenantPrisma.client as Client).examRevaluationRequest.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async requestRevaluation(tenantId: string, userId: string, dto: CreateRevaluationDto) {
    const registration = await this.assertRegistration(tenantId, dto.registrationId);
    const subject = await this.assertSubject(tenantId, dto.subjectId);
    if (registration.sessionId !== subject.sessionId) {
      throw new BadRequestException('Registration and subject must belong to the same session.');
    }
    const existing = await (this.tenantPrisma.client as Client).examRevaluationRequest.findFirst({
      where: {
        tenantId,
        registrationId: registration.id,
        subjectId: subject.id,
      },
    });
    if (existing) {
      if (existing.status === 'RESOLVED' || existing.status === 'REJECTED') {
        throw new ConflictException('A resolved revaluation already exists for this subject.');
      }
      throw new ConflictException('A revaluation request is already pending for this subject.');
    }

    const request = await (this.tenantPrisma.client as Client).examRevaluationRequest.create({
      data: {
        tenant: { connect: { id: tenantId } },
        registration: { connect: { id: registration.id } },
        subject: { connect: { id: subject.id } },
        marksEntry: dto.marksEntryId ? { connect: { id: dto.marksEntryId } } : undefined,
        reason: dto.reason,
        requestedBy: userId,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_REVALUATION_REQUESTED, 'ExamRevaluationRequest', request.id, {
      after: { registrationId: registration.id, subjectId: subject.id },
    });
    return request;
  }

  async resolveRevaluation(tenantId: string, userId: string, requestId: string, dto: ResolveRevaluationDto) {
    const request = await (this.tenantPrisma.client as Client).examRevaluationRequest.findFirst({
      where: { id: requestId, tenantId },
      include: {
        registration: { select: { id: true, sessionId: true, studentId: true } },
        subject: { select: { id: true, courseId: true, maxMarks: true, passMarks: true } },
        marksEntry: true,
      },
    });
    if (!request) throw new NotFoundException('Revaluation request not found.');
    if (request.status === 'RESOLVED' || request.status === 'REJECTED') {
      throw new BadRequestException('This revaluation request is already closed.');
    }
    if (dto.status === 'RESOLVED' && (dto.revisedMarks === undefined)) {
      throw new BadRequestException('Provide revisedMarks when resolving a revaluation.');
    }
    if ((dto.revisedMarks ?? 0) > request.subject.maxMarks) {
      throw new BadRequestException('revisedMarks cannot exceed the subject maxMarks.');
    }

    const session = await this.assertSession(tenantId, request.registration.sessionId);
    const now = new Date();

    await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      let marksEntryId = request.marksEntryId ?? null;
      if (dto.status === 'RESOLVED' && dto.revisedMarks !== undefined) {
        const entry = await tx.examMarksEntry.upsert({
          where: {
            tenantId_registrationId_subjectId: {
              tenantId,
              registrationId: request.registration.id,
              subjectId: request.subject.id,
            },
          },
          create: {
            tenant: { connect: { id: tenantId } },
            registration: { connect: { id: request.registration.id } },
            subject: { connect: { id: request.subject.id } },
            student: { connect: { id: request.registration.studentId } },
            marksObtained: dto.revisedMarks,
            graceMarks: 0,
            attendanceStatus: 'PRESENT',
            status: 'APPROVED',
            approvedBy: userId,
            approvedAt: now,
            createdBy: userId,
            updatedBy: userId,
          },
          update: {
            marksObtained: dto.revisedMarks,
            graceMarks: 0,
            status: 'APPROVED',
            approvedBy: userId,
            approvedAt: now,
            updatedBy: userId,
          },
        });
        marksEntryId = entry.id;
      }

      await tx.examRevaluationRequest.update({
        where: { id: requestId },
        data: {
          status: dto.status as never,
          resolvedBy: userId,
          resolvedAt: now,
          revisedMarks: dto.revisedMarks ?? null,
          remark: dto.remark,
          ...(marksEntryId ? { marksEntry: { connect: { id: marksEntryId } } } : {}),
        },
      });

      // If results were already published, refresh the affected 360 result row so the published
      // outcome stays consistent with the revalued marks.
      if (session.resultPublishedAt && dto.status === 'RESOLVED' && dto.revisedMarks !== undefined) {
        await this.syncOnePublishedResult(tx, tenantId, session.id, request.registration.studentId, request.subject.id, dto.revisedMarks, userId, now);
      }
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_REVALUATION_RESOLVED, 'ExamRevaluationRequest', requestId, {
      before: { status: request.status },
      after: dto,
    });
    return (this.tenantPrisma.client as Client).examRevaluationRequest.findFirst({ where: { id: requestId, tenantId } });
  }

  /** Recompute & replace the published StudentResult of one student's subject after revaluation. */
  private async syncOnePublishedResult(
    tx: Prisma.TransactionClient,
    tenantId: string,
    sessionId: string,
    studentId: string,
    subjectId: string,
    marksObtained: number,
    userId: string,
    now: Date,
  ) {
    const exam = await tx.studentExam.findFirst({
      where: { tenantId, studentId, sessionId },
      select: { id: true, session: { include: { subjects: { where: { id: subjectId } } } } },
    });
    if (!exam) return;
    const subject = exam.session?.subjects?.[0];
    if (!subject) return;
    const course = await tx.course.findFirst({
      where: { id: subject.courseId },
      select: { code: true, name: true },
    });
    if (!course) return;
    const score = marksObtained;
    await tx.studentResult.deleteMany({
      where: { tenantId, studentId, examId: exam.id, subjectCode: course.code },
    });
    const outcome =
      subject.passMarks > 0 && score >= subject.passMarks ? ResultOutcome.PASS : ResultOutcome.FAIL;
    await tx.studentResult.create({
      data: {
        tenant: { connect: { id: tenantId } },
        student: { connect: { id: studentId } },
        exam: { connect: { id: exam.id } },
        subjectCode: course.code,
        subjectName: course.name,
        maxMarks: subject.maxMarks,
        obtainedMarks: score,
        percentage: subject.maxMarks > 0 ? Math.round((score / subject.maxMarks) * 10000) / 100 : null,
        outcome,
        publishedAt: now,
        publishedBy: userId,
        remarks: 'Updated by revaluation.',
        createdBy: userId,
      },
    });
  }

  // ── Result publication ──────────────────────────────────────────────────────

  /**
   * Publishes a session's approved marks: idempotently upserts the student-360 StudentExam row
   * (linked via sessionId), rebuilds the per-subject StudentResult rows, records OPEN backlogs for
   * failed papers and clears OPEN backlogs for supplementary-pass papers. Marks the session
   * COMPLETED and stamps resultPublishedAt/By.
   */
  async publishResults(tenantId: string, userId: string, sessionId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.status === 'DRAFT' || session.status === 'CANCELLED') {
      throw new BadRequestException('Cannot publish results for a DRAFT or CANCELLED session.');
    }

    const entries = await (this.tenantPrisma.client as Client).examMarksEntry.findMany({
      where: { tenantId, status: 'APPROVED', subject: { sessionId } },
      include: {
        subject: {
          include: { course: { select: { id: true, code: true, name: true } } },
        },
        registration: {
          include: {
            student: {
              select: { id: true, fullName: true, admissionNumber: true, userId: true },
            },
          },
        },
      },
    });
    if (entries.length === 0) {
      throw new BadRequestException('No approved marks exist for this session yet.');
    }

    const byRegistration = new Map<string, typeof entries>();
    for (const entry of entries) {
      const group = byRegistration.get(entry.registrationId) ?? [];
      group.push(entry);
      byRegistration.set(entry.registrationId, group);
    }

    const now = new Date();
    await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      for (const [registrationId, regEntries] of byRegistration) {
        const first = regEntries[0]!;
        const studentId = first.registration.student.id;
        const registration = await tx.examRegistration.findFirst({
          where: { id: registrationId, tenantId },
        });
        if (!registration) throw new NotFoundException('Registration vanished during publication.');

        const exam = await tx.studentExam.upsert({
          where: {
            tenantId_studentId_sessionId: { tenantId, studentId, sessionId },
          },
          create: {
            tenant: { connect: { id: tenantId } },
            student: { connect: { id: studentId } },
            name: session.name,
            examType: session.examType as never,
            term: session.termId ? { connect: { id: session.termId } } : undefined,
            program: { connect: { id: session.programId } },
            startDate: session.startDate,
            endDate: session.endDate,
            status: 'COMPLETED' as never,
            session: { connect: { id: sessionId } },
            createdBy: userId,
          },
          update: {
            name: session.name,
            examType: session.examType as never,
            term: session.termId ? { connect: { id: session.termId } } : undefined,
            program: { connect: { id: session.programId } },
            startDate: session.startDate,
            endDate: session.endDate,
            status: 'COMPLETED' as never,
          },
        });

        await tx.studentResult.deleteMany({
          where: { tenantId, studentId, examId: exam.id },
        });

        for (const entry of regEntries) {
          const marksObtained = entry.marksObtained ?? 0;
          const score = marksObtained + entry.graceMarks;
          const subject = entry.subject;
          const outcome =
            entry.attendanceStatus === 'ABSENT'
              ? ResultOutcome.INCOMPLETE
              : score >= subject.passMarks
                ? entry.graceMarks > 0
                  ? ResultOutcome.PASS_WITH_GRACE
                  : ResultOutcome.PASS
                : ResultOutcome.FAIL;

          await tx.studentResult.create({
            data: {
              tenant: { connect: { id: tenantId } },
              student: { connect: { id: studentId } },
              exam: { connect: { id: exam.id } },
              subjectCode: subject.course.code,
              subjectName: subject.course.name,
              maxMarks: subject.maxMarks,
              obtainedMarks: score,
              percentage:
                subject.maxMarks > 0
                  ? Math.round((score / subject.maxMarks) * 10000) / 100
                  : null,
              outcome,
              publishedAt: now,
              publishedBy: userId,
              remarks: entry.remark ?? undefined,
              createdBy: userId,
            },
          });

          if (outcome === ResultOutcome.FAIL && session.termId) {
            await tx.courseBacklog.upsert({
              where: {
                tenantId_studentId_courseId_termId: {
                  tenantId,
                  studentId,
                  courseId: subject.courseId,
                  termId: session.termId,
                },
              },
              create: {
                tenant: { connect: { id: tenantId } },
                student: { connect: { id: studentId } },
                course: { connect: { id: subject.courseId } },
                term: { connect: { id: session.termId } },
                status: 'OPEN',
                createdBy: userId,
              },
              update: {},
            });
          }

          if (
            session.isSupplementary &&
            (outcome === ResultOutcome.PASS || outcome === ResultOutcome.PASS_WITH_GRACE)
          ) {
            await tx.courseBacklog.updateMany({
              where: { tenantId, studentId, courseId: subject.courseId, status: 'OPEN' },
              data: { status: 'CLEARED', clearedAt: now, updatedBy: userId },
            });
          }
        }
      }
    });

    await (this.tenantPrisma.client as Client).examSession.update({
      where: { id: sessionId },
      data: {
        status: 'COMPLETED',
        resultPublishedAt: now,
        resultPublishedBy: userId,
        updatedBy: userId,
      },
    });

    for (const [, regEntries] of byRegistration) {
      const student = regEntries[0]!.registration.student;
      await this.notifyStudent(
        tenantId,
        student.id,
        'Results published',
        `Results for ${session.name} (${session.code}) have been published.`,
      );
    }

    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_RESULT_PUBLISHED, 'ExamSession', sessionId, {
      after: { publishedStudents: byRegistration.size, sessionCode: session.code },
    });
    return {
      publishedStudents: byRegistration.size,
      publishedSubjectRows: entries.length,
      sessionCode: session.code,
    };
  }

  async unpublishResults(tenantId: string, userId: string, sessionId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    if (!session.resultPublishedAt) {
      throw new BadRequestException('Results for this session are not published.');
    }
    const syncedExams = await (this.tenantPrisma.client as Client).studentExam.findMany({
      where: { tenantId, sessionId },
      select: { id: true },
    });
    const examIds = syncedExams.map((e) => e.id);
    if (examIds.length === 0) {
      throw new BadRequestException('No synced result rows to unpublish.');
    }

    await (this.tenantPrisma.client as Client).$transaction(async (tx) => {
      await tx.studentResult.deleteMany({ where: { tenantId, examId: { in: examIds } } });
      await tx.studentExam.deleteMany({ where: { tenantId, sessionId } });
      await tx.examSession.update({
        where: { id: sessionId },
        data: { resultPublishedAt: null, resultPublishedBy: null, updatedBy: userId },
      });
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.EXAM_RESULT_UNPUBLISHED, 'ExamSession', sessionId, {
      before: { publishedAt: session.resultPublishedAt },
    });
    return { success: true };
  }
}