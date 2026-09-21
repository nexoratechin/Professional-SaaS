/**
 * Results service — a fully configurable result calculation engine on top of the exams module.
 *
 * Marks capture & moderation stay in the exams module (DRAFT → SUBMITTED → MODERATED → APPROVED);
 * this service consumes APPROVED marks and derives grades, grade points, GPA/CGPA, passing rules,
 * grace marks (only when configured), per-session approval → publication → locking, and an
 * append-only history trail — all driven by tenant data (GradingScheme/GradeScale/
 * AssessmentComponent), never by hard-coded college rules.
 *
 * Lifecycle of one student's whole-session result (ResultProcess):
 *   CALCULATED → APPROVED → PUBLISHED → LOCKED   (PUBLISHED may UNPUBLISH, LOCKED may UNLOCK)
 * Publication syncs the student-360 StudentExam/StudentResult rows and upserts/clears
 * CourseBacklog rows exactly like the exams publish flow, so results stay consistent with the
 * rest of the platform. Recalculation is refused while a process is PUBLISHED or LOCKED.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type PrismaClient,
  BacklogStatus,
  ExamStatus,
  ResultOutcome,
  ResultStanding,
  ResultState,
} from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { examSubjectScopeFilter } from '../exams/exams-scope';
import {
  resultsProcessScopeFilter,
  resultsRegistrationScopeFilter,
  resultsSessionScopeFilter,
} from './results-scope';
import {
  BulkProcessActionDto,
  CalculateSessionDto,
  CreateComponentDto,
  CreateGradingSchemeDto,
  ListProcessesQueryDto,
  ListComponentsQueryDto,
  ListMarksEntriesQueryDto,
  ReplaceGradeScaleDto,
  ResultsPaginationDto,
  SaveComponentMarksDto,
  SessionResultConfigDto,
  UpdateComponentDto,
  UpdateGradingSchemeDto,
  UpsertGradeScaleItemDto,
} from './dto/results.dto';

type Client = PrismaClient;

const DEFAULT_SCALE: UpsertGradeScaleItemDto[] = [
  { grade: 'O', minPercent: 90, maxPercent: 100, gradePoint: 10, gradeDescription: 'Outstanding' },
  { grade: 'A+', minPercent: 80, maxPercent: 89.99, gradePoint: 9, gradeDescription: 'Excellent' },
  { grade: 'A', minPercent: 70, maxPercent: 79.99, gradePoint: 8, gradeDescription: 'Very good' },
  { grade: 'B+', minPercent: 60, maxPercent: 69.99, gradePoint: 7, gradeDescription: 'Good' },
  { grade: 'B', minPercent: 50, maxPercent: 59.99, gradePoint: 6, gradeDescription: 'Above average' },
  { grade: 'C', minPercent: 40, maxPercent: 49.99, gradePoint: 5, gradeDescription: 'Average' },
  { grade: 'D', minPercent: 35, maxPercent: 39.99, gradePoint: 4, gradeDescription: 'Below average' },
  { grade: 'E', minPercent: 25, maxPercent: 34.99, gradePoint: 2, gradeDescription: 'Marginal' },
  { grade: 'F', minPercent: 0, maxPercent: 24.99, gradePoint: 0, gradeDescription: 'Fail' },
];

type GracePolicy = { enabled?: boolean; maxGraceMarks?: number; graceToPassDiff?: number };

type SchemeRow = Prisma.GradingSchemeGetPayload<{ include: { gradeScale: true } }>;
type ScaleBand = Prisma.GradeScaleGetPayload<{
  select: { id: true; grade: true; minPercent: true; maxPercent: true; gradePoint: true; gradeDescription: true };
}>;
type SubjectRow = Prisma.ExamSubjectGetPayload<{ include: { course: { select: { id: true; code: true; name: true; creditHours: true } } } }>;
type MarksRow = Prisma.ExamMarksEntryGetPayload<{ include: { subject: { include: { course: true } } } }>;
type BreakdownRow = {
  componentId: string;
  code: string;
  name: string;
  kind: string;
  weightage: number;
  maxMarks: number;
  marksObtained: number;
  weighted: number;
};
type PaperResult = {
  subject: SubjectRow;
  entry: MarksRow | null;
  breakdown: BreakdownRow[];
  rawMarks: number | null;
  graceApplied: number;
  effectiveMarks: number | null;
  percentage: number | null;
  grade: string | null;
  gradePoint: number | null;
  outcome: ResultOutcome;
};

@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Shared helpers ────────────────────────────────────────────────────────

  private client(): Client {
    return this.tenantPrisma.client as Client;
  }

  private async grants(tenantId: string, userId: string) {
    return this.permissionsService.getScopeGrantsFor(tenantId, userId, 'results.view');
  }

  private async sessionScope(tenantId: string, userId: string) {
    return resultsProcessScopeFilter(await this.grants(tenantId, userId), userId);
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
      module: 'results',
      entityType,
      entityId,
      before: payload.before,
      after: payload.after,
    });
  }

  private round(value: number, decimals: number): number {
    const factor = 10 ** decimals;
    return Math.round(value * factor) / factor;
  }

  private async assertSession(tenantId: string, sessionId: string) {
    const session = await this.client().examSession.findFirst({
      where: { id: sessionId, tenantId, deletedAt: null },
    });
    if (!session) throw new NotFoundException('Exam session not found.');
    return session;
  }

  private async assertSubject(tenantId: string, subjectId: string) {
    const subject = await this.client().examSubject.findFirst({
      where: { id: subjectId, tenantId },
      include: { course: { select: { id: true, code: true, name: true, creditHours: true } } },
    });
    if (!subject) throw new NotFoundException('Exam subject not found.');
    return subject;
  }

  private async assertStudent(tenantId: string, studentId: string) {
    const student = await this.client().student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException('Student not found.');
    return student;
  }

  private async notifyStudent(tenantId: string, studentId: string, subject: string, body: string) {
    try {
      const student = await this.client().student.findFirst({
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

  private async recordHistory(
    tx: Client,
    params: {
      tenantId: string;
      sessionId: string;
      processId?: string;
      studentId?: string;
      event: string;
      fromState?: ResultState;
      toState?: ResultState;
      details?: Prisma.InputJsonValue;
      actorUserId?: string;
    },
  ) {
    await tx.resultHistory.create({
      data: {
        tenantId: params.tenantId,
        sessionId: params.sessionId,
        processId: params.processId ?? null,
        studentId: params.studentId ?? null,
        event: params.event,
        fromState: params.fromState,
        toState: params.toState,
        details: params.details,
        actorUserId: params.actorUserId ?? null,
      },
    });
  }

  private page(query: ResultsPaginationDto) {
    return { skip: query.skip ?? 0, take: query.take ?? 100 };
  }

  // ── Grading schemes ───────────────────────────────────────────────────────

  async ensureDefaultScheme(tenantId: string): Promise<SchemeRow> {
    const existing = await this.client().gradingScheme.findFirst({
      where: { tenantId, isDefault: true, deletedAt: null },
      include: { gradeScale: true },
    });
    if (existing) return existing;

    const created = await this.client().gradingScheme.create({
      data: {
        tenantId,
        code: 'DEFAULT',
        name: 'Default grading scheme',
        description:
          'Editable bootstrap scheme (10-point scale, 40% pass). Change values from the Results UI — nothing is hard-coded.',
        passMode: 'PERCENTAGE' as const,
        minPassPercent: 40,
        minPassGradePoint: 5,
        weightingMode: 'CREDIT_WEIGHTED' as const,
        gpaMax: 10,
        graceEnabled: false,
        maxGraceMarks: 0,
        graceToPassDiff: 0,
        roundingDecimals: 2,
        isDefault: true,
        isActive: true,
        gradeScale: {
          create: DEFAULT_SCALE.map((band) => ({ ...band, tenantId })),
        },
      },
      include: { gradeScale: true },
    });
    return created;
  }

  async listSchemes(tenantId: string, userId: string, query: ResultsPaginationDto) {
    const { skip, take } = this.page(query);
    const where: Prisma.GradingSchemeWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.client().gradingScheme.findMany({
        where,
        include: { gradeScale: { orderBy: { minPercent: 'asc' } } },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        skip,
        take,
      }),
      this.client().gradingScheme.count({ where }),
    ]);
    return { items, total };
  }

  async getScheme(tenantId: string, userId: string, schemeId: string) {
    void userId;
    const scheme = await this.client().gradingScheme.findFirst({
      where: { id: schemeId, tenantId, deletedAt: null },
      include: { gradeScale: { orderBy: { minPercent: 'asc' } } },
    });
    if (!scheme) throw new NotFoundException('Grading scheme not found.');
    return scheme;
  }

  async createScheme(tenantId: string, userId: string, dto: CreateGradingSchemeDto) {
    const existingCode = await this.client().gradingScheme.findFirst({
      where: { tenantId, code: dto.code, deletedAt: null },
    });
    if (existingCode) throw new ConflictException('A grading scheme with this code already exists.');

    const scheme = await this.client().gradingScheme.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        passMode: dto.passMode ?? 'PERCENTAGE',
        minPassPercent: dto.minPassPercent,
        minPassGradePoint: dto.minPassGradePoint,
        weightingMode: dto.weightingMode ?? 'CREDIT_WEIGHTED',
        gpaMax: dto.gpaMax ?? 10,
        graceEnabled: dto.graceEnabled ?? false,
        maxGraceMarks: dto.maxGraceMarks ?? 0,
        graceToPassDiff: dto.graceToPassDiff ?? 0,
        roundingDecimals: dto.roundingDecimals ?? 2,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
        createdBy: userId,
        gradeScale: dto.gradeScale?.length
          ? { create: dto.gradeScale.map((band) => ({ ...band, tenantId })) }
          : { create: DEFAULT_SCALE.map((band) => ({ ...band, tenantId })) },
      },
      include: { gradeScale: true },
    });

    if (scheme.isDefault) {
      await this.client().gradingScheme.updateMany({
        where: { tenantId, id: { not: scheme.id }, isDefault: true },
        data: { isDefault: false },
      });
    }

    await this.audit(tenantId, userId, AUDIT_ACTIONS.GRADING_SCHEME_CREATED, 'GradingScheme', scheme.id, {
      after: { code: scheme.code, name: scheme.name },
    });
    return scheme;
  }

  async updateScheme(tenantId: string, userId: string, schemeId: string, dto: UpdateGradingSchemeDto) {
    const scheme = await this.getScheme(tenantId, userId, schemeId);
    const updated = await this.client().gradingScheme.update({
      where: { id: scheme.id },
      data: {
        name: dto.name,
        description: dto.description,
        passMode: dto.passMode,
        minPassPercent: dto.minPassPercent,
        minPassGradePoint: dto.minPassGradePoint,
        weightingMode: dto.weightingMode,
        gpaMax: dto.gpaMax,
        graceEnabled: dto.graceEnabled,
        maxGraceMarks: dto.maxGraceMarks,
        graceToPassDiff: dto.graceToPassDiff,
        roundingDecimals: dto.roundingDecimals,
        isActive: dto.isActive,
        updatedBy: userId,
      },
      include: { gradeScale: true },
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.GRADING_SCHEME_UPDATED, 'GradingScheme', scheme.id, {
      before: { name: scheme.name },
      after: { name: updated.name, passMode: updated.passMode },
    });
    return updated;
  }

  async replaceSchemeScale(tenantId: string, userId: string, schemeId: string, dto: ReplaceGradeScaleDto) {
    const scheme = await this.getScheme(tenantId, userId, schemeId);

    await this.client().$transaction(async (tx) => {
      await (tx as Client).gradeScale.deleteMany({ where: { tenantId, schemeId: scheme.id } });
      await (tx as Client).gradeScale.createMany({
        data: dto.items.map((item) => ({ tenantId, schemeId: scheme.id, ...item })),
      });
    });

    await this.client().gradingScheme.update({
      where: { id: scheme.id },
      data: { updatedBy: userId },
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.GRADE_SCALE_UPDATED, 'GradingScheme', scheme.id, {
      after: { bandCount: dto.items.length },
    });
    return this.getScheme(tenantId, userId, schemeId);
  }

  async makeDefaultScheme(tenantId: string, userId: string, schemeId: string) {
    const scheme = await this.getScheme(tenantId, userId, schemeId);
    await this.client().$transaction(async (tx) => {
      await (tx as Client).gradingScheme.updateMany({
        where: { tenantId, id: { not: scheme.id }, isDefault: true },
        data: { isDefault: false, updatedBy: userId },
      });
      await (tx as Client).gradingScheme.update({
        where: { id: scheme.id },
        data: { isDefault: true, updatedBy: userId },
      });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.GRADING_SCHEME_UPDATED, 'GradingScheme', scheme.id, {
      after: { isDefault: true },
    });
    return this.getScheme(tenantId, userId, schemeId);
  }

  async deleteScheme(tenantId: string, userId: string, schemeId: string) {
    const scheme = await this.getScheme(tenantId, userId, schemeId);
    if (scheme.isDefault) throw new BadRequestException('The default grading scheme cannot be deleted.');
    const used = await this.client().examSession.count({
      where: { tenantId, gradingSchemeId: scheme.id },
    });
    if (used > 0) throw new BadRequestException('This scheme is referenced by exam sessions and cannot be deleted.');
    await this.client().gradingScheme.update({
      where: { id: scheme.id },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.GRADING_SCHEME_UPDATED, 'GradingScheme', scheme.id, {
      after: { deletedAt: true },
    });
    return { success: true };
  }

  // ── Session result configuration ──────────────────────────────────────────

  async getSessionConfig(tenantId: string, userId: string, sessionId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    return {
      sessionId,
      name: session.name,
      code: session.code,
      gradingSchemeId: session.gradingSchemeId,
      gradingScheme: session.gradingSchemeId
        ? await this.getScheme(tenantId, userId, session.gradingSchemeId)
        : await this.ensureDefaultScheme(tenantId),
      gracePolicy: session.gracePolicy ?? { enabled: false, maxGraceMarks: 0, graceToPassDiff: 0 },
      resultsLockedAt: session.resultsLockedAt,
      resultPublishedAt: session.resultPublishedAt,
    };
  }

  async updateSessionConfig(tenantId: string, userId: string, sessionId: string, dto: SessionResultConfigDto) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.resultsLockedAt) {
      throw new BadRequestException('Results are locked for this session; unlock before changing its configuration.');
    }
    if (dto.gradingSchemeId) {
      await this.getScheme(tenantId, userId, dto.gradingSchemeId);
    }
    const updated = await this.client().examSession.update({
      where: { id: session.id },
      data: {
        gradingSchemeId: dto.gradingSchemeId,
        gracePolicy: dto.gracePolicy as Prisma.InputJsonValue | undefined,
        remarks: dto.remarks,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_CALCULATED, 'ExamSession', session.id, {
      before: { gradingSchemeId: session.gradingSchemeId },
      after: { gradingSchemeId: updated.gradingSchemeId, gracePolicy: updated.gracePolicy },
    });
    return this.getSessionConfig(tenantId, userId, sessionId);
  }

  async lockSessionResults(tenantId: string, userId: string, sessionId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.resultsLockedAt) throw new BadRequestException('Results are already locked.');
    await this.client().examSession.update({
      where: { id: session.id },
      data: { resultsLockedAt: new Date(), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_LOCKED, 'ExamSession', session.id, {
      after: { resultsLockedAt: true },
    });
    await this.recordHistory(this.client(), {
      tenantId,
      sessionId,
      event: 'LOCKED',
      toState: ResultState.LOCKED,
      details: { scope: 'session' },
      actorUserId: userId,
    });
    return { success: true, resultsLockedAt: new Date() };
  }

  async unlockSessionResults(tenantId: string, userId: string, sessionId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    if (!session.resultsLockedAt) throw new BadRequestException('Results are not locked.');
    await this.client().examSession.update({
      where: { id: session.id },
      data: { resultsLockedAt: null, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_UNLOCKED, 'ExamSession', session.id, {
      before: { resultsLockedAt: true },
    });
    await this.recordHistory(this.client(), {
      tenantId,
      sessionId,
      event: 'UNLOCKED',
      fromState: ResultState.LOCKED,
      details: { scope: 'session' },
      actorUserId: userId,
    });
    return { success: true };
  }

  // ── Assessment components ─────────────────────────────────────────────────

  async listComponents(tenantId: string, userId: string, sessionId: string, query: ListComponentsQueryDto) {
    const scope = await examSubjectScopeFilter(await this.grants(tenantId, userId), userId);
    const where: Prisma.AssessmentComponentWhereInput = {
      tenantId,
      sessionId,
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
      ...(scope ? { subject: scope } : {}),
    };
    const items = await this.client().assessmentComponent.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { subject: { select: { course: { select: { code: true, name: true } } } } },
    });
    const total = items.length;
    return { items, total };
  }

  async createComponent(tenantId: string, userId: string, sessionId: string, dto: CreateComponentDto) {
    const session = await this.assertSession(tenantId, sessionId);
    void session;
    if (dto.subjectId) await this.assertSubject(tenantId, dto.subjectId);

    const duplicate = await this.client().assessmentComponent.findFirst({
      where: { tenantId, sessionId, subjectId: dto.subjectId ?? null, code: dto.code },
    });
    if (duplicate) throw new ConflictException('A component with this code already exists for the paper/session.');

    const component = await this.client().assessmentComponent.create({
      data: {
        tenantId,
        sessionId,
        subjectId: dto.subjectId ?? null,
        code: dto.code,
        name: dto.name,
        kind: dto.kind ?? 'THEORY',
        weightage: dto.weightage,
        maxMarks: dto.maxMarks,
        sortOrder: dto.sortOrder ?? 0,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ASSESSMENT_COMPONENT_CREATED, 'AssessmentComponent', component.id, {
      after: { sessionId, code: component.code, weightage: component.weightage },
    });
    return component;
  }

  async updateComponent(tenantId: string, userId: string, componentId: string, dto: UpdateComponentDto) {
    const component = await this.client().assessmentComponent.findFirst({
      where: { id: componentId, tenantId },
    });
    if (!component) throw new NotFoundException('Assessment component not found.');
    const updated = await this.client().assessmentComponent.update({
      where: { id: component.id },
      data: {
        code: dto.code,
        name: dto.name,
        kind: dto.kind,
        weightage: dto.weightage,
        maxMarks: dto.maxMarks,
        sortOrder: dto.sortOrder,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ASSESSMENT_COMPONENT_UPDATED, 'AssessmentComponent', component.id, {
      after: { code: updated.code, weightage: updated.weightage },
    });
    return updated;
  }

  async deleteComponent(tenantId: string, userId: string, componentId: string) {
    const component = await this.client().assessmentComponent.findFirst({
      where: { id: componentId, tenantId },
    });
    if (!component) throw new NotFoundException('Assessment component not found.');
    await this.client().assessmentComponent.delete({ where: { id: component.id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ASSESSMENT_COMPONENT_DELETED, 'AssessmentComponent', component.id, {
      before: { code: component.code },
    });
    return { success: true };
  }

  // ── Component marks ───────────────────────────────────────────────────────

  async listComponentMarks(tenantId: string, userId: string, subjectId: string) {
    await this.assertSubject(tenantId, subjectId);
    const registrationScope = resultsRegistrationScopeFilter(await this.grants(tenantId, userId), userId);
    const where: Prisma.ExamComponentMarkWhereInput = {
      tenantId,
      subjectId,
      ...(registrationScope ? { registration: registrationScope } : {}),
    };
    const items = await this.client().examComponentMark.findMany({
      where,
      include: {
        component: { select: { id: true, code: true, name: true, kind: true, weightage: true, maxMarks: true } },
        registration: { select: { id: true } },
        student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
      },
      orderBy: [{ component: { sortOrder: 'asc' } }, { student: { fullName: 'asc' } }],
    });
    const total = items.length;
    return { items, total };
  }

  async listMarksEntries(tenantId: string, userId: string, sessionId: string, query: ListMarksEntriesQueryDto) {
    await this.assertSession(tenantId, sessionId);
    const registrationScope = resultsRegistrationScopeFilter(await this.grants(tenantId, userId), userId);
    const where: Prisma.ExamMarksEntryWhereInput = {
      tenantId,
      registration: { sessionId, ...(registrationScope ?? {}) },
      ...(query.subjectId ? { subjectId: query.subjectId } : {}),
    };
    const items = await this.client().examMarksEntry.findMany({
      where,
      select: {
        registrationId: true,
        subjectId: true,
        studentId: true,
        student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
        subject: {
          select: {
            id: true,
            maxMarks: true,
            passMarks: true,
            course: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: [{ student: { fullName: 'asc' } }, { subjectId: 'asc' }],
    });
    const total = items.length;
    return { items, total };
  }

  async saveComponentMarks(tenantId: string, userId: string, subjectId: string, dto: SaveComponentMarksDto) {
    const subject = await this.assertSubject(tenantId, subjectId);
    if (dto.items.length === 0) throw new BadRequestException('No component marks provided.');

    const session = await this.assertSession(tenantId, subject.sessionId);
    if (session.resultsLockedAt) throw new BadRequestException('Results are locked for this session.');

    // Every row must belong to this subject and a registration for its session.
    const registrationIds = [...new Set(dto.items.map((i) => i.registrationId))];
    const registrations = await this.client().examRegistration.findMany({
      where: { tenantId, sessionId: subject.sessionId, id: { in: registrationIds } },
      select: { id: true, studentId: true },
    });
    const regById = new Map(registrations.map((r) => [r.id, r.studentId]));

    const componentIds = [...new Set(dto.items.map((i) => i.componentId))];
    const components = await this.client().assessmentComponent.findMany({
      where: { tenantId, sessionId: subject.sessionId, id: { in: componentIds } },
      select: { id: true },
    });
    const componentSet = new Set(components.map((c) => c.id));

    await this.client().$transaction(async (tx) => {
      for (const item of dto.items) {
        const regStudentId = regById.get(item.registrationId);
        if (!regStudentId) throw new BadRequestException(`Registration ${item.registrationId} does not belong to this session.`);
        if (!componentSet.has(item.componentId)) {
          throw new BadRequestException(`Component ${item.componentId} does not belong to this session.`);
        }

        await (tx as Client).examComponentMark.upsert({
          where: {
            tenantId_registrationId_subjectId_componentId: {
              tenantId,
              registrationId: item.registrationId,
              subjectId,
              componentId: item.componentId,
            },
          },
          create: {
            tenantId,
            registrationId: item.registrationId,
            subjectId,
            componentId: item.componentId,
            studentId: item.studentId,
            marksObtained: item.marksObtained,
            remark: item.remark,
            createdBy: userId,
          },
          update: {
            marksObtained: item.marksObtained,
            remark: item.remark,
            updatedBy: userId,
          },
        });
      }
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.COMPONENT_MARKS_SAVED, 'ExamSubject', subjectId, {
      after: { rows: dto.items.length, subjectCode: subject.course.code },
    });
    return { saved: dto.items.length };
  }

  // ── Result engine: calculation ────────────────────────────────────────────

  private async resolveScheme(tenantId: string, session: { gradingSchemeId?: string | null }) {
    if (session.gradingSchemeId) {
      const scheme = await this.client().gradingScheme.findFirst({
        where: { id: session.gradingSchemeId, tenantId, deletedAt: null },
        include: { gradeScale: true },
      });
      if (!scheme) throw new BadRequestException('The session grading scheme no longer exists.');
      return scheme;
    }
    return this.ensureDefaultScheme(tenantId);
  }

  private sessionGracePolicy(session: { gracePolicy?: Prisma.JsonValue | null }, scheme: SchemeRow): GracePolicy {
    const p = session.gracePolicy as GracePolicy | null;
    if (p && typeof p === 'object') {
      return {
        enabled: p.enabled ?? false,
        maxGraceMarks: p.maxGraceMarks ?? 0,
        graceToPassDiff: p.graceToPassDiff ?? 0,
      };
    }
    return {
      enabled: scheme.graceEnabled,
      maxGraceMarks: scheme.maxGraceMarks ?? 0,
      graceToPassDiff: scheme.graceToPassDiff ?? 0,
    };
  }

  private matchGrade(scale: ScaleBand[], percentage: number): ScaleBand | null {
    const bands = [...scale].sort((a, b) => a.minPercent - b.minPercent);
    for (let i = bands.length - 1; i >= 0; i--) {
      const band = bands[i];
      if (!band) continue;
      if (percentage >= band.minPercent && percentage <= band.maxPercent) return band;
    }
    return null;
  }

  private schemaSnapshot(scheme: SchemeRow): Prisma.InputJsonValue {
    return {
      code: scheme.code,
      name: scheme.name,
      passMode: scheme.passMode,
      minPassPercent: scheme.minPassPercent,
      minPassGradePoint: scheme.minPassGradePoint,
      weightingMode: scheme.weightingMode,
      gpaMax: scheme.gpaMax,
      graceEnabled: scheme.graceEnabled,
      maxGraceMarks: scheme.maxGraceMarks,
      graceToPassDiff: scheme.graceToPassDiff,
      roundingDecimals: scheme.roundingDecimals,
      gradeScale: scheme.gradeScale.map((band) => ({
        grade: band.grade,
        minPercent: band.minPercent,
        maxPercent: band.maxPercent,
        gradePoint: band.gradePoint,
      })),
    };
  }

  async calculateSession(tenantId: string, userId: string, sessionId: string, _dto: CalculateSessionDto = {}) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.resultsLockedAt) throw new BadRequestException('Results are locked for this session.');
    if (session.status === 'DRAFT' || session.status === 'CANCELLED') {
      throw new BadRequestException('Cannot calculate results for a DRAFT or CANCELLED session.');
    }

    const scheme = await this.resolveScheme(tenantId, session);
    const grace = this.sessionGracePolicy(session, scheme);
    const decimals = scheme.roundingDecimals;

    const subjects = await this.client().examSubject.findMany({
      where: { tenantId, sessionId },
      include: { course: { select: { id: true, code: true, name: true, creditHours: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (subjects.length === 0) throw new BadRequestException('The session has no papers to calculate.');

    const registrations = await this.client().examRegistration.findMany({
      where: { tenantId, sessionId, status: 'REGISTERED' },
      select: {
        id: true,
        studentId: true,
        student: { select: { id: true, fullName: true, admissionNumber: true, userId: true } },
      },
    });
    if (registrations.length === 0) throw new BadRequestException('No registered students for this session.');

    const entries = await this.client().examMarksEntry.findMany({
      where: { tenantId, status: 'APPROVED', subject: { sessionId } },
      include: { subject: { include: { course: true } } },
    });
    const entryByRegSubject = new Map<string, MarksRow>();
    for (const entry of entries) entryByRegSubject.set(`${entry.registrationId}:${entry.subjectId}`, entry);

    const components = await this.client().assessmentComponent.findMany({
      where: { tenantId, sessionId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const componentMarks = await this.client().examComponentMark.findMany({
      where: { tenantId, registration: { sessionId } },
      include: { component: { select: { id: true } } },
    });
    const marksByRegSubject = new Map<string, Prisma.ExamComponentMarkGetPayload<{ include: { component: { select: { id: true } } } }>[]>();
    for (const mark of componentMarks) {
      const key = `${mark.registrationId}:${mark.subjectId}`;
      const list = marksByRegSubject.get(key) ?? [];
      list.push(mark);
      marksByRegSubject.set(key, list);
    }

    const existingProcesses = await this.client().resultProcess.findMany({
      where: { tenantId, sessionId },
      select: { studentId: true, state: true },
    });
    const processByStudent = new Map(existingProcesses.map((p) => [p.studentId, p]));

    const now = new Date();

    await this.client().$transaction(async (tx) => {
      for (const registration of registrations) {
        const studentId = registration.studentId;
        const process = processByStudent.get(studentId);

        if (process?.state === ResultState.LOCKED) {
          throw new ConflictException(`Results for ${registration.student.fullName} are locked; unlock before recalculation.`);
        }
        if (process?.state === ResultState.PUBLISHED) {
          throw new ConflictException(
            `Results for ${registration.student.fullName} are published; unpublish before recalculation.`,
          );
        }

        const existingExam = await (tx as Client).studentExam.findFirst({
          where: { tenantId, studentId, sessionId },
          select: { id: true },
        });

        const paperResults: PaperResult[] = [];

        for (const subject of subjects) {
          const entry = entryByRegSubject.get(`${registration.id}:${subject.id}`) ?? null;
          const applicable = components.filter((c) => !c.subjectId || c.subjectId === subject.id);
          const compMarks = marksByRegSubject.get(`${registration.id}:${subject.id}`) ?? [];

          let raw: number | null = null;
          let breakdown: BreakdownRow[] = [];

          if (applicable.length > 0) {
            const totalWeight = applicable.reduce((sum, c) => sum + c.weightage, 0);
            const rows: BreakdownRow[] = [];
            let weightedSum = 0;
            for (const c of applicable) {
              const mark = compMarks.find((m) => m.componentId === c.id);
              const marksObtained = mark?.marksObtained ?? 0;
              const factor = c.maxMarks > 0 ? Number(marksObtained) / c.maxMarks : 0;
              const weighted = totalWeight > 0 ? (factor * c.weightage) / totalWeight : 0;
              rows.push({
                componentId: c.id,
                code: c.code,
                name: c.name,
                kind: c.kind,
                weightage: c.weightage,
                maxMarks: c.maxMarks,
                marksObtained: Number(marksObtained),
                weighted: this.round(weighted * subject.maxMarks, decimals),
              });
              weightedSum += factor * c.weightage;
            }
            raw = totalWeight > 0 ? (weightedSum / totalWeight) * subject.maxMarks : 0;
            breakdown = rows;
          } else if (entry?.marksObtained != null) {
            raw = entry.marksObtained;
          }

          const absent = entry ? entry.attendanceStatus === 'ABSENT' : false;
          let graceApplied = 0;
          let effective: number | null = null;
          if (raw == null || absent) {
            paperResults.push({
              subject,
              entry,
              breakdown,
              rawMarks: raw,
              graceApplied: 0,
              effectiveMarks: null,
              percentage: null,
              grade: null,
              gradePoint: null,
              outcome: ResultOutcome.INCOMPLETE,
            });
            continue;
          }

          const shortfall = subject.passMarks - raw;
          const maxGraceMarks = grace.maxGraceMarks ?? 0;
          const graceToPassDiff = grace.graceToPassDiff ?? 0;
          if (shortfall > 0 && grace.enabled && maxGraceMarks > 0 && shortfall <= graceToPassDiff) {
            graceApplied = Math.min(shortfall, maxGraceMarks);
          }
          effective = Math.min(raw + graceApplied, subject.maxMarks);
          const percentage = subject.maxMarks > 0 ? this.round((effective / subject.maxMarks) * 100, decimals) : null;
          const band = percentage != null ? this.matchGrade(scheme.gradeScale, percentage) : null;

          let passed: boolean;
          if (scheme.passMode === 'GRADE_POINT') {
            passed = band != null && band.gradePoint >= (scheme.minPassGradePoint ?? 0);
          } else {
            const passPercent = scheme.minPassPercent ?? (subject.maxMarks > 0 ? (subject.passMarks / subject.maxMarks) * 100 : 0);
            passed = percentage != null && percentage >= passPercent;
          }
          const outcome =
            passed && graceApplied > 0
              ? ResultOutcome.PASS_WITH_GRACE
              : passed
                ? ResultOutcome.PASS
                : ResultOutcome.FAIL;

          paperResults.push({
            subject,
            entry,
            breakdown,
            rawMarks: this.round(raw, decimals),
            graceApplied: this.round(graceApplied, decimals),
            effectiveMarks: effective != null ? this.round(effective, decimals) : null,
            percentage,
            grade: band?.grade ?? null,
            gradePoint: band?.gradePoint ?? null,
            outcome,
          });
        }

        // Per-paper rows → ResultCalculation
        for (const result of paperResults) {
          await (tx as Client).resultCalculation.upsert({
            where: {
              tenantId_sessionId_studentId_subjectId: {
                tenantId,
                sessionId,
                studentId,
                subjectId: result.subject.id,
              },
            },
            create: {
              tenantId,
              sessionId,
              studentId,
              registrationId: registration.id,
              subjectId: result.subject.id,
              marksEntryId: result.entry?.id ?? null,
              examId: existingExam?.id ?? null,
              rawMarks: result.rawMarks,
              graceApplied: result.graceApplied,
              effectiveMarks: result.effectiveMarks,
              maxMarks: result.subject.maxMarks,
              passMarks: result.subject.passMarks,
              percentage: result.percentage,
              grade: result.grade,
              gradePoint: result.gradePoint,
              outcome: result.outcome,
              componentJson: result.breakdown.length ? (result.breakdown as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
              schemaJson: this.schemaSnapshot(scheme),
              calculatedAt: now,
              calculatedBy: userId,
              createdBy: userId,
            },
            update: {
              registrationId: registration.id,
              marksEntryId: result.entry?.id ?? null,
              examId: existingExam?.id ?? null,
              rawMarks: result.rawMarks,
              graceApplied: result.graceApplied,
              effectiveMarks: result.effectiveMarks,
              percentage: result.percentage,
              grade: result.grade,
              gradePoint: result.gradePoint,
              outcome: result.outcome,
              componentJson: result.breakdown.length ? (result.breakdown as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
              schemaJson: this.schemaSnapshot(scheme),
              calculatedAt: now,
              calculatedBy: userId,
            },
          });
        }

        // Aggregate the process row
        const passedPapers = paperResults.filter((r) => r.outcome === ResultOutcome.PASS || r.outcome === ResultOutcome.PASS_WITH_GRACE);
        const failedPapers = paperResults.filter((r) => r.outcome === ResultOutcome.FAIL);
        const incompletePapers = paperResults.filter((r) => r.outcome === ResultOutcome.INCOMPLETE);

        const creditsBySubject = new Map(subjects.map((s) => [s.id, s.course.creditHours]));
        let creditsAttempted = 0;
        let creditsEarned = 0;
        let pointsWeighted = 0;
        let pointsCredits = 0;
        const gpValues: number[] = [];

        for (const result of paperResults) {
          const credits = creditsBySubject.get(result.subject.id) ?? 0;
          creditsAttempted += credits;
          if (result.outcome === ResultOutcome.PASS || result.outcome === ResultOutcome.PASS_WITH_GRACE) {
            creditsEarned += credits;
          }
          if (result.gradePoint != null) {
            gpValues.push(result.gradePoint);
            pointsWeighted += result.gradePoint * credits;
            pointsCredits += credits;
          }
        }

        let gpa: number | null = null;
        if (scheme.weightingMode === 'CREDIT_WEIGHTED' && pointsCredits > 0) {
          gpa = this.round(pointsWeighted / pointsCredits, decimals);
        } else if (gpValues.length > 0) {
          gpa = this.round(gpValues.reduce((a, b) => a + b, 0) / gpValues.length, decimals);
        }
        if (gpa != null && gpa > scheme.gpaMax) gpa = scheme.gpaMax;

        const totals = paperResults.reduce(
          (acc, r) => {
            acc.raw += r.rawMarks ?? 0;
            acc.grace += r.graceApplied;
            acc.effective += r.effectiveMarks ?? 0;
            acc.max += r.subject.maxMarks;
            return acc;
          },
          { raw: 0, grace: 0, effective: 0, max: 0 },
        );

        // CGPA across previously published/locked processes of the student plus this session.
        const priorProcesses = await (tx as Client).resultProcess.findMany({
          where: { tenantId, studentId, state: { in: [ResultState.PUBLISHED, ResultState.LOCKED] } },
          select: { gpa: true, creditsAttempted: true },
        });
        let cgpa: number | null = null;
        let cgpParts = 0;
        let cgpCredits = 0;
        for (const prior of priorProcesses) {
          if (prior.gpa != null && prior.creditsAttempted != null && prior.creditsAttempted > 0) {
            cgpParts += prior.gpa * prior.creditsAttempted;
            cgpCredits += prior.creditsAttempted;
          }
        }
        if (gpa != null && creditsAttempted > 0) {
          cgpParts += gpa * creditsAttempted;
          cgpCredits += creditsAttempted;
        }
        if (cgpCredits > 0) cgpa = this.round(cgpParts / cgpCredits, decimals);

        const failedCount = failedPapers.length + incompletePapers.length;
        const standing =
          failedPapers.length === 0 && incompletePapers.length === 0
            ? ResultStanding.PASSED
            : failedPapers.length === 0 && incompletePapers.length > 0
              ? ResultStanding.FAILED
              : session.isSupplementary
                ? ResultStanding.SUPPLEMENTARY
                : ResultStanding.FAILED;

        const priorState: ResultState | undefined = process?.state;
        await (tx as Client).resultProcess.upsert({
          where: { tenantId_sessionId_studentId: { tenantId, sessionId, studentId } },
          create: {
            tenantId,
            sessionId,
            studentId,
            examId: existingExam?.id ?? null,
            state: ResultState.CALCULATED,
            standing,
            subjectCount: paperResults.length,
            passedCount: passedPapers.length,
            failedCount,
            totalRawMarks: totals.raw,
            totalGraceMarks: totals.grace,
            totalEffectiveMarks: totals.effective,
            totalMaxMarks: totals.max,
            aggregatePercent:
              totals.max > 0 ? this.round((totals.effective / totals.max) * 100, decimals) : null,
            creditsAttempted,
            creditsEarned,
            gpa,
            cgpa,
            calculationVersion: 1,
            calculatedAt: now,
            calculatedBy: userId,
            createdBy: userId,
          },
          update: {
            standing,
            subjectCount: paperResults.length,
            passedCount: passedPapers.length,
            failedCount,
            totalRawMarks: totals.raw,
            totalGraceMarks: totals.grace,
            totalEffectiveMarks: totals.effective,
            totalMaxMarks: totals.max,
            aggregatePercent:
              totals.max > 0 ? this.round((totals.effective / totals.max) * 100, decimals) : null,
            creditsAttempted,
            creditsEarned,
            gpa,
            cgpa,
            state: ResultState.CALCULATED,
            approvedAt: null,
            approvedBy: null,
            publishedAt: null,
            publishedBy: null,
            calculationVersion: { increment: 1 },
            calculatedAt: now,
            calculatedBy: userId,
            updatedBy: userId,
          },
        });

        const updatedProcess = await (tx as Client).resultProcess.findFirst({
          where: { tenantId, sessionId, studentId },
          select: { id: true },
        });
        if (updatedProcess) {
          await (tx as Client).resultCalculation.updateMany({
            where: { tenantId, sessionId, studentId },
            data: { processId: updatedProcess.id },
          });
        }
        await this.recordHistory(tx as Client, {
          tenantId,
          sessionId,
          processId: updatedProcess?.id,
          studentId,
          event: 'CALCULATED',
          fromState: priorState,
          toState: ResultState.CALCULATED,
          details: { gpa, cgpa, percentage: totals.max > 0 ? (totals.effective / totals.max) * 100 : null },
          actorUserId: userId,
        });
      }
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_CALCULATED, 'ExamSession', sessionId, {
      after: { students: registrations.length, papers: subjects.length, compileState: 'CALCULATED' },
    });

    const processes = await this.client().resultProcess.findMany({
      where: { tenantId, sessionId },
      select: { studentId: true, state: true, gpa: true, cgpa: true, standing: true, calculationVersion: true },
    });
    return {
      calculatedStudents: processes.length,
      sessionCode: session.code,
      schemeCode: scheme.code,
      processes,
    };
  }

  // ── Results lifecycle (per student process) ───────────────────────────────

  async listProcesses(tenantId: string, userId: string, sessionId: string, query: ListProcessesQueryDto & ResultsPaginationDto) {
    await this.assertSession(tenantId, sessionId);
    const sessionScope = await this.sessionScope(tenantId, userId);
    const where: Prisma.ResultProcessWhereInput = {
      tenantId,
      sessionId,
      ...(sessionScope ? sessionScope : {}),
      ...(query.state ? { state: query.state as ResultState } : {}),
      ...(query.standing ? { standing: query.standing as ResultStanding } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
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
    const [items, total] = await Promise.all([
      this.client().resultProcess.findMany({
        where,
        include: {
          student: {
            select: { id: true, fullName: true, admissionNumber: true, rollNumber: true, userId: true },
          },
        },
        orderBy: [{ state: 'asc' }, { student: { fullName: 'asc' } }],
        skip,
        take,
      }),
      this.client().resultProcess.count({ where }),
    ]);
    return { items, total };
  }

  async getProcess(tenantId: string, userId: string, sessionId: string, studentId: string) {
    await this.assertSession(tenantId, sessionId);
    await this.assertStudent(tenantId, studentId);
    const sessionScope = await this.sessionScope(tenantId, userId);
    const process = await this.client().resultProcess.findFirst({
      where: {
        tenantId,
        sessionId,
        studentId,
        ...(sessionScope ? sessionScope : {}),
      },
      include: {
        student: {
          select: { id: true, fullName: true, admissionNumber: true, rollNumber: true, programId: true },
        },
        calculations: {
          include: {
            subject: {
              include: { course: { select: { id: true, code: true, name: true, creditHours: true } } },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!process) throw new NotFoundException('No result process for this student in this session.');
    return process;
  }

  private async assertProcess(tenantId: string, sessionId: string, studentId: string) {
    const process = await this.client().resultProcess.findFirst({
      where: { tenantId, sessionId, studentId },
    });
    if (!process) {
      throw new NotFoundException('No result process for this student in this session. Run the calculation first.');
    }
    return process;
  }

  async approveProcess(tenantId: string, userId: string, sessionId: string, studentId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.resultsLockedAt) throw new BadRequestException('Results are locked; unlock before approving.');
    const process = await this.assertProcess(tenantId, sessionId, studentId);
    if (process.state === ResultState.PUBLISHED || process.state === ResultState.LOCKED) {
      throw new BadRequestException(`A ${process.state} process cannot be approved again.`);
    }
    const from = process.state;
    const updated = await this.client().resultProcess.update({
      where: { id: process.id },
      data: { state: ResultState.APPROVED, approvedAt: new Date(), approvedBy: userId, updatedBy: userId },
    });
    await this.recordHistory(this.client(), {
      tenantId,
      sessionId,
      processId: process.id,
      studentId,
      event: 'APPROVED',
      fromState: from,
      toState: ResultState.APPROVED,
      actorUserId: userId,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_APPROVED, 'ResultProcess', process.id, {
      after: { studentId, state: updated.state },
    });
    return updated;
  }

  async publishProcess(tenantId: string, userId: string, sessionId: string, studentId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.resultsLockedAt) throw new BadRequestException('Results are locked; unlock before publishing.');
    const process = await this.assertProcess(tenantId, sessionId, studentId);
    if (process.state !== ResultState.APPROVED) {
      throw new BadRequestException(`Only APPROVED results can be published (current state: ${process.state}).`);
    }

    const calculations = await this.client().resultCalculation.findMany({
      where: { tenantId, sessionId, studentId },
      include: { subject: { include: { course: true } } },
      orderBy: { createdAt: 'asc' },
    });
    if (calculations.length === 0) throw new BadRequestException('No subject calculations exist for this student.');

    await this.assertStudent(tenantId, studentId);
    const now = new Date();

    await this.client().$transaction(async (tx) => {
      const exam = await (tx as Client).studentExam.upsert({
        where: {
          tenantId_studentId_sessionId: { tenantId, studentId, sessionId },
        },
        create: {
          tenantId,
          studentId,
          name: session.name,
          examType: session.examType,
          termId: session.termId ?? null,
          programId: session.programId,
          startDate: session.startDate,
          endDate: session.endDate,
          status: ExamStatus.COMPLETED,
          sessionId,
          createdBy: userId,
        },
        update: {
          name: session.name,
          examType: session.examType,
          termId: session.termId ?? null,
          programId: session.programId,
          startDate: session.startDate,
          endDate: session.endDate,
          status: ExamStatus.COMPLETED,
        },
      });

      await (tx as Client).studentResult.deleteMany({
        where: { tenantId, studentId, examId: exam.id },
      });

      for (const calculation of calculations) {
        await (tx as Client).studentResult.create({
          data: {
            tenantId,
            studentId,
            examId: exam.id,
            subjectCode: calculation.subject.course.code,
            subjectName: calculation.subject.course.name,
            maxMarks: calculation.maxMarks,
            obtainedMarks: calculation.effectiveMarks != null ? Math.round(calculation.effectiveMarks) : null,
            grade: calculation.grade,
            gradePoint: calculation.gradePoint,
            percentage: calculation.percentage,
            graceApplied: calculation.graceApplied,
            componentJson: calculation.componentJson ?? Prisma.JsonNull,
            outcome: calculation.outcome,
            publishedAt: now,
            publishedBy: userId,
            resultCalculationId: calculation.id,
            createdBy: userId,
          },
        });

        if (calculation.outcome === ResultOutcome.FAIL && session.termId) {
          await (tx as Client).courseBacklog.upsert({
            where: {
              tenantId_studentId_courseId_termId: {
                tenantId,
                studentId,
                courseId: calculation.subject.courseId,
                termId: session.termId,
              },
            },
            create: {
              tenantId,
              studentId,
              courseId: calculation.subject.courseId,
              termId: session.termId,
              status: BacklogStatus.OPEN,
              createdBy: userId,
            },
            update: {},
          });
        }

        if (
          session.isSupplementary &&
          (calculation.outcome === ResultOutcome.PASS || calculation.outcome === ResultOutcome.PASS_WITH_GRACE)
        ) {
          await (tx as Client).courseBacklog.updateMany({
            where: { tenantId, studentId, courseId: calculation.subject.courseId, status: BacklogStatus.OPEN },
            data: { status: BacklogStatus.CLEARED, clearedAt: now, updatedBy: userId },
          });
        }
      }

      await (tx as Client).resultCalculation.updateMany({
        where: { tenantId, sessionId, studentId },
        data: { examId: exam.id },
      });

      await (tx as Client).resultProcess.update({
        where: { id: process.id },
        data: {
          state: ResultState.PUBLISHED,
          publishedAt: now,
          publishedBy: userId,
          updatedBy: userId,
        },
      });

      if (!session.resultPublishedAt) {
        await (tx as Client).examSession.update({
          where: { id: sessionId },
          data: { resultPublishedAt: now, resultPublishedBy: userId, updatedBy: userId },
        });
      }
    });

    await this.recordHistory(this.client(), {
      tenantId,
      sessionId,
      processId: process.id,
      studentId,
      event: 'PUBLISHED',
      fromState: ResultState.APPROVED,
      toState: ResultState.PUBLISHED,
      details: { papers: calculations.length },
      actorUserId: userId,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_PUBLISHED, 'ResultProcess', process.id, {
      after: { studentId, state: ResultState.PUBLISHED },
    });
    await this.notifyStudent(
      tenantId,
      studentId,
      'Results published',
      `Results for ${session.name} (${session.code}) have been published.`,
    );
    return this.getProcess(tenantId, userId, sessionId, studentId);
  }

  async unpublishProcess(tenantId: string, userId: string, sessionId: string, studentId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    if (session.resultsLockedAt) throw new BadRequestException('Results are locked; unlock before unpublishing.');
    const process = await this.assertProcess(tenantId, sessionId, studentId);
    if (process.state !== ResultState.PUBLISHED) {
      throw new BadRequestException(`Only PUBLISHED results can be unpublished (current state: ${process.state}).`);
    }

    const studentExam = await this.client().studentExam.findFirst({
      where: { tenantId, sessionId, studentId },
      select: { id: true },
    });
    if (!studentExam) throw new BadRequestException('No synced student exam row to unpublish.');

    await this.client().$transaction(async (tx) => {
      await (tx as Client).studentResult.deleteMany({
        where: { tenantId, studentId, examId: studentExam.id },
      });
      await (tx as Client).studentExam.delete({ where: { id: studentExam.id } });
      await (tx as Client).resultCalculation.updateMany({
        where: { tenantId, sessionId, studentId },
        data: { examId: null },
      });
      await (tx as Client).resultProcess.update({
        where: { id: process.id },
        data: {
          state: ResultState.APPROVED,
          publishedAt: null,
          publishedBy: null,
          updatedBy: userId,
        },
      });

      const remaining = await (tx as Client).resultProcess.count({
        where: { tenantId, sessionId, state: { in: [ResultState.PUBLISHED, ResultState.LOCKED] } },
      });
      if (remaining === 0) {
        await (tx as Client).examSession.update({
          where: { id: sessionId },
          data: { resultPublishedAt: null, resultPublishedBy: null, updatedBy: userId },
        });
      }
    });

    await this.recordHistory(this.client(), {
      tenantId,
      sessionId,
      processId: process.id,
      studentId,
      event: 'UNPUBLISHED',
      fromState: ResultState.PUBLISHED,
      toState: ResultState.APPROVED,
      actorUserId: userId,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_UNPUBLISHED, 'ResultProcess', process.id, {
      before: { studentId, state: ResultState.PUBLISHED },
    });
    return { success: true };
  }

  async lockProcess(tenantId: string, userId: string, sessionId: string, studentId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    const process = await this.assertProcess(tenantId, sessionId, studentId);
    if (process.state !== ResultState.PUBLISHED) {
      throw new BadRequestException(`Only PUBLISHED results can be locked (current state: ${process.state}).`);
    }
    const updated = await this.client().resultProcess.update({
      where: { id: process.id },
      data: { state: ResultState.LOCKED, lockedAt: new Date(), updatedBy: userId },
    });
    await this.recordHistory(this.client(), {
      tenantId,
      sessionId,
      processId: process.id,
      studentId,
      event: 'LOCKED',
      fromState: ResultState.PUBLISHED,
      toState: ResultState.LOCKED,
      actorUserId: userId,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_LOCKED, 'ResultProcess', process.id, {
      after: { studentId },
    });
    void session;
    return updated;
  }

  async unlockProcess(tenantId: string, userId: string, sessionId: string, studentId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    void session;
    const process = await this.assertProcess(tenantId, sessionId, studentId);
    if (process.state !== ResultState.LOCKED) {
      throw new BadRequestException(`Only LOCKED results can be unlocked (current state: ${process.state}).`);
    }
    const updated = await this.client().resultProcess.update({
      where: { id: process.id },
      data: { state: ResultState.PUBLISHED, lockedAt: null, updatedBy: userId },
    });
    await this.recordHistory(this.client(), {
      tenantId,
      sessionId,
      processId: process.id,
      studentId,
      event: 'UNLOCKED',
      fromState: ResultState.LOCKED,
      toState: ResultState.PUBLISHED,
      actorUserId: userId,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_UNLOCKED, 'ResultProcess', process.id, {
      after: { studentId },
    });
    return updated;
  }

  private allowedTargetState(action: string): ResultState {
    switch (action) {
      case 'APPROVE':
        return ResultState.APPROVED;
      case 'PUBLISH':
        return ResultState.PUBLISHED;
      case 'UNPUBLISH':
        return ResultState.APPROVED;
      case 'LOCK':
        return ResultState.LOCKED;
      case 'UNLOCK':
        return ResultState.PUBLISHED;
      default:
        throw new BadRequestException(`Unknown bulk action ${action}.`);
    }
  }

  async bulkAction(tenantId: string, userId: string, sessionId: string, dto: BulkProcessActionDto) {
    await this.assertSession(tenantId, sessionId);
    const target = this.allowedTargetState(dto.action);

    const eligibleStates: ResultState[] =
      dto.action === 'APPROVE'
        ? [ResultState.CALCULATED, ResultState.PENDING_APPROVAL]
        : dto.action === 'PUBLISH'
          ? [ResultState.APPROVED]
          : dto.action === 'UNPUBLISH'
            ? [ResultState.PUBLISHED]
            : dto.action === 'LOCK'
              ? [ResultState.PUBLISHED]
              : [ResultState.LOCKED];

    const where: Prisma.ResultProcessWhereInput = {
      tenantId,
      sessionId,
      state: { in: eligibleStates },
      ...(dto.studentIds?.length ? { studentId: { in: dto.studentIds } } : {}),
    };
    const processes = await this.client().resultProcess.findMany({
      where,
      select: { id: true, studentId: true, state: true },
    });

    let released = 0;
    for (const process of processes) {
      if (dto.action === 'PUBLISH') {
        await this.publishProcess(tenantId, userId, sessionId, process.studentId);
      } else if (dto.action === 'UNPUBLISH') {
        await this.unpublishProcess(tenantId, userId, sessionId, process.studentId);
      } else {
        await this.client().resultProcess.update({
          where: { id: process.id },
          data: {
            state: target,
            ...(dto.action === 'APPROVE' ? { approvedAt: new Date(), approvedBy: userId } : {}),
            ...(dto.action === 'LOCK' ? { lockedAt: new Date() } : {}),
            ...(dto.action === 'UNLOCK' ? { lockedAt: null } : {}),
            updatedBy: userId,
          },
        });
        await this.recordHistory(this.client(), {
          tenantId,
          sessionId,
          processId: process.id,
          studentId: process.studentId,
          event: dto.action,
          fromState: process.state,
          toState: target,
          details: { bulk: true },
          actorUserId: userId,
        });
      }
      released += 1;
    }

    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_PROCESS_BULK_ACTION, 'ExamSession', sessionId, {
      after: { action: dto.action, affected: released },
    });
    return { action: dto.action, affected: released };
  }

  // ── History & export ──────────────────────────────────────────────────────

  async listHistory(tenantId: string, userId: string, sessionId: string, query: ResultsPaginationDto) {
    await this.assertSession(tenantId, sessionId);
    const sessionAnchor = resultsSessionScopeFilter(await this.grants(tenantId, userId), userId);
    const where: Prisma.ResultHistoryWhereInput = {
      tenantId,
      sessionId,
      ...(sessionAnchor ? { session: sessionAnchor } : {}),
      ...(query.search ? { student: { fullName: { contains: query.search, mode: 'insensitive' } } } : {}),
    };
    const { skip, take } = this.page(query);
    const [items, total] = await Promise.all([
      this.client().resultHistory.findMany({
        where,
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.client().resultHistory.count({ where }),
    ]);
    return { items, total };
  }

  async exportSession(tenantId: string, userId: string, sessionId: string) {
    const session = await this.assertSession(tenantId, sessionId);
    const scope = await this.sessionScope(tenantId, userId);
    const processes = await this.client().resultProcess.findMany({
      where: { tenantId, sessionId, ...(scope ?? {}) },
      include: {
        student: {
          select: { id: true, fullName: true, admissionNumber: true, rollNumber: true },
        },
        calculations: {
          include: {
            subject: { include: { course: { select: { code: true, name: true, creditHours: true } } } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ student: { fullName: 'asc' } }],
    });

    const rows = processes.map((process) => ({
      studentId: process.student.id,
      admissionNumber: process.student.admissionNumber,
      fullName: process.student.fullName,
      state: process.state,
      standing: process.standing,
      subjectCount: process.subjectCount,
      passedCount: process.passedCount,
      failedCount: process.failedCount,
      aggregatePercent: process.aggregatePercent,
      creditsAttempted: process.creditsAttempted,
      creditsEarned: process.creditsEarned,
      gpa: process.gpa,
      cgpa: process.cgpa,
      calculationVersion: process.calculationVersion,
      publishedAt: process.publishedAt,
      papers: process.calculations.map((calculation) => ({
        courseCode: calculation.subject.course.code,
        courseName: calculation.subject.course.name,
        credits: calculation.subject.course.creditHours,
        maxMarks: calculation.maxMarks,
        passMarks: calculation.passMarks,
        rawMarks: calculation.rawMarks,
        graceApplied: calculation.graceApplied,
        effectiveMarks: calculation.effectiveMarks,
        percentage: calculation.percentage,
        grade: calculation.grade,
        gradePoint: calculation.gradePoint,
        outcome: calculation.outcome,
      })),
    }));

    await this.audit(tenantId, userId, AUDIT_ACTIONS.RESULT_CALCULATED, 'ExamSession', sessionId, {
      after: { export: true, students: rows.length, sessionCode: session.code },
    });
    return { sessionCode: session.code, exportedAt: new Date(), rows };
  }

  // ── Student cumulative summary ────────────────────────────────────────────

  async studentSummary(tenantId: string, userId: string, studentId: string) {
    await this.assertStudent(tenantId, studentId);
    const scope = await this.sessionScope(tenantId, userId);
    const processes = await this.client().resultProcess.findMany({
      where: { tenantId, studentId, ...(scope ?? {}) },
      include: {
        session: { select: { id: true, name: true, code: true, examType: true, termId: true, programId: true } },
      },
      orderBy: [{ publishedAt: 'asc' }, { calculatedAt: 'asc' }],
    });

    const published = processes.filter((p) => p.state === ResultState.PUBLISHED || p.state === ResultState.LOCKED);
    let totalCredits = 0;
    let earnedCredits = 0;
    let cgpParts = 0;
    for (const process of published) {
      totalCredits += process.creditsAttempted ?? 0;
      earnedCredits += process.creditsEarned ?? 0;
      if (process.gpa != null && process.creditsAttempted) {
        cgpParts += process.gpa * process.creditsAttempted;
      }
    }
    const cgpa = totalCredits > 0 ? this.round(cgpParts / totalCredits, 2) : null;

    return {
      studentId,
      publishedProcessCount: published.length,
      totalCreditsAttempted: totalCredits,
      totalCreditsEarned: earnedCredits,
      cgpa,
      processes,
    };
  }
}