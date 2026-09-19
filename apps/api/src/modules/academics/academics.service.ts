/**
 * Academics service — course catalog (with prerequisites), curricula & curriculum versions,
 * course offerings & faculty assignment, student course registration (windows, capacity,
 * waitlist, prerequisites), academic advising, progression/promotion & backlogs, and the
 * academic calendar. Everything is tenant-scoped via TenantScopedPrismaService; durable events
 * land in the centralized audit trail (module 'academics'). Scope grants (academics.view +
 * friends) are enforced on every read via academicScopeFilter so a DEPARTMENT-scoped HOD or an
 * OWN-scoped student can never see beyond their grants.
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
import {
  AdvisingStatus,
  BacklogStatus,
  CourseOfferingStatus,
  CourseRegistrationStatus,
  CourseType,
  ProgressionStatus,
} from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { academicScopeFilter } from './academics-scope';
import {
  CreateCourseDto,
  UpdateCourseDto,
  AddPrerequisiteDto,
  CreateCurriculumDto,
  UpdateCurriculumDto,
  CreateCurriculumVersionDto,
  UpdateCurriculumVersionDto,
  SetCurriculumCoursesDto,
  CreateCourseOfferingDto,
  UpdateCourseOfferingDto,
  AssignFacultyDto,
  UpdateFacultyAssignmentDto,
  CreateCourseRegistrationDto,
  UpdateCourseRegistrationDto,
  BulkRegisterDto,
  CreateAdvisingRecordDto,
  UpdateAdvisingRecordDto,
  CreateProgressionRecordDto,
  PromoteBatchDto,
  CreateBacklogDto,
  UpdateBacklogDto,
  ClearBacklogsDto,
  CreateCalendarEventDto,
  UpdateCalendarEventDto,
  PublishCalendarDto,
  COURSE_REGISTRATION_STATUSES,
  PROGRESSION_STATUSES,
  type AcademicsPaginationDto,
  type ListCoursesQueryDto,
  type ListCurriculaQueryDto,
  type ListCourseOfferingsQueryDto,
  type ListCourseRegistrationsQueryDto,
  type RegistrationReportQueryDto,
  type ListAdvisingQueryDto,
  type ListProgressionQueryDto,
  type ListBacklogsQueryDto,
  type ListCalendarEventQueryDto,
} from './dto/academics.dto';

type Client = PrismaClient;

const ACTIVE_SEATS = ['REGISTERED', 'CONFIRMED'] as const;
const ACTIVE_REGISTRATION_STATUSES = COURSE_REGISTRATION_STATUSES.filter(
  (s) => s === 'REGISTERED' || s === 'CONFIRMED' || s === 'WAITLISTED',
);

@Injectable()
export class AcademicsService {
  private readonly logger = new Logger(AcademicsService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async scope(tenantId: string, userId: string, anchor: 'program' | 'course' | 'student') {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'academics.view');
    return academicScopeFilter(grants, userId, anchor);
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
      module: 'academics',
      entityType,
      entityId,
      before: payload.before,
      after: payload.after,
    });
  }

  private page(query: AcademicsPaginationDto) {
    return { skip: query.skip ?? 0, take: query.take ?? 50 };
  }

  private paginate<T extends { id: string }>(items: T[], total: number) {
    return { items, total };
  }

  private async assertCourse(tenantId: string, courseId: string) {
    const course = await (this.tenantPrisma.client as Client).course.findFirst({
      where: { id: courseId, tenantId, deletedAt: null },
    });
    if (!course) throw new NotFoundException('Course not found.');
    return course;
  }

  /** True when the student has already cleared `courseId` (COMPLETED registration or cleared backlog). */
  private async hasClearedCourse(tenantId: string, studentId: string, courseId: string): Promise<boolean> {
    const completed = await (this.tenantPrisma.client as Client).courseRegistration.count({
      where: {
        tenantId,
        studentId,
        status: 'COMPLETED',
        courseOffering: { courseId },
      },
    });
    if (completed > 0) return true;
    const cleared = await (this.tenantPrisma.client as Client).courseBacklog.count({
      where: { tenantId, studentId, courseId, status: 'CLEARED' },
    });
    return cleared > 0;
  }

  /** Whether `target` transitively depends on `courseId` (used to prevent prerequisite cycles). */
  private async dependsOn(tenantId: string, target: string, courseId: string): Promise<boolean> {
    const seen = new Set<string>([target]);
    const queue = [target];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const deps = await (this.tenantPrisma.client as Client).coursePrerequisite.findMany({
        where: { tenantId, courseId: current },
        select: { requiredCourseId: true },
      });
      for (const d of deps) {
        if (d.requiredCourseId === courseId) return true;
        if (!seen.has(d.requiredCourseId)) {
          seen.add(d.requiredCourseId);
          queue.push(d.requiredCourseId);
        }
      }
    }
    return false;
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

  private async offeringOccupancy(tenantId: string, offeringIds: string[]) {
    if (offeringIds.length === 0) return new Map<string, { enrolled: number; waitlisted: number }>();
    const rows = await (this.tenantPrisma.client as Client).courseRegistration.groupBy({
      by: ['courseOfferingId', 'status'],
      where: { tenantId, courseOfferingId: { in: offeringIds } },
      _count: { _all: true },
    });
    const map = new Map<string, { enrolled: number; waitlisted: number }>();
    for (const row of rows) {
      const entry = map.get(row.courseOfferingId) ?? { enrolled: 0, waitlisted: 0 };
      if (row.status === 'WAITLISTED') entry.waitlisted += row._count._all;
      if (row.status === 'REGISTERED' || row.status === 'CONFIRMED') entry.enrolled += row._count._all;
      map.set(row.courseOfferingId, entry);
    }
    return map;
  }

  // ── Course catalog ────────────────────────────────────────────────────────

  async listCourses(tenantId: string, userId: string, query: ListCoursesQueryDto) {
    const scope = await this.scope(tenantId, userId, 'course');
    const where: Prisma.CourseWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.courseType ? { courseType: query.courseType as CourseType } : {}),
      ...(query.departmentId ? { departmentId: query.departmentId } : {}),
      ...(scope ?? {}),
    };
    if (query.search) {
      where.OR = [{ code: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }];
    }
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).course.findMany({
        where,
        ...this.page(query),
        orderBy: [{ code: 'asc' }],
        include: { department: { select: { id: true, code: true, name: true } } },
      }),
      (this.tenantPrisma.client as Client).course.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async createCourse(tenantId: string, userId: string, dto: CreateCourseDto) {
    const existing = await (this.tenantPrisma.client as Client).course.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException('A course with this code already exists.');
    if (dto.departmentId) {
      const dept = await (this.tenantPrisma.client as Client).department.findFirst({
        where: { id: dto.departmentId, tenantId, deletedAt: null },
      });
      if (!dept) throw new NotFoundException('Department not found.');
    }
    const course = await (this.tenantPrisma.client as any).course.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        creditHours: dto.creditHours ?? 3,
        courseType: dto.courseType ?? 'CORE',
        gradingBasis: dto.gradingBasis,
        departmentId: dto.departmentId,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_CREATED, 'Course', course.id, {
      after: { code: dto.code, name: dto.name },
    });
    return course;
  }

  async getCourse(tenantId: string, userId: string, courseId: string) {
    const scope = await this.scope(tenantId, userId, 'course');
    const course = await (this.tenantPrisma.client as Client).course.findFirst({
      where: { id: courseId, tenantId, deletedAt: null, ...(scope ?? {}) },
      include: {
        department: { select: { id: true, code: true, name: true } },
        prerequisites: { include: { requiredCourse: { select: { id: true, code: true, name: true, creditHours: true } } } },
        requiredBy: { include: { course: { select: { id: true, code: true, name: true } } } },
        _count: { select: { courseOfferings: true, curriculumCourses: true, backlogs: true } },
      },
    });
    if (!course) throw new NotFoundException('Course not found.');
    return course;
  }

  async updateCourse(tenantId: string, userId: string, courseId: string, dto: UpdateCourseDto) {
    const before = await this.assertCourse(tenantId, courseId);
    if (dto.departmentId) {
      const dept = await (this.tenantPrisma.client as Client).department.findFirst({
        where: { id: dto.departmentId, tenantId, deletedAt: null },
      });
      if (!dept) throw new NotFoundException('Department not found.');
    }
    const course = await (this.tenantPrisma.client as any).course.update({
      where: { id: courseId },
      data: { ...dto, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_UPDATED, 'Course', courseId, {
      before: { name: before.name, creditHours: before.creditHours, courseType: before.courseType },
      after: { ...dto },
    });
    return course;
  }

  async archiveCourse(tenantId: string, userId: string, courseId: string) {
    await this.assertCourse(tenantId, courseId);
    const course = await (this.tenantPrisma.client as any).course.update({
      where: { id: courseId },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_ARCHIVED, 'Course', courseId, {
      after: { code: course.code },
    });
    return course;
  }

  async addPrerequisite(tenantId: string, userId: string, courseId: string, dto: AddPrerequisiteDto) {
    await this.assertCourse(tenantId, courseId);
    const required = await (this.tenantPrisma.client as Client).course.findFirst({
      where: { id: dto.requiredCourseId, tenantId, deletedAt: null },
    });
    if (!required) throw new NotFoundException('Required course not found.');
    if (courseId === dto.requiredCourseId) {
      throw new BadRequestException('A course cannot require itself.');
    }
    const existing = await (this.tenantPrisma.client as Client).coursePrerequisite.findUnique({
      where: { tenantId_courseId_requiredCourseId: { tenantId, courseId, requiredCourseId: dto.requiredCourseId } },
    });
    if (existing) throw new ConflictException('This prerequisite is already listed.');
    if (await this.dependsOn(tenantId, dto.requiredCourseId, courseId)) {
      throw new ConflictException('This prerequisite would create a circular dependency.');
    }
    const prerequisite = await (this.tenantPrisma.client as any).coursePrerequisite.create({
      data: {
        tenantId,
        courseId,
        requiredCourseId: dto.requiredCourseId,
        minGrade: dto.minGrade,
        description: dto.description,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_PREREQUISITE_ADDED, 'CoursePrerequisite', prerequisite.id, {
      after: { courseId, requiredCourseId: dto.requiredCourseId, minGrade: dto.minGrade },
    });
    return prerequisite;
  }

  async removePrerequisite(tenantId: string, userId: string, courseId: string, prerequisiteId: string) {
    const prerequisite = await (this.tenantPrisma.client as Client).coursePrerequisite.findFirst({
      where: { id: prerequisiteId, tenantId, courseId },
    });
    if (!prerequisite) throw new NotFoundException('Prerequisite not found.');
    await (this.tenantPrisma.client as any).coursePrerequisite.delete({ where: { id: prerequisiteId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_PREREQUISITE_REMOVED, 'CoursePrerequisite', prerequisiteId, {
      after: { courseId, requiredCourseId: prerequisite.requiredCourseId },
    });
    return { ok: true };
  }

  // ── Curricula & versions ──────────────────────────────────────────────────

  async listCurricula(tenantId: string, userId: string, query: ListCurriculaQueryDto) {
    const scope = await this.scope(tenantId, userId, 'program');
    const where: Prisma.CurriculumWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.programId ? { programId: query.programId } : {}),
      ...(scope ?? {}),
    };
    if (query.search) {
      where.OR = [{ code: { contains: query.search, mode: 'insensitive' } }, { name: { contains: query.search, mode: 'insensitive' } }];
    }
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).curriculum.findMany({
        where,
        ...this.page(query),
        orderBy: [{ createdAt: 'desc' }],
        include: {
          program: { select: { id: true, code: true, name: true } },
          _count: { select: { versions: true } },
        },
      }),
      (this.tenantPrisma.client as Client).curriculum.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async createCurriculum(tenantId: string, userId: string, dto: CreateCurriculumDto) {
    const program = await (this.tenantPrisma.client as Client).program.findFirst({
      where: { id: dto.programId, tenantId, deletedAt: null },
    });
    if (!program) throw new NotFoundException('Program not found.');
    const existing = await (this.tenantPrisma.client as Client).curriculum.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException('A curriculum with this code already exists.');
    const curriculum = await (this.tenantPrisma.client as any).curriculum.create({
      data: { tenantId, programId: dto.programId, code: dto.code, name: dto.name, description: dto.description, createdBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_CREATED, 'Curriculum', curriculum.id, {
      after: { code: dto.code, name: dto.name, programId: dto.programId },
    });
    return curriculum;
  }

  async getCurriculum(tenantId: string, userId: string, curriculumId: string) {
    const scope = await this.scope(tenantId, userId, 'program');
    const curriculum = await (this.tenantPrisma.client as Client).curriculum.findFirst({
      where: { id: curriculumId, tenantId, deletedAt: null, ...(scope ?? {}) },
      include: {
        program: { select: { id: true, code: true, name: true } },
        versions: {
          orderBy: [{ versionNumber: 'desc' }],
          include: { _count: { select: { courses: true } } },
        },
      },
    });
    if (!curriculum) throw new NotFoundException('Curriculum not found.');
    return curriculum;
  }

  async updateCurriculum(tenantId: string, userId: string, curriculumId: string, dto: UpdateCurriculumDto) {
    const before = await (this.tenantPrisma.client as Client).curriculum.findFirst({
      where: { id: curriculumId, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Curriculum not found.');
    const curriculum = await (this.tenantPrisma.client as any).curriculum.update({
      where: { id: curriculumId },
      data: { ...dto, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_UPDATED, 'Curriculum', curriculumId, {
      before: { name: before.name, isActive: before.isActive },
      after: { ...dto },
    });
    return curriculum;
  }

  async archiveCurriculum(tenantId: string, userId: string, curriculumId: string) {
    const before = await (this.tenantPrisma.client as Client).curriculum.findFirst({
      where: { id: curriculumId, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Curriculum not found.');
    const curriculum = await (this.tenantPrisma.client as any).curriculum.update({
      where: { id: curriculumId },
      data: { deletedAt: new Date(), isActive: false, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_ARCHIVED, 'Curriculum', curriculumId, {
      after: { code: before.code },
    });
    return curriculum;
  }

  async listCurriculumVersions(tenantId: string, userId: string, curriculumId: string) {
    const curriculum = await this.getCurriculum(tenantId, userId, curriculumId);
    return curriculum.versions;
  }

  async createCurriculumVersion(tenantId: string, userId: string, curriculumId: string, dto: CreateCurriculumVersionDto) {
    const scope = await this.scope(tenantId, userId, 'program');
    const curriculum = await (this.tenantPrisma.client as Client).curriculum.findFirst({
      where: { id: curriculumId, tenantId, deletedAt: null, ...(scope ?? {}) },
    });
    if (!curriculum) throw new NotFoundException('Curriculum not found.');
    const latest = await (this.tenantPrisma.client as Client).curriculumVersion.findFirst({
      where: { tenantId, curriculumId },
      orderBy: [{ versionNumber: 'desc' }],
      select: { versionNumber: true },
    });
    const versionNumber = (latest?.versionNumber ?? 0) + 1;
    const version = await (this.tenantPrisma.client as any).curriculumVersion.create({
      data: {
        tenantId,
        curriculumId,
        versionNumber,
        name: dto.name,
        description: dto.description,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        minTotalCredits: dto.minTotalCredits,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_VERSION_CREATED, 'CurriculumVersion', version.id, {
      after: { curriculumId, versionNumber },
    });
    return version;
  }

  async getCurriculumVersion(tenantId: string, userId: string, versionId: string) {
    const scope = await this.scope(tenantId, userId, 'program');
    const version = await (this.tenantPrisma.client as Client).curriculumVersion.findFirst({
      where: { id: versionId, tenantId, ...(scope ? { curriculum: scope } : {}) },
      include: {
        curriculum: { select: { id: true, code: true, name: true, programId: true } },
        courses: {
          orderBy: [{ semester: 'asc' }, { sequence: 'asc' }],
          include: {
            course: {
              select: { id: true, code: true, name: true, creditHours: true, courseType: true },
            },
          },
        },
      },
    });
    if (!version) throw new NotFoundException('Curriculum version not found.');
    return version;
  }

  async updateCurriculumVersion(tenantId: string, userId: string, versionId: string, dto: UpdateCurriculumVersionDto) {
    const before = await (this.tenantPrisma.client as Client).curriculumVersion.findFirst({
      where: { id: versionId, tenantId },
    });
    if (!before) throw new NotFoundException('Curriculum version not found.');
    if (before.status === 'ARCHIVED') throw new BadRequestException('An archived version cannot be edited.');
    const version = await (this.tenantPrisma.client as any).curriculumVersion.update({
      where: { id: versionId },
      data: {
        name: dto.name,
        description: dto.description,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        minTotalCredits: dto.minTotalCredits,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_VERSION_UPDATED, 'CurriculumVersion', versionId, {
      before: { name: before.name, minTotalCredits: before.minTotalCredits },
      after: { ...dto },
    });
    return version;
  }

  async activateCurriculumVersion(tenantId: string, userId: string, versionId: string) {
    const version = await (this.tenantPrisma.client as Client).curriculumVersion.findFirst({
      where: { id: versionId, tenantId },
      include: { curriculum: { select: { id: true } } },
    });
    if (!version) throw new NotFoundException('Curriculum version not found.');
    if (version.status === 'ARCHIVED') throw new BadRequestException('An archived version cannot be activated.');
    const courseCount = await (this.tenantPrisma.client as Client).curriculumCourse.count({
      where: { tenantId, curriculumVersionId: versionId },
    });
    if (courseCount === 0) throw new BadRequestException('Add at least one course before activating this version.');
    await (this.tenantPrisma.client as any).$transaction(async (tx: any) => {
      await tx.curriculumVersion.updateMany({
        where: { tenantId, curriculumId: version.curriculum.id },
        data: { isCurrent: false },
      });
      return tx.curriculumVersion.update({
        where: { id: versionId },
        data: { status: 'ACTIVE', isCurrent: true, updatedBy: userId },
      });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_VERSION_ACTIVATED, 'CurriculumVersion', versionId, {
      after: { curriculumId: version.curriculum.id, status: 'ACTIVE' },
    });
    return { activated: true, versionId };
  }

  async archiveCurriculumVersion(tenantId: string, userId: string, versionId: string) {
    const version = await (this.tenantPrisma.client as Client).curriculumVersion.findFirst({
      where: { id: versionId, tenantId },
    });
    if (!version) throw new NotFoundException('Curriculum version not found.');
    if (version.status === 'ARCHIVED') return version;
    const updated = await (this.tenantPrisma.client as any).curriculumVersion.update({
      where: { id: versionId },
      data: { status: 'ARCHIVED', isCurrent: false, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_VERSION_UPDATED, 'CurriculumVersion', versionId, {
      after: { status: 'ARCHIVED' },
    });
    return updated;
  }

  async setCurriculumCourses(tenantId: string, userId: string, versionId: string, dto: SetCurriculumCoursesDto) {
    const version = await (this.tenantPrisma.client as Client).curriculumVersion.findFirst({
      where: { id: versionId, tenantId },
    });
    if (!version) throw new NotFoundException('Curriculum version not found.');
    if (version.status === 'ARCHIVED') throw new BadRequestException('An archived version cannot be edited.');
    const courseIds = [...new Set(dto.courses.map((c) => c.courseId))];
    if (courseIds.length !== dto.courses.length) {
      throw new BadRequestException('The same course cannot appear twice in one version.');
    }
    const found = await (this.tenantPrisma.client as Client).course.count({
      where: { id: { in: courseIds }, tenantId, deletedAt: null },
    });
    if (found !== courseIds.length) throw new NotFoundException('One or more courses were not found.');

    const data = dto.courses.map((c) => ({
      tenantId,
      curriculumVersionId: versionId,
      courseId: c.courseId,
      semester: c.semester,
      category: c.category,
      isCompulsory: c.isCompulsory ?? true,
      sequence: c.sequence ?? 0,
      minGrade: c.minGrade,
      creditOverride: c.creditOverride,
      createdBy: userId,
    }));

    const result = await (this.tenantPrisma.client as any).$transaction(async (tx: any) => {
      await tx.curriculumCourse.deleteMany({ where: { tenantId, curriculumVersionId: versionId } });
      return tx.curriculumCourse.createMany({ data });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_COURSES_REPLACED, 'CurriculumVersion', versionId, {
      after: { courseCount: result.count, semesters: [...new Set(data.map((d) => d.semester))] },
    });
    return { replaced: result.count };
  }

  async validateCurriculumVersion(tenantId: string, userId: string, versionId: string) {
    const version = await this.getCurriculumVersion(tenantId, userId, versionId);
    const warnings: string[] = [];
    const summary = {
      courses: version.courses.length,
      totalCredits: 0,
      semesters: 0,
    };

    const bySemester = new Map<number, { courses: number; credits: number }>();
    for (const cc of version.courses) {
      const credits = cc.creditOverride ?? cc.course.creditHours;
      summary.totalCredits += credits;
      const slot = bySemester.get(cc.semester) ?? { courses: 0, credits: 0 };
      slot.courses += 1;
      slot.credits += credits;
      bySemester.set(cc.semester, slot);
    }
    summary.semesters = bySemester.size;

    const semesters = [...bySemester.keys()].sort((a, b) => a - b);
    if (semesters.length === 0) {
      warnings.push('Version has no courses — add courses before activating.');
    } else {
      const maxSemester = semesters[semesters.length - 1] as number;
      for (let sem = 1; sem <= maxSemester; sem++) {
        if (!bySemester.has(sem)) warnings.push(`Semester ${sem} has no courses (gap).`);
      }
      for (const [sem, slot] of bySemester) {
        if (slot.credits < 12) warnings.push(`Semester ${sem} has only ${slot.credits} credits (recommend ≥ 12).`);
      }
      const compulsoryFlags = [...new Set(version.courses.map((c) => c.isCompulsory))];
      if (compulsoryFlags.length === 1 && compulsoryFlags[0] === false) {
        warnings.push('Version has no compulsory courses.');
      }
    }
    if (version.minTotalCredits && summary.totalCredits < version.minTotalCredits) {
      warnings.push(`Total credits (${summary.totalCredits}) below version minimum (${version.minTotalCredits}).`);
    }
    if (summary.totalCredits < 120) warnings.push(`Total credits (${summary.totalCredits}) is low for a full degree (recommend ≥ 120).`);

    await this.audit(tenantId, userId, AUDIT_ACTIONS.CURRICULUM_VERSION_VALIDATED, 'CurriculumVersion', versionId, {
      after: { valid: warnings.length === 0, warningCount: warnings.length },
    });
    return { versionId, summary, warnings, valid: warnings.length === 0 };
  }

  // ── Course offerings ──────────────────────────────────────────────────────

  async listCourseOfferings(tenantId: string, userId: string, query: ListCourseOfferingsQueryDto) {
    const scope = await this.scope(tenantId, userId, 'program');
    const where: Prisma.CourseOfferingWhereInput = {
      tenantId,
      deletedAt: null,
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.programId ? { programId: query.programId } : {}),
      ...(query.sectionId ? { sectionId: query.sectionId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.status ? { status: query.status as CourseOfferingStatus } : {}),
      ...(scope ?? {}),
    };
    if (query.search) {
      where.OR = [
        { code: { contains: query.search, mode: 'insensitive' } },
        { course: { name: { contains: query.search, mode: 'insensitive' } } },
        { course: { code: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).courseOffering.findMany({
        where,
        ...this.page(query),
        orderBy: [{ createdAt: 'desc' }],
        include: {
          course: { select: { id: true, code: true, name: true, creditHours: true, courseType: true } },
          term: { select: { id: true, name: true, code: true } },
          program: { select: { id: true, code: true, name: true } },
          section: { select: { id: true, name: true, code: true } },
          batch: { select: { id: true, name: true, code: true } },
          faculty: { include: { user: { select: { id: true, fullName: true, email: true } } } },
        },
      }),
      (this.tenantPrisma.client as Client).courseOffering.count({ where }),
    ]);
    const occupancy = await this.offeringOccupancy(
      tenantId,
      items.map((i) => i.id),
    );
    const annotated = items.map((item) => {
      const occ = occupancy.get(item.id) ?? { enrolled: 0, waitlisted: 0 };
      return { ...item, enrolledCount: occ.enrolled, waitlistedCount: occ.waitlisted, seatsLeft: item.capacity ? Math.max(item.capacity - occ.enrolled, 0) : null };
    });
    return this.paginate(annotated, total);
  }

  async createCourseOffering(tenantId: string, userId: string, dto: CreateCourseOfferingDto) {
    await this.assertCourse(tenantId, dto.courseId);
    const term = await (this.tenantPrisma.client as Client).term.findFirst({
      where: { id: dto.termId, tenantId, deletedAt: null },
    });
    if (!term) throw new NotFoundException('Term not found.');
    const program = await (this.tenantPrisma.client as Client).program.findFirst({
      where: { id: dto.programId, tenantId, deletedAt: null },
    });
    if (!program) throw new NotFoundException('Program not found.');
    if (dto.sectionId) {
      const section = await (this.tenantPrisma.client as Client).section.findFirst({
        where: { id: dto.sectionId, tenantId, deletedAt: null },
      });
      if (!section) throw new NotFoundException('Section not found.');
    }
    if (dto.batchId) {
      const batch = await (this.tenantPrisma.client as Client).batch.findFirst({
        where: { id: dto.batchId, tenantId, deletedAt: null },
      });
      if (!batch) throw new NotFoundException('Batch not found.');
    }
    if (dto.enrollmentStartAt && dto.enrollmentEndAt && new Date(dto.enrollmentEndAt) <= new Date(dto.enrollmentStartAt)) {
      throw new BadRequestException('Enrollment end must be after enrollment start.');
    }
    const existing = await (this.tenantPrisma.client as Client).courseOffering.findUnique({
      where: { tenantId_code: { tenantId, code: dto.code } },
    });
    if (existing) throw new ConflictException('A course offering with this code already exists.');

    const offering = await (this.tenantPrisma.client as any).courseOffering.create({
      data: {
        tenantId,
        courseId: dto.courseId,
        termId: dto.termId,
        academicYearId: term.academicYearId,
        programId: dto.programId,
        sectionId: dto.sectionId,
        batchId: dto.batchId,
        campusId: dto.campusId,
        code: dto.code,
        creditHours: dto.creditHours,
        status: dto.status ?? 'PLANNED',
        mode: dto.mode,
        capacity: dto.capacity,
        waitlistCapacity: dto.waitlistCapacity ?? 0,
        enrollmentStartAt: dto.enrollmentStartAt ? new Date(dto.enrollmentStartAt) : undefined,
        enrollmentEndAt: dto.enrollmentEndAt ? new Date(dto.enrollmentEndAt) : undefined,
        schedule: (dto.schedule as Prisma.InputJsonValue) ?? undefined,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_OFFERING_CREATED, 'CourseOffering', offering.id, {
      after: { code: dto.code, courseId: dto.courseId, termId: dto.termId },
    });
    return offering;
  }

  async getCourseOffering(tenantId: string, userId: string, offeringId: string) {
    const scope = await this.scope(tenantId, userId, 'program');
    const offering = await (this.tenantPrisma.client as Client).courseOffering.findFirst({
      where: { id: offeringId, tenantId, deletedAt: null, ...(scope ?? {}) },
      include: {
        course: { select: { id: true, code: true, name: true, creditHours: true, courseType: true, description: true } },
        term: { select: { id: true, name: true, code: true } },
        academicYear: { select: { id: true, name: true, code: true } },
        program: { select: { id: true, code: true, name: true } },
        section: { select: { id: true, name: true, code: true } },
        batch: { select: { id: true, name: true, code: true } },
        campus: { select: { id: true, name: true, code: true } },
        faculty: { include: { user: { select: { id: true, fullName: true, email: true } } } },
      },
    });
    if (!offering) throw new NotFoundException('Course offering not found.');
    const occupancy = await this.offeringOccupancy(tenantId, [offeringId]);
    const occ = occupancy.get(offeringId) ?? { enrolled: 0, waitlisted: 0 };
    return { ...offering, enrolledCount: occ.enrolled, waitlistedCount: occ.waitlisted, seatsLeft: offering.capacity ? Math.max(offering.capacity - occ.enrolled, 0) : null };
  }

  async updateCourseOffering(tenantId: string, userId: string, offeringId: string, dto: UpdateCourseOfferingDto) {
    const before = await (this.tenantPrisma.client as Client).courseOffering.findFirst({
      where: { id: offeringId, tenantId, deletedAt: null },
    });
    if (!before) throw new NotFoundException('Course offering not found.');
    if (dto.status === 'CANCELLED') {
      return this.cancelCourseOffering(tenantId, userId, offeringId);
    }
    if (dto.enrollmentStartAt && dto.enrollmentEndAt && new Date(dto.enrollmentEndAt) <= new Date(dto.enrollmentStartAt)) {
      throw new BadRequestException('Enrollment end must be after enrollment start.');
    }
    const offering = await (this.tenantPrisma.client as any).courseOffering.update({
      where: { id: offeringId },
      data: {
        sectionId: dto.sectionId,
        batchId: dto.batchId,
        campusId: dto.campusId,
        code: dto.code,
        creditHours: dto.creditHours,
        status: dto.status,
        mode: dto.mode,
        capacity: dto.capacity,
        waitlistCapacity: dto.waitlistCapacity,
        enrollmentStartAt: dto.enrollmentStartAt ? new Date(dto.enrollmentStartAt) : undefined,
        enrollmentEndAt: dto.enrollmentEndAt ? new Date(dto.enrollmentEndAt) : undefined,
        schedule: dto.schedule !== undefined ? (dto.schedule as Prisma.InputJsonValue) : undefined,
        updatedBy: userId,
      },
    });
    await this.audit(
      tenantId,
      userId,
      dto.status && dto.status !== before.status ? AUDIT_ACTIONS.COURSE_OFFERING_STATUS_CHANGED : AUDIT_ACTIONS.COURSE_OFFERING_UPDATED,
      'CourseOffering',
      offeringId,
      { before: { status: before.status }, after: { ...dto } },
    );
    return offering;
  }

  async cancelCourseOffering(tenantId: string, userId: string, offeringId: string) {
    const offering = await (this.tenantPrisma.client as Client).courseOffering.findFirst({
      where: { id: offeringId, tenantId, deletedAt: null },
    });
    if (!offering) throw new NotFoundException('Course offering not found.');
    const result = await (this.tenantPrisma.client as any).$transaction(async (tx: any) => {
      await tx.courseRegistration.updateMany({
        where: { tenantId, courseOfferingId: offeringId, status: { in: [...ACTIVE_REGISTRATION_STATUSES] } },
        data: { status: 'DROPPED', dropReason: 'offering_cancelled', updatedBy: userId },
      });
      return tx.courseOffering.update({
        where: { id: offeringId },
        data: { status: 'CANCELLED', updatedBy: userId },
      });
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_OFFERING_CANCELLED, 'CourseOffering', offeringId, {
      after: { status: 'CANCELLED' },
    });
    return result;
  }

  async assignFaculty(tenantId: string, userId: string, offeringId: string, dto: AssignFacultyDto) {
    const offering = await (this.tenantPrisma.client as Client).courseOffering.findFirst({
      where: { id: offeringId, tenantId, deletedAt: null },
    });
    if (!offering) throw new NotFoundException('Course offering not found.');
    const faculty = await (this.tenantPrisma.client as Client).user.findFirst({
      where: { id: dto.userId, tenantId },
    });
    if (!faculty) throw new NotFoundException('User not found in tenant.');
    const existing = await (this.tenantPrisma.client as Client).courseOfferingFaculty.findUnique({
      where: { tenantId_courseOfferingId_userId: { tenantId, courseOfferingId: offeringId, userId: dto.userId } },
    });
    if (existing) throw new ConflictException('User is already assigned to this offering.');
    const assignment = await (this.tenantPrisma.client as any).courseOfferingFaculty.create({
      data: {
        tenantId,
        courseOfferingId: offeringId,
        userId: dto.userId,
        role: dto.role ?? 'CO_TEACHER',
        allocationPercent: dto.allocationPercent,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.FACULTY_ASSIGNMENT_CREATED, 'CourseOfferingFaculty', assignment.id, {
      after: { offeringId, userId: dto.userId, role: dto.role ?? 'CO_TEACHER' },
    });
    return assignment;
  }

  async updateFacultyAssignment(tenantId: string, userId: string, assignmentId: string, dto: UpdateFacultyAssignmentDto) {
    const before = await (this.tenantPrisma.client as Client).courseOfferingFaculty.findFirst({
      where: { id: assignmentId, tenantId },
    });
    if (!before) throw new NotFoundException('Faculty assignment not found.');
    const assignment = await (this.tenantPrisma.client as any).courseOfferingFaculty.update({
      where: { id: assignmentId },
      data: { ...dto },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.FACULTY_ASSIGNMENT_UPDATED, 'CourseOfferingFaculty', assignmentId, {
      before: { role: before.role, allocationPercent: before.allocationPercent, isActive: before.isActive },
      after: { ...dto },
    });
    return assignment;
  }

  async removeFacultyAssignment(tenantId: string, userId: string, assignmentId: string) {
    const before = await (this.tenantPrisma.client as Client).courseOfferingFaculty.findFirst({
      where: { id: assignmentId, tenantId },
    });
    if (!before) throw new NotFoundException('Faculty assignment not found.');
    await (this.tenantPrisma.client as any).courseOfferingFaculty.delete({ where: { id: assignmentId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.FACULTY_ASSIGNMENT_REMOVED, 'CourseOfferingFaculty', assignmentId, {
      after: { offeringId: before.courseOfferingId, userId: before.userId },
    });
    return { ok: true };
  }

  async listFacultyByOffering(tenantId: string, userId: string, offeringId: string) {
    await this.getCourseOffering(tenantId, userId, offeringId);
    return (this.tenantPrisma.client as Client).courseOfferingFaculty.findMany({
      where: { tenantId, courseOfferingId: offeringId },
      include: {
        courseOffering: { select: { id: true, code: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  /** My teaching load — offerings the current user is assigned to (faculty self-service). */
  async myOfferings(tenantId: string, userId: string, query: AcademicsPaginationDto) {
    const where: Prisma.CourseOfferingWhereInput = {
      tenantId,
      deletedAt: null,
      faculty: { some: { tenantId, userId, isActive: true } },
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).courseOffering.findMany({
        where,
        ...this.page(query),
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          course: { select: { id: true, code: true, name: true, creditHours: true } },
          term: { select: { id: true, name: true, code: true } },
        },
      }),
      (this.tenantPrisma.client as Client).courseOffering.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  // ── Course registration ───────────────────────────────────────────────────

  async registerStudent(tenantId: string, userId: string, dto: CreateCourseRegistrationDto) {
    const offering = await (this.tenantPrisma.client as Client).courseOffering.findFirst({
      where: { id: dto.courseOfferingId, tenantId, deletedAt: null },
      include: { course: { include: { prerequisites: { include: { requiredCourse: { select: { id: true, name: true, code: true } } } } } } },
    });
    if (!offering) throw new NotFoundException('Course offering not found.');
    if (offering.status === 'CANCELLED' || offering.status === 'COMPLETED' || offering.status === 'CLOSED') {
      throw new BadRequestException('This offering is not accepting registrations.');
    }
    if (offering.enrollmentStartAt || offering.enrollmentEndAt) {
      const now = new Date();
      const start = offering.enrollmentStartAt ?? new Date(0);
      const end = offering.enrollmentEndAt ?? new Date(8640000000000000);
      if (now < start || now > end) {
        throw new BadRequestException('Enrollment window for this offering is closed.');
      }
    }

    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: dto.studentId, tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException('Student not found.');
    if (student.programId && offering.programId !== student.programId) {
      throw new BadRequestException('Student is not enrolled in the program this offering belongs to.');
    }

    const existing = await (this.tenantPrisma.client as Client).courseRegistration.findUnique({
      where: { tenantId_studentId_courseOfferingId: { tenantId, studentId: dto.studentId, courseOfferingId: dto.courseOfferingId } },
    });
    if (existing) throw new ConflictException('Student is already registered for this offering.');

    if (offering.course.prerequisites.length > 0) {
      const unmet: string[] = [];
      for (const prereq of offering.course.prerequisites) {
        if (!(await this.hasClearedCourse(tenantId, dto.studentId, prereq.requiredCourseId))) {
          unmet.push(`${prereq.requiredCourse.code}` + (prereq.minGrade ? ` (min ${prereq.minGrade})` : ''));
        }
      }
      if (unmet.length > 0) {
        throw new BadRequestException(`Prerequisites not met: ${unmet.join(', ')}`);
      }
    }

    const occupancy = await this.offeringOccupancy(tenantId, [offering.id]);
    const occ = occupancy.get(offering.id) ?? { enrolled: 0, waitlisted: 0 };

    let status = 'REGISTERED';
    let waitlistPosition: number | null = null;
    if (offering.capacity != null && occ.enrolled >= offering.capacity) {
      if (offering.waitlistCapacity == null || offering.waitlistCapacity <= 0) {
        throw new BadRequestException('Offering is full.');
      }
      if (occ.waitlisted >= offering.waitlistCapacity) {
        throw new BadRequestException('Offering is full (waitlist exhausted).');
      }
      status = 'WAITLISTED';
      waitlistPosition = occ.waitlisted + 1;
    }

    const registration = await (this.tenantPrisma.client as any).courseRegistration.create({
      data: {
        tenantId,
        studentId: dto.studentId,
        courseOfferingId: offering.id,
        termId: offering.termId,
        status,
        waitlistPosition,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_REGISTRATION_CREATED, 'CourseRegistration', registration.id, {
      after: { studentId: dto.studentId, offeringId: offering.id, status },
    });
    await this.notifyStudent(
      tenantId,
      dto.studentId,
      status === 'WAITLISTED' ? 'Waitlisted in a course' : 'Course registration confirmed',
      `You are ${status === 'WAITLISTED' ? 'waitlisted for ' : 'registered for '}${offering.course.name} (${offering.code}).${status === 'WAITLISTED' ? ` Position: ${waitlistPosition}.` : ''}`,
    );
    return registration;
  }

  async bulkRegister(tenantId: string, userId: string, dto: BulkRegisterDto) {
    const offering = await (this.tenantPrisma.client as Client).courseOffering.findFirst({
      where: { id: dto.courseOfferingId, tenantId, deletedAt: null },
    });
    if (!offering) throw new NotFoundException('Course offering not found.');

    let students: { id: string; fullName: string }[] = [];
    if (dto.studentIds && dto.studentIds.length > 0) {
      students = await (this.tenantPrisma.client as Client).student.findMany({
        where: { id: { in: dto.studentIds }, tenantId, deletedAt: null },
        select: { id: true, fullName: true },
      });
    } else if (dto.sectionId) {
      students = await (this.tenantPrisma.client as Client).student.findMany({
        where: { tenantId, sectionId: dto.sectionId, deletedAt: null },
        select: { id: true, fullName: true },
      });
    } else if (dto.batchId) {
      students = await (this.tenantPrisma.client as Client).student.findMany({
        where: { tenantId, batchId: dto.batchId, deletedAt: null },
        select: { id: true, fullName: true },
      });
    }
    if (students.length === 0) {
      throw new BadRequestException('No students matched the provided section, batch, or student ids.');
    }

    const created: string[] = [];
    const waitlisted: string[] = [];
    const skipped: { studentId: string; name: string; reason: string }[] = [];

    for (const student of students) {
      try {
        const reg = await this.registerStudent(tenantId, userId, { studentId: student.id, courseOfferingId: offering.id });
        if (reg.status === 'WAITLISTED') waitlisted.push(student.id);
        else created.push(student.id);
      } catch (error) {
        skipped.push({
          studentId: student.id,
          name: student.fullName,
          reason: error instanceof Error ? error.message : 'unknown error',
        });
      }
    }

    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_REGISTRATION_BULK_IMPORTED, 'CourseRegistration', offering.id, {
      after: { candidateCount: students.length, created: created.length, waitlisted: waitlisted.length, skipped: skipped.length },
    });
    return { offeringId: offering.id, total: students.length, created: created.length, waitlisted: waitlisted.length, skipped };
  }

  async updateRegistration(tenantId: string, userId: string, registrationId: string, dto: UpdateCourseRegistrationDto) {
    const registration = await (this.tenantPrisma.client as Client).courseRegistration.findFirst({
      where: { id: registrationId, tenantId },
      include: { courseOffering: { include: { course: { select: { id: true, name: true } } } }, student: { select: { id: true } } },
    });
    if (!registration) throw new NotFoundException('Course registration not found.');

    if (registration.status === 'COMPLETED') {
      throw new BadRequestException('A completed registration cannot be changed.');
    }
    if (registration.status === 'WITHDRAWN' || registration.status === 'DROPPED') {
      throw new BadRequestException('This registration is already closed.');
    }

    const result = await (this.tenantPrisma.client as any).$transaction(async (tx: any) => {
      if (dto.status === 'CONFIRMED') {
        if (registration.status === 'WAITLISTED') {
          const full = await tx.courseRegistration.count({
            where: { tenantId, courseOfferingId: registration.courseOfferingId, status: { in: ACTIVE_SEATS } },
          });
          const offering = await tx.courseOffering.findUnique({ where: { id: registration.courseOfferingId }, select: { capacity: true } });
          if (offering?.capacity != null && full >= offering.capacity) {
            throw new BadRequestException('No seat available — the student must remain waitlisted.');
          }
        }
        const updated = await tx.courseRegistration.update({
          where: { id: registrationId },
          data: { status: 'CONFIRMED', waitlistPosition: null, approvedByUserId: userId, updatedBy: userId },
        });
        return { updated, action: 'CONFIRMED' };
      }

      if (dto.status === 'WITHDRAWN' || dto.status === 'DROPPED') {
        const updated = await tx.courseRegistration.update({
          where: { id: registrationId },
          data: { status: dto.status, waitlistPosition: null, dropReason: dto.dropReason, updatedBy: userId },
        });
        let promoted: string | null = null;
        if (registration.status !== 'WAITLISTED') {
          const next = await tx.courseRegistration.findFirst({
            where: { tenantId, courseOfferingId: registration.courseOfferingId, status: 'WAITLISTED' },
            orderBy: [{ waitlistPosition: 'asc' }],
          });
          if (next) {
            await tx.courseRegistration.update({
              where: { id: next.id },
              data: { status: 'CONFIRMED', waitlistPosition: null, approvedByUserId: userId, updatedBy: userId },
            });
            await tx.courseRegistration.updateMany({
              where: { tenantId, courseOfferingId: registration.courseOfferingId, status: 'WAITLISTED' },
              data: { waitlistPosition: undefined },
            });
            const remaining = await tx.courseRegistration.findMany({
              where: { tenantId, courseOfferingId: registration.courseOfferingId, status: 'WAITLISTED' },
              orderBy: [{ createdAt: 'asc' }],
              select: { id: true },
            });
            for (let i = 0; i < remaining.length; i++) {
              await tx.courseRegistration.update({ where: { id: remaining[i].id }, data: { waitlistPosition: i + 1 } });
            }
            promoted = next.id;
          }
        }
        return { updated, action: dto.status, promoted };
      }

      if (dto.status === 'COMPLETED') {
        const updated = await tx.courseRegistration.update({
          where: { id: registrationId },
          data: { status: 'COMPLETED', completedAt: new Date(), updatedBy: userId },
        });
        const backlog = await tx.courseBacklog.findFirst({
          where: { tenantId, studentId: registration.studentId, courseId: registration.courseOffering.course.id, status: 'OPEN' },
        });
        if (backlog) {
          await tx.courseBacklog.update({
            where: { id: backlog.id },
            data: { status: 'CLEARED', clearedAt: new Date(), clearedInRegistrationId: registrationId, updatedBy: userId },
          });
        }
        return { updated, action: 'COMPLETED', backlogClearedId: backlog?.id ?? null };
      }

      throw new BadRequestException(`Unsupported target status: ${dto.status}`);
    });

    const action =
      result.action === 'CONFIRMED'
        ? AUDIT_ACTIONS.COURSE_REGISTRATION_CONFIRMED
        : result.action === 'COMPLETED'
          ? AUDIT_ACTIONS.COURSE_REGISTRATION_COMPLETED
          : AUDIT_ACTIONS.COURSE_REGISTRATION_WITHDRAWN;
    await this.audit(tenantId, userId, action, 'CourseRegistration', registrationId, {
      before: { status: registration.status },
      after: { status: dto.status, promoted: result.promoted ?? null },
    });
    if (result.promoted) {
      const promotedReg = await (this.tenantPrisma.client as Client).courseRegistration.findFirst({
        where: { id: result.promoted },
        include: { courseOffering: { include: { course: { select: { name: true } } } } },
      });
      if (promotedReg) {
        await this.notifyStudent(
          tenantId,
          promotedReg.studentId,
          'Promoted from waitlist',
          `You have been confirmed in ${promotedReg.courseOffering.course.name} (${promotedReg.courseOffering.code}).`,
        );
      }
    }
    return result.updated;
  }

  async listRegistrations(tenantId: string, userId: string, query: ListCourseRegistrationsQueryDto) {
    const scope = await this.scope(tenantId, userId, 'student');
    const where: Prisma.CourseRegistrationWhereInput = {
      tenantId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.courseOfferingId ? { courseOfferingId: query.courseOfferingId } : {}),
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.status ? { status: query.status as CourseRegistrationStatus } : {}),
      ...(scope ?? {}),
    };
    if (query.search) {
      where.OR = [
        { student: { fullName: { contains: query.search, mode: 'insensitive' } } },
        { courseOffering: { code: { contains: query.search, mode: 'insensitive' } } },
        { courseOffering: { course: { name: { contains: query.search, mode: 'insensitive' } } } },
      ];
    }
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).courseRegistration.findMany({
        where,
        ...this.page(query),
        orderBy: [{ createdAt: 'desc' }],
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
          courseOffering: { select: { id: true, code: true, course: { select: { id: true, code: true, name: true, creditHours: true } } } },
          term: { select: { id: true, name: true, code: true } },
        },
      }),
      (this.tenantPrisma.client as Client).courseRegistration.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  async registrationReport(tenantId: string, userId: string, query: RegistrationReportQueryDto) {
    const scope = await this.scope(tenantId, userId, 'program');
    const where: Prisma.CourseOfferingWhereInput = {
      tenantId,
      termId: query.termId,
      deletedAt: null,
      ...(query.programId ? { programId: query.programId } : {}),
      ...(scope ?? {}),
    };
    const offerings = await (this.tenantPrisma.client as Client).courseOffering.findMany({
      where,
      include: {
        course: { select: { id: true, code: true, name: true, creditHours: true } },
        program: { select: { id: true, code: true, name: true } },
        section: { select: { id: true, name: true, code: true } },
      },
    });
    const occupancy = await this.offeringOccupancy(tenantId, offerings.map((o) => o.id));
    const rows = offerings.map((o) => {
      const occ = occupancy.get(o.id) ?? { enrolled: 0, waitlisted: 0 };
      const enrolled = occ.enrolled + occ.waitlisted;
      return {
        offeringId: o.id,
        code: o.code,
        courseCode: o.course.code,
        courseName: o.course.name,
        creditHours: o.creditHours ?? o.course.creditHours,
        program: o.program.name,
        section: o.section?.name ?? null,
        capacity: o.capacity,
        enrolled,
        waitlisted: occ.waitlisted,
        utilisation: o.capacity ? Math.round((enrolled / o.capacity) * 100) : null,
      };
    });
    const summary = rows.reduce<{ totalSeats: number; totalRegistered: number }>(
      (acc, r) => {
        acc.totalSeats += r.capacity ?? 0;
        acc.totalRegistered += r.enrolled;
        return acc;
      },
      { totalSeats: 0, totalRegistered: 0 },
    );
    return { termId: query.termId, summary, rows };
  }

  // ── Academic advising ─────────────────────────────────────────────────────

  async createAdvisingRecord(tenantId: string, userId: string, dto: CreateAdvisingRecordDto) {
    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: dto.studentId, tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException('Student not found.');
    const advisor = await (this.tenantPrisma.client as Client).user.findFirst({
      where: { id: dto.advisorUserId, tenantId },
    });
    if (!advisor) throw new NotFoundException('Advisor not found in tenant.');
    if (dto.termId) {
      const term = await (this.tenantPrisma.client as Client).term.findFirst({
        where: { id: dto.termId, tenantId, deletedAt: null },
      });
      if (!term) throw new NotFoundException('Term not found.');
    }
    const record = await (this.tenantPrisma.client as any).academicAdvisingRecord.create({
      data: {
        tenantId,
        studentId: dto.studentId,
        advisorUserId: dto.advisorUserId,
        termId: dto.termId,
        sessionType: dto.sessionType ?? 'ACADEMIC',
        summary: dto.summary,
        details: dto.details,
        actionItems: dto.actionItems,
        priority: dto.priority ?? 'NORMAL',
        followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : undefined,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADVISING_RECORD_CREATED, 'AcademicAdvisingRecord', record.id, {
      after: { studentId: dto.studentId, advisorUserId: dto.advisorUserId, priority: record.priority },
    });
    return record;
  }

  async updateAdvisingRecord(tenantId: string, userId: string, recordId: string, dto: UpdateAdvisingRecordDto) {
    const before = await (this.tenantPrisma.client as Client).academicAdvisingRecord.findFirst({
      where: { id: recordId, tenantId },
    });
    if (!before) throw new NotFoundException('Advising record not found.');
    if (before.status === 'RESOLVED') throw new BadRequestException('A resolved record cannot be edited.');
    const record = await (this.tenantPrisma.client as any).academicAdvisingRecord.update({
      where: { id: recordId },
      data: {
        ...dto,
        followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : undefined,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADVISING_RECORD_UPDATED, 'AcademicAdvisingRecord', recordId, {
      before: { status: before.status, priority: before.priority },
      after: { ...dto },
    });
    return record;
  }

  async resolveAdvisingRecord(tenantId: string, userId: string, recordId: string) {
    const before = await (this.tenantPrisma.client as Client).academicAdvisingRecord.findFirst({
      where: { id: recordId, tenantId },
    });
    if (!before) throw new NotFoundException('Advising record not found.');
    if (before.status === 'RESOLVED') return before;
    const record = await (this.tenantPrisma.client as any).academicAdvisingRecord.update({
      where: { id: recordId },
      data: { status: 'RESOLVED', resolvedAt: new Date(), updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADVISING_RECORD_RESOLVED, 'AcademicAdvisingRecord', recordId, {
      after: { status: 'RESOLVED' },
    });
    return record;
  }

  async listAdvisingRecords(tenantId: string, userId: string, query: ListAdvisingQueryDto) {
    const scope = await this.scope(tenantId, userId, 'student');
    const where: Prisma.AcademicAdvisingRecordWhereInput = {
      tenantId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.advisorUserId ? { advisorUserId: query.advisorUserId } : {}),
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.status ? { status: query.status as AdvisingStatus } : {}),
      ...(scope ?? {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).academicAdvisingRecord.findMany({
        where,
        ...this.page(query),
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true } },
          advisor: { select: { id: true, fullName: true, email: true } },
          term: { select: { id: true, name: true, code: true } },
        },
      }),
      (this.tenantPrisma.client as Client).academicAdvisingRecord.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  // ── Academic progression / promotion ──────────────────────────────────────

  async recordProgression(tenantId: string, userId: string, dto: CreateProgressionRecordDto) {
    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: dto.studentId, tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException('Student not found.');
    const program = await (this.tenantPrisma.client as Client).program.findFirst({
      where: { id: dto.programId, tenantId, deletedAt: null },
    });
    if (!program) throw new NotFoundException('Program not found.');
    const academicYear = await (this.tenantPrisma.client as Client).academicYear.findFirst({
      where: { id: dto.academicYearId, tenantId, deletedAt: null },
    });
    if (!academicYear) throw new NotFoundException('Academic year not found.');
    const record = await (this.tenantPrisma.client as any).academicProgressionRecord.create({
      data: {
        tenantId,
        studentId: dto.studentId,
        programId: dto.programId,
        academicYearId: dto.academicYearId,
        batchId: dto.batchId,
        fromSemester: dto.fromSemester,
        toSemester: dto.toSemester,
        status: dto.status,
        creditsEarned: dto.creditsEarned,
        creditsRequired: dto.creditsRequired,
        gpaScore: dto.gpaScore,
        backlogOpen: dto.backlogOpen ?? 0,
        backlogCleared: dto.backlogCleared ?? 0,
        decisionBy: userId,
        decidedAt: new Date(),
        remarks: dto.remarks,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.PROGRESSION_RECORDED, 'AcademicProgressionRecord', record.id, {
      after: { studentId: dto.studentId, fromSemester: dto.fromSemester, toSemester: dto.toSemester, status: dto.status },
    });
    return record;
  }

  async promoteBatch(tenantId: string, userId: string, dto: PromoteBatchDto) {
    const batch = await (this.tenantPrisma.client as Client).batch.findFirst({
      where: { id: dto.batchId, tenantId, deletedAt: null },
      include: {
        program: { select: { id: true, durationYears: true } },
        students: { where: { deletedAt: null, status: { in: ['ACTIVE', 'ENROLLED'] } }, select: { id: true, fullName: true } },
      },
    });
    if (!batch) throw new NotFoundException('Batch not found.');
    const academicYear = await (this.tenantPrisma.client as Client).academicYear.findFirst({
      where: { id: dto.academicYearId, tenantId, deletedAt: null },
    });
    if (!academicYear) throw new NotFoundException('Academic year not found.');

    const results: { studentId: string; name: string; fromSemester: number; toSemester: number; status: string }[] = [];
    const trackedStatuses = PROGRESSION_STATUSES as readonly string[];

    for (const student of batch.students) {
      const latest = await (this.tenantPrisma.client as Client).academicProgressionRecord.findFirst({
        where: { tenantId, studentId: student.id },
        orderBy: [{ createdAt: 'desc' }],
        select: { toSemester: true },
      });
      const fromSemester = dto.fromSemester ?? latest?.toSemester ?? 1;
      const toSemester = Math.max(dto.toSemester, fromSemester);

      const openBacklogs = await (this.tenantPrisma.client as Client).courseBacklog.count({
        where: { tenantId, studentId: student.id, status: 'OPEN' },
      });
      const creditsEarned = await this.earnedCreditsInYear(tenantId, student.id, academicYear.id);

      let status: string;
      if (toSemester > fromSemester) {
        if (openBacklogs > (dto.backlogThreshold ?? 0)) {
          status = 'REAPPEARING';
        } else if (
          batch.program.durationYears &&
          toSemester > batch.program.durationYears * 2
        ) {
          status = 'GRADUATED';
        } else {
          status = 'PROMOTED';
        }
      } else if (toSemester < fromSemester) {
        status = 'CONTINUING';
      } else {
        status = openBacklogs > (dto.backlogThreshold ?? 0) ? 'REAPPEARING' : 'CONTINUING';
      }

      await (this.tenantPrisma.client as any).academicProgressionRecord.create({
        data: {
          tenantId,
          studentId: student.id,
          programId: batch.program.id,
          academicYearId: academicYear.id,
          batchId: batch.id,
          fromSemester,
          toSemester,
          status,
          creditsEarned,
          backlogOpen: openBacklogs,
          decisionBy: userId,
          decidedAt: new Date(),
          remarks: dto.remarks,
          createdBy: userId,
        },
      });
      results.push({ studentId: student.id, name: student.fullName, fromSemester, toSemester, status });
    }

    await this.audit(tenantId, userId, AUDIT_ACTIONS.PROGRESSION_BATCH_PROMOTED, 'Batch', batch.id, {
      after: { academicYearId: academicYear.id, total: results.length, statuses: results.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {}) },
    });
    if (results.some((r) => !trackedStatuses.includes(r.status))) {
      this.logger.warn(`promoteBatch produced an untracked status for batch ${batch.id}`);
    }
    return { batchId: batch.id, programId: batch.program.id, total: results.length, results };
  }

  private async earnedCreditsInYear(tenantId: string, studentId: string, academicYearId: string): Promise<number> {
    const completed = await (this.tenantPrisma.client as Client).courseRegistration.findMany({
      where: {
        tenantId,
        studentId,
        status: 'COMPLETED',
        courseOffering: { academicYearId },
      },
      select: { courseOffering: { select: { creditHours: true, course: { select: { creditHours: true } } } } },
    });
    return completed.reduce((sum, r) => sum + (r.courseOffering.creditHours ?? r.courseOffering.course.creditHours), 0);
  }

  async listProgressionRecords(tenantId: string, userId: string, query: ListProgressionQueryDto) {
    const scope = await this.scope(tenantId, userId, 'student');
    const where: Prisma.AcademicProgressionRecordWhereInput = {
      tenantId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.status ? { status: query.status as ProgressionStatus } : {}),
      ...(scope ?? {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).academicProgressionRecord.findMany({
        where,
        ...this.page(query),
        orderBy: [{ createdAt: 'desc' }],
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true } },
          program: { select: { id: true, code: true, name: true } },
          academicYear: { select: { id: true, name: true, code: true } },
          batch: { select: { id: true, name: true, code: true } },
        },
      }),
      (this.tenantPrisma.client as Client).academicProgressionRecord.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  /** One-student dashboard: latest progression, open backlog snapshot, earned credits. */
  async studentProgressionSummary(tenantId: string, userId: string, studentId: string) {
    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      select: { id: true, fullName: true, admissionNumber: true, programId: true },
    });
    if (!student) throw new NotFoundException('Student not found.');
    const [records, openBacklogs, earned] = await Promise.all([
      (this.tenantPrisma.client as Client).academicProgressionRecord.findMany({
        where: { tenantId, studentId },
        orderBy: [{ createdAt: 'desc' }],
        take: 5,
      }),
      (this.tenantPrisma.client as Client).courseBacklog.findMany({
        where: { tenantId, studentId, status: 'OPEN' },
        include: { course: { select: { id: true, code: true, name: true, creditHours: true } }, term: { select: { id: true, name: true } } },
      }),
      this.earnedCreditsSnapshot(tenantId, studentId),
    ]);
    return {
      student,
      latest: records[0] ?? null,
      history: records,
      openBacklogCount: openBacklogs.length,
      openBacklogs,
      credits: earned,
    };
  }

  private async earnedCreditsSnapshot(tenantId: string, studentId: string) {
    const completed = await (this.tenantPrisma.client as Client).courseRegistration.findMany({
      where: { tenantId, studentId, status: 'COMPLETED' },
      select: { courseOffering: { select: { creditHours: true, course: { select: { creditHours: true } } } } },
    });
    return completed.reduce((sum, r) => sum + (r.courseOffering.creditHours ?? r.courseOffering.course.creditHours), 0);
  }

  // ── Backlogs ──────────────────────────────────────────────────────────────

  async createBacklog(tenantId: string, userId: string, dto: CreateBacklogDto) {
    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: dto.studentId, tenantId, deletedAt: null },
    });
    if (!student) throw new NotFoundException('Student not found.');
    await this.assertCourse(tenantId, dto.courseId);
    const term = await (this.tenantPrisma.client as Client).term.findFirst({
      where: { id: dto.termId, tenantId, deletedAt: null },
    });
    if (!term) throw new NotFoundException('Term not found.');
    if (dto.registrationId) {
      const registration = await (this.tenantPrisma.client as Client).courseRegistration.findFirst({
        where: { id: dto.registrationId, tenantId, studentId: dto.studentId },
      });
      if (!registration) throw new NotFoundException('Registration not found for this student.');
    }
    const existing = await (this.tenantPrisma.client as Client).courseBacklog.findUnique({
      where: { tenantId_studentId_courseId_termId: { tenantId, studentId: dto.studentId, courseId: dto.courseId, termId: dto.termId } },
    });
    if (existing) throw new ConflictException('A backlog for this course/term already exists.');
    const backlog = await (this.tenantPrisma.client as any).courseBacklog.create({
      data: {
        tenantId,
        studentId: dto.studentId,
        courseId: dto.courseId,
        registrationId: dto.registrationId,
        termId: dto.termId,
        remarks: dto.remarks,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_BACKLOG_CREATED, 'CourseBacklog', backlog.id, {
      after: { studentId: dto.studentId, courseId: dto.courseId, termId: dto.termId },
    });
    return backlog;
  }

  async updateBacklog(tenantId: string, userId: string, backlogId: string, dto: UpdateBacklogDto) {
    const before = await (this.tenantPrisma.client as Client).courseBacklog.findFirst({
      where: { id: backlogId, tenantId },
    });
    if (!before) throw new NotFoundException('Backlog not found.');
    const backlog = await (this.tenantPrisma.client as any).courseBacklog.update({
      where: { id: backlogId },
      data: { ...dto, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_BACKLOG_UPDATED, 'CourseBacklog', backlogId, {
      before: { remarks: before.remarks },
      after: { ...dto },
    });
    return backlog;
  }

  async clearBacklogs(tenantId: string, userId: string, dto: ClearBacklogsDto) {
    const where: Prisma.CourseBacklogWhereInput = { tenantId, status: 'OPEN' };
    if (dto.backlogIds && dto.backlogIds.length > 0) {
      where.id = { in: dto.backlogIds };
    }
    if (dto.studentId) where.studentId = dto.studentId;
    if (dto.courseId) where.courseId = dto.courseId;
    if (dto.termId) where.termId = dto.termId;

    const targeted = dto.backlogIds != null && dto.backlogIds.length > 0;
    const result = await (this.tenantPrisma.client as any).courseBacklog.updateMany({
      where,
      data: {
        status: 'CLEARED',
        clearedAt: new Date(),
        clearedInRegistrationId: dto.clearedInRegistrationId,
        remarks: dto.remarks ?? 'Bulk cleared',
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.COURSE_BACKLOG_CLEARED, 'CourseBacklog', dto.backlogIds?.[0] ?? dto.courseId ?? 'bulk', {
      after: { count: result.count, targeted, filters: { studentId: dto.studentId, courseId: dto.courseId, termId: dto.termId } },
    });
    return { cleared: result.count };
  }

  async listBacklogs(tenantId: string, userId: string, query: ListBacklogsQueryDto) {
    const scope = await this.scope(tenantId, userId, 'student');
    const where: Prisma.CourseBacklogWhereInput = {
      tenantId,
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.courseId ? { courseId: query.courseId } : {}),
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.status ? { status: query.status as BacklogStatus } : {}),
      ...(scope ?? {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).courseBacklog.findMany({
        where,
        ...this.page(query),
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true } },
          course: { select: { id: true, code: true, name: true, creditHours: true } },
          term: { select: { id: true, name: true, code: true } },
        },
      }),
      (this.tenantPrisma.client as Client).courseBacklog.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  // ── Academic calendar ─────────────────────────────────────────────────────

  async createCalendarEvent(tenantId: string, userId: string, dto: CreateCalendarEventDto) {
    const academicYear = await (this.tenantPrisma.client as Client).academicYear.findFirst({
      where: { id: dto.academicYearId, tenantId, deletedAt: null },
    });
    if (!academicYear) throw new NotFoundException('Academic year not found.');
    if (dto.termId) {
      const term = await (this.tenantPrisma.client as Client).term.findFirst({
        where: { id: dto.termId, tenantId, academicYearId: dto.academicYearId, deletedAt: null },
      });
      if (!term) throw new NotFoundException('Term not found for the given academic year.');
    }
    if (new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException('Event end must be after start.');
    }
    const event = await (this.tenantPrisma.client as any).academicCalendarEvent.create({
      data: {
        tenantId,
        academicYearId: dto.academicYearId,
        termId: dto.termId,
        eventType: dto.eventType ?? 'EVENT',
        title: dto.title,
        description: dto.description,
        startAt: new Date(dto.startAt),
        endAt: new Date(dto.endAt),
        appliesTo: dto.appliesTo ?? 'GLOBAL',
        color: dto.color,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ACADEMIC_CALENDAR_EVENT_CREATED, 'AcademicCalendarEvent', event.id, {
      after: { title: dto.title, eventType: event.eventType, startAt: dto.startAt },
    });
    return event;
  }

  async updateCalendarEvent(tenantId: string, userId: string, eventId: string, dto: UpdateCalendarEventDto) {
    const before = await (this.tenantPrisma.client as Client).academicCalendarEvent.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!before) throw new NotFoundException('Calendar event not found.');
    if (dto.startAt && dto.endAt && new Date(dto.endAt) <= new Date(dto.startAt)) {
      throw new BadRequestException('Event end must be after start.');
    }
    const event = await (this.tenantPrisma.client as any).academicCalendarEvent.update({
      where: { id: eventId },
      data: {
        eventType: dto.eventType,
        title: dto.title,
        description: dto.description,
        startAt: dto.startAt ? new Date(dto.startAt) : undefined,
        endAt: dto.endAt ? new Date(dto.endAt) : undefined,
        appliesTo: dto.appliesTo,
        color: dto.color,
        isPublished: dto.isPublished,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ACADEMIC_CALENDAR_EVENT_UPDATED, 'AcademicCalendarEvent', eventId, {
      before: { title: before.title, isPublished: before.isPublished },
      after: { ...dto },
    });
    return event;
  }

  async deleteCalendarEvent(tenantId: string, userId: string, eventId: string) {
    const before = await (this.tenantPrisma.client as Client).academicCalendarEvent.findFirst({
      where: { id: eventId, tenantId },
    });
    if (!before) throw new NotFoundException('Calendar event not found.');
    await (this.tenantPrisma.client as any).academicCalendarEvent.delete({ where: { id: eventId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ACADEMIC_CALENDAR_EVENT_DELETED, 'AcademicCalendarEvent', eventId, {
      before: { title: before.title },
    });
    return { ok: true };
  }

  async publishCalendar(tenantId: string, userId: string, dto: PublishCalendarDto) {
    const where: Prisma.AcademicCalendarEventWhereInput = { tenantId };
    if (dto.academicYearId) where.academicYearId = dto.academicYearId;
    if (dto.termId) where.termId = dto.termId;
    if (dto.eventIds && dto.eventIds.length > 0) where.id = { in: dto.eventIds };
    const result = await (this.tenantPrisma.client as any).academicCalendarEvent.updateMany({
      where,
      data: { isPublished: true, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ACADEMIC_CALENDAR_PUBLISHED, 'AcademicCalendarEvent', dto.academicYearId ?? 'bulk', {
      after: { count: result.count, filters: { academicYearId: dto.academicYearId, termId: dto.termId, eventIds: dto.eventIds } },
    });
    return { published: result.count };
  }

  /** Academic calendar entries are tenant-wide announcements (like Terms/AcademicYears are
   * tenant-global); only the permission guard gates who may see the calendar. */
  async listCalendarEvents(tenantId: string, query: ListCalendarEventQueryDto) {
    const where: Prisma.AcademicCalendarEventWhereInput = {
      tenantId,
      ...(query.academicYearId ? { academicYearId: query.academicYearId } : {}),
      ...(query.termId ? { termId: query.termId } : {}),
      ...(query.eventType ? { eventType: query.eventType } : {}),
      ...(query.publishedOnly ? { isPublished: true } : {}),
    };
    const [items, total] = await Promise.all([
      (this.tenantPrisma.client as Client).academicCalendarEvent.findMany({
        where,
        ...this.page(query),
        orderBy: [{ startAt: 'asc' }],
        include: {
          academicYear: { select: { id: true, name: true, code: true } },
          term: { select: { id: true, name: true, code: true } },
        },
      }),
      (this.tenantPrisma.client as Client).academicCalendarEvent.count({ where }),
    ]);
    return this.paginate(items, total);
  }

  /** Exposed for the scope spec to assert per-anchor behaviour without a DB. */
  get anchors() {
    return { program: 'program', course: 'course', student: 'student', term: 'term' } as const;
  }
}