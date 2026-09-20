/**
 * Student 360 core service: student profile CRUD, list/search/filter, summary stats, CSV
 * export, admission-number verification, bulk actions, and status-transition journaling.
 * Every read/write is tenant-scoped via TenantScopedPrismaService and row-scoped to the
 * caller's permission grants via studentScopeFilter; durable events land in both the
 * centralized audit trail and the student's activity timeline / status history.
 *
 * Nested sub-resources (guardians, fees, exams, …) are handled by StudentRecordsService.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@college-erp/database';
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { studentScopeFilter } from './student-scope';
import { STUDENT_EVENTS } from './students.constants';
import { rowsToCsv } from '../organization/org-csv';
import {
  type BulkStudentDto,
  type ListStudentQueryDto,
  type StudentStatusValue,
  STUDENT_STATUSES,
} from './dto/students.dto';

type Client = PrismaClient;

/** Statuses counted as "currently active" for the summary endpoint. */
const ACTIVE_STATUSES: StudentStatusValue[] = ['APPLICANT', 'ADMITTED', 'PROVISIONAL', 'ENROLLED', 'ACTIVE'];
const ARCHIVED_EXCLUDED_STATUSES: StudentStatusValue[] = ['WITHDRAWN', 'GRADUATED', 'ALUMNI'];

export const STUDENT_EXPORT_COLUMNS = [
  'id',
  'admissionNumber',
  'rollNumber',
  'fullName',
  'firstName',
  'middleName',
  'lastName',
  'gender',
  'dateOfBirth',
  'email',
  'primaryPhone',
  'status',
  'campus',
  'program',
  'batch',
  'section',
  'academicYear',
  'yearOfAdmission',
  'admittedOn',
] as const;

@Injectable()
export class StudentsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // ── Scope ─────────────────────────────────────────────────────────────────

  /** Prisma `where` on Student rows scoped to the user's grants; undefined = GLOBAL. */
  private async scopeWhere(tenantId: string, userId: string): Promise<Record<string, any> | undefined> {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'students.view');
    if (grants.length === 0) return { id: { in: [] } };
    return studentScopeFilter(grants, userId) as Record<string, any> | undefined;
  }

  /** Resolves a scoped student or throws NotFound — shared guard for detail/write paths. */
  async assertStudentInScope(studentId: string, tenantId: string, userId: string): Promise<any> {
    const scope = await this.scopeWhere(tenantId, userId);
    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: studentId, deletedAt: null, ...(scope ?? {}) },
    });
    if (!student) throw new NotFoundException('Student not found.');
    return student;
  }

  // ── List / search / filter ────────────────────────────────────────────────

  async list(tenantId: string, userId: string, query: ListStudentQueryDto) {
    const scope = await this.scopeWhere(tenantId, userId);
    const where: Record<string, any> = { deletedAt: null };
    if (scope) Object.assign(where, scope);

    const filters = this.buildListFilters(query);
    if (filters) Object.assign(where, filters);

    const orderBy = this.buildListOrderBy(query);

    const studentIds = await (this.tenantPrisma.client as Client).student.findMany({
      where,
      select: { id: true },
      skip: query.skip ?? 0,
      take: query.take ?? 50,
      orderBy,
    }).then((rows) => rows.map((r) => r.id));

    const [rows, total, outstandingMap] = await Promise.all([
      studentIds.length
        ? (this.tenantPrisma.client as Client).student.findMany({
            where: { id: { in: studentIds } },
            orderBy,
            include: {
              campus: true,
              program: true,
              batch: true,
              section: true,
              academicYear: true,
              holds: { where: { status: 'ACTIVE' }, select: { id: true } },
            },
          })
        : Promise.resolve([]),
      (this.tenantPrisma.client as Client).student.count({ where }),
      studentIds.length ? this.outstandingByStudent(studentIds) : Promise.resolve(new Map<string, number>()),
    ]);

    const data = rows.map((row) => {
      const raw = { ...row } as any;
      raw.activeHoldCount = raw.holds?.length ?? 0;
      raw.hasActiveHolds = raw.activeHoldCount > 0;
      raw.outstandingCents = outstandingMap.get(raw.id) ?? 0;
      delete raw.holds;
      return raw;
    });

    return { data, total };
  }

  /** Sum of outstanding (amount − paid − waived) per student, for the fees not yet settled. */
  private async outstandingByStudent(studentIds: string[]): Promise<Map<string, number>> {
    const buckets = await (this.tenantPrisma.client as Client).studentFee.groupBy({
      by: ['studentId'],
      where: { studentId: { in: studentIds }, status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] } },
      _sum: { amountCents: true, paidCents: true, waivedCents: true },
    });
    const map = new Map<string, number>();
    for (const b of buckets) {
      const amount = b._sum.amountCents ?? 0;
      const paid = b._sum.paidCents ?? 0;
      const waived = b._sum.waivedCents ?? 0;
      map.set(b.studentId, Math.max(0, amount - paid - waived));
    }
    return map;
  }

  private buildListFilters(query: ListStudentQueryDto): Record<string, any> | undefined {
    const out: Record<string, any> = {};

    if (query.search) {
      const contains = { contains: query.search, mode: 'insensitive' as const };
      out.OR = [
        { fullName: contains },
        { firstName: contains },
        { lastName: contains },
        { admissionNumber: contains },
        { rollNumber: contains },
        { registrationNumber: contains },
        { email: contains },
        { primaryPhone: contains },
      ];
    }

    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s): s is StudentStatusValue => (STUDENT_STATUSES as readonly string[]).includes(s));
      if (statuses.length > 0) out.status = { in: statuses };
    }
    if (query.campusId) out.campusId = query.campusId;
    if (query.programId) out.programId = query.programId;
    if (query.departmentId) out.program = { departmentId: query.departmentId };
    if (query.sectionId) out.sectionId = query.sectionId;
    if (query.batchId) out.batchId = query.batchId;
    if (query.academicYearId) out.academicYearId = query.academicYearId;
    if (query.yearOfAdmission !== undefined) out.yearOfAdmission = query.yearOfAdmission;

    return Object.keys(out).length ? out : undefined;
  }

  private buildListOrderBy(query: ListStudentQueryDto): Record<string, 'asc' | 'desc'> {
    const direction = query.sortOrder ?? 'desc';
    switch (query.sortBy) {
      case 'fullName':
        return { fullName: direction };
      case 'admissionNumber':
        return { admissionNumber: direction };
      case 'yearOfAdmission':
        return { yearOfAdmission: direction };
      default:
        return { createdAt: direction };
    }
  }

  // ── Summary stats ─────────────────────────────────────────────────────────

  async summary(tenantId: string, userId: string) {
    const scope = await this.scopeWhere(tenantId, userId);
    const base: Record<string, any> = { deletedAt: null };
    if (scope) Object.assign(base, scope);

    const [total, byStatus, byCampus, byProgram, outstanding] = await Promise.all([
      (this.tenantPrisma.client as Client).student.count({ where: base }),
      (this.tenantPrisma.client as Client).student.groupBy({
        by: ['status'],
        where: base,
        _count: { _all: true },
      }),
      (this.tenantPrisma.client as Client).student.groupBy({
        by: ['campusId'],
        where: base,
        _count: { _all: true },
      }),
      (this.tenantPrisma.client as Client).student.groupBy({
        by: ['programId'],
        where: { ...base, programId: { not: null } },
        _count: { _all: true },
      }),
      (this.tenantPrisma.client as Client).studentFee.groupBy({
        by: ['studentId'],
        where: {
          student: { tenantId: tenantId, deletedAt: null },
          status: { in: ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'] },
        },
        _sum: { amountCents: true, paidCents: true, waivedCents: true },
      }),
    ]);

    const activeWhere = { ...base, status: { in: ACTIVE_STATUSES } };
    const freshWhere = { ...base, status: { notIn: ARCHIVED_EXCLUDED_STATUSES } };
    const [active, freshStudents] = await Promise.all([
      (this.tenantPrisma.client as Client).student.count({ where: activeWhere }),
      (this.tenantPrisma.client as Client).student.count({ where: freshWhere }),
    ]);

    const statusCounts = byStatus.reduce(
      (acc, b) => ({ ...acc, [b.status]: b._count._all }),
      {} as Record<string, number>,
    );

    const campusBuckets = await (this.tenantPrisma.client as Client).campus.findMany({
      where: { id: { in: byCampus.map((b) => b.campusId) } },
      select: { id: true, name: true, code: true },
    });
    const campusById = new Map(campusBuckets.map((c) => [c.id, c]));
    const byCampusSummary = byCampus.map((b) => ({
      campusId: b.campusId,
      campus: campusById.get(b.campusId) ?? null,
      count: b._count._all,
    }));

    const programBuckets = await (this.tenantPrisma.client as Client).program.findMany({
      where: { id: { in: byProgram.map((b) => b.programId).filter((x): x is string => x !== null) } },
      select: { id: true, name: true, code: true },
    });
    const programById = new Map(programBuckets.map((p) => [p.id, p]));
    const byProgramSummary = byProgram.map((b) => ({
      programId: b.programId,
      program: b.programId ? (programById.get(b.programId) ?? null) : null,
      count: b._count._all,
    }));

    const outstandingCents = outstanding.reduce(
      (acc, b) => acc + Math.max(0, (b._sum.amountCents ?? 0) - (b._sum.paidCents ?? 0) - (b._sum.waivedCents ?? 0)),
      0,
    );

    return {
      total,
      active,
      freshStudents,
      byStatus: statusCounts,
      byCampus: byCampusSummary,
      byProgram: byProgramSummary,
      outstandingCents,
    };
  }

  // ── Detail ────────────────────────────────────────────────────────────────

  async getDetail(studentId: string, tenantId: string, userId: string) {
    const scope = await this.scopeWhere(tenantId, userId);
    const row = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: studentId, deletedAt: null, ...(scope ?? {}) },
      include: {
        campus: true,
        program: true,
        batch: true,
        section: true,
        academicYear: true,
        guardians: { orderBy: { createdAt: 'asc' } },
        documents: { orderBy: { createdAt: 'desc' } },
        admissions: { orderBy: { appliedAt: 'desc' }, include: { program: true, academicYear: true } },
        academicRecords: { orderBy: { yearOfPassing: 'desc' } },
        enrollments: {
          orderBy: { enrolledAt: 'desc' },
          include: { academicYear: true, term: true, program: true, section: true, batch: true },
        },
        attendance: { orderBy: { date: 'desc' } },
        fees: { orderBy: { createdAt: 'desc' }, include: { term: true, payments: { orderBy: { paymentDate: 'desc' } } } },
        payments: { orderBy: { paymentDate: 'desc' } },
        exams: { orderBy: { startDate: 'desc' }, include: { term: true, program: true, section: true } },
        results: { orderBy: { createdAt: 'desc' }, include: { exam: true } },
        certificates: { orderBy: { requestDate: 'desc' } },
        libraryLoans: { orderBy: { borrowedAt: 'desc' } },
        hostelBookings: { orderBy: { createdAt: 'desc' } },
        transportPasses: { orderBy: { createdAt: 'desc' } },
        holds: { orderBy: { placedOn: 'desc' } },
        statusHistory: { orderBy: { changedAt: 'desc' } },
        communications: { orderBy: { sentAt: 'desc' } },
      },
    });
    if (!row) throw new NotFoundException('Student not found.');

    const raw = { ...row } as any;
    const activeHolds = raw.holds.filter((h: any) => h.status === 'ACTIVE');
    raw.activeHoldCount = activeHolds.length;
    raw.hasActiveHolds = activeHolds.length > 0;
    const outstandingMap = await this.outstandingByStudent([studentId]);
    raw.outstandingCents = outstandingMap.get(studentId) ?? 0;
    raw.fees.forEach((fee: any) => {
      fee.outstandingCents = Math.max(0, fee.amountCents - fee.paidCents - fee.waivedCents);
      if (fee.status !== 'PAID' && fee.status !== 'WAIVED' && fee.status !== 'REFUNDED' && fee.dueDate && fee.dueDate < new Date()) {
        fee.status = 'OVERDUE';
      }
    });
    return raw;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  async create(tenantId: string, userId: string, dto: Record<string, any>) {
    await this.validateParentRefs(dto);

    const admissionNumber = (dto.admissionNumber as string | undefined)?.trim() || (await this.generateAdmissionNumber());
    const fullName = buildFullName(dto.firstName as string, dto.lastName as string, dto.middleName as string | undefined);
    const status: StudentStatusValue = (dto.status as StudentStatusValue) ?? 'APPLICANT';

    const data: Record<string, any> = {
      ...dto,
      admissionNumber,
      fullName,
      status,
      createdBy: userId,
      updatedBy: userId,
    };

    try {
      const student = await (this.tenantPrisma.client as any).student.create({
        data,
      });

      await this.recordStatusTransition(student.id, null, status, null, userId);
      await this.logActivity(student.id, STUDENT_EVENTS.CREATED, 'Student created', userId, undefined, undefined);

      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId: userId,
        action: AUDIT_ACTIONS.STUDENT_CREATED,
        module: 'students',
        entityType: 'Student',
        entityId: student.id,
        after: { admissionNumber, fullName, status },
      });

      return this.getDetail(student.id, tenantId, userId);
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A student with the same admission number already exists.');
      }
      throw err;
    }
  }

  // ── Update ────────────────────────────────────────────────────────────────

  async update(studentId: string, tenantId: string, userId: string, dto: Record<string, any>) {
    const before = await this.assertStudentInScope(studentId, tenantId, userId);
    await this.validateParentRefs(dto);

    const data: Record<string, any> = { ...dto, updatedBy: userId };
    const firstName = (data.firstName as string | undefined) ?? before.firstName;
    const middleName = (data.middleName as string | undefined) ?? before.middleName;
    const lastName = (data.lastName as string | undefined) ?? before.lastName;
    data.fullName = buildFullName(firstName, lastName, middleName);
    if (before.admissionNumber && data.admissionNumber !== undefined && String(data.admissionNumber).trim() !== before.admissionNumber) {
      data.admissionNumber = String(data.admissionNumber).trim();
    }

    try {
      const updated = await (this.tenantPrisma.client as any).student.update({
        where: { id: studentId },
        data,
      });
      await this.logActivity(studentId, STUDENT_EVENTS.UPDATED, 'Student updated', userId, undefined, undefined);
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId: userId,
        action: AUDIT_ACTIONS.STUDENT_UPDATED,
        module: 'students',
        entityType: 'Student',
        entityId: studentId,
        before: { fullName: before.fullName },
        after: { fullName: updated.fullName },
      });
      return this.getDetail(studentId, tenantId, userId);
    } catch (err: any) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A student with the same admission number already exists.');
      }
      throw err;
    }
  }

  // ── Status transition ─────────────────────────────────────────────────────

  async changeStatus(studentId: string, tenantId: string, userId: string, status: StudentStatusValue, reason?: string) {
    const before = await this.assertStudentInScope(studentId, tenantId, userId);
    if (before.status === status) return this.getDetail(studentId, tenantId, userId);

    const updated = await (this.tenantPrisma.client as any).student.update({
      where: { id: studentId },
      data: { status, updatedBy: userId },
    });
    await this.recordStatusTransition(studentId, before.status, status, reason, userId);
    await this.logActivity(studentId, STUDENT_EVENTS.STATUS_CHANGED, `Status -> ${status}`, userId, reason ?? undefined);
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_STATUS_CHANGED,
      module: 'students',
      entityType: 'Student',
      entityId: studentId,
      before: { status: before.status },
      after: { status: updated.status, reason: reason ?? null },
    });
    return this.getDetail(studentId, tenantId, userId);
  }

  // ── Archive / restore ─────────────────────────────────────────────────────

  async archive(studentId: string, tenantId: string, userId: string) {
    const before = await this.assertStudentInScope(studentId, tenantId, userId);
    if (before.deletedAt) return this.getDetail(studentId, tenantId, userId);
    await (this.tenantPrisma.client as any).student.update({
      where: { id: studentId },
      data: { deletedAt: new Date(), updatedBy: userId },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.ARCHIVED, 'Student archived', userId, undefined, undefined);
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_ARCHIVED,
      module: 'students',
      entityType: 'Student',
      entityId: studentId,
      before: { fullName: before.fullName },
    });
    return { id: studentId, archived: true };
  }

  async restore(studentId: string, tenantId: string, userId: string) {
    const scope = await this.scopeWhere(tenantId, userId);
    const existing = await (this.tenantPrisma.client as Client).student.findFirst({
      where: { id: studentId, deletedAt: { not: null }, ...(scope ?? {}) },
    });
    if (!existing) throw new NotFoundException('Archived student not found.');
    await (this.tenantPrisma.client as any).student.update({
      where: { id: studentId },
      data: { deletedAt: null, updatedBy: userId },
    });
    await this.logActivity(studentId, STUDENT_EVENTS.RESTORED, 'Student restored', userId, undefined, undefined);
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.STUDENT_RESTORED,
      module: 'students',
      entityType: 'Student',
      entityId: studentId,
    });
    return this.getDetail(studentId, tenantId, userId);
  }

  // ── Bulk actions ──────────────────────────────────────────────────────────

  async bulk(tenantId: string, userId: string, dto: BulkStudentDto) {
    const processed: string[] = [];
    const failed: Array<{ id: string; error: string }> = [];

    for (const id of dto.ids) {
      try {
        if (dto.action === 'archive') {
          await this.archive(id, tenantId, userId);
        } else if (dto.action === 'restore') {
          await this.restore(id, tenantId, userId);
        } else if (dto.action === 'status_change' && dto.status) {
          await this.changeStatus(id, tenantId, userId, dto.status, dto.reason);
        } else {
          failed.push({ id, error: 'Invalid bulk action for this member.' });
          continue;
        }
        processed.push(id);
      } catch (err: any) {
        failed.push({ id, error: (err as Error).message });
      }
    }

    const action = dto.action === 'archive' ? AUDIT_ACTIONS.STUDENT_ARCHIVED
      : dto.action === 'restore' ? AUDIT_ACTIONS.STUDENT_RESTORED
      : AUDIT_ACTIONS.STUDENT_STATUS_CHANGED;
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action,
      module: 'students',
      entityType: 'Student',
      after: { action: dto.action, status: dto.status ?? null, workerCount: processed.length, failedCount: failed.length },
    });

    return { processed, failed, total: dto.ids.length };
  }

  // ── Admission-number verification ─────────────────────────────────────────

  async verifyAdmissionNumber(tenantId: string, userId: string, admissionNumber: string, excludeId?: string) {
    const scope = await this.scopeWhere(tenantId, userId);
    const student = await (this.tenantPrisma.client as Client).student.findFirst({
      where: {
        admissionNumber: admissionNumber.trim(),
        deletedAt: null,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
        ...(scope ?? {}),
      },
    });
    return { available: !student, student: student ?? null };
  }

  // ── CSV export ────────────────────────────────────────────────────────────

  async exportCsv(tenantId: string, userId: string, query: ListStudentQueryDto) {
    const { data } = await this.list(tenantId, userId, { ...query, skip: 0, take: 10_000 });
    const rows = (data as any[]).map((row) => {
      const out: Record<string, unknown> = {};
      for (const field of STUDENT_EXPORT_COLUMNS) {
        if (field === 'campus') out.campus = row.campus?.name ?? '';
        else if (field === 'program') out.program = row.program?.name ?? '';
        else if (field === 'batch') out.batch = row.batch?.code ?? '';
        else if (field === 'section') out.section = row.section?.code ?? '';
        else if (field === 'academicYear') out.academicYear = row.academicYear?.code ?? '';
        else out[field] = (row[field] ?? '') as unknown;
      }
      return out;
    });
    const csv = rowsToCsv(rows, STUDENT_EXPORT_COLUMNS);
    return { csv, count: data.length, filename: 'students.csv' };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async validateParentRefs(dto: Record<string, any>) {
    const client = this.tenantPrisma.client as Client;
    const refs: Array<{ field: string; entity: string; model: string }> = [
      { field: 'campusId', entity: 'Campus', model: 'campus' },
      { field: 'programId', entity: 'Program', model: 'program' },
      { field: 'batchId', entity: 'Batch', model: 'batch' },
      { field: 'sectionId', entity: 'Section', model: 'section' },
      { field: 'academicYearId', entity: 'Academic Year', model: 'academicYear' },
    ];
    for (const ref of refs) {
      const val = dto[ref.field];
      if (val === null || val === undefined) continue;
      if ((ref.field === 'batchId' || ref.field === 'sectionId') && !dto.programId) continue;
      const found = await (client as any)[ref.model].findFirst({ where: { id: val } });
      if (!found) throw new NotFoundException(`${ref.entity} not found.`);
    }
  }

  private async generateAdmissionNumber(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `STU-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const existing = await (this.tenantPrisma.client as Client).student.findFirst({
        where: { admissionNumber: candidate },
      });
      if (!existing) return candidate;
    }
    throw new ConflictException('Could not generate a unique admission number; please provide one.');
  }

  private async recordStatusTransition(
    studentId: string,
    from: StudentStatusValue | null,
    to: StudentStatusValue,
    reason: string | null | undefined,
    userId: string,
  ) {
    await (this.tenantPrisma.client as any).studentStatusHistory.create({
      data: {
        studentId,
        fromStatus: from as any,
        toStatus: to as any,
        reason: reason ?? null,
        changedByUserId: userId,
      },
    });
  }

  private async logActivity(
    studentId: string,
    eventType: string,
    title: string,
    actorUserId: string,
    description?: string,
    entityType?: string,
    entityId?: string,
  ) {
    await (this.tenantPrisma.client as any).studentActivity.create({
      data: {
        studentId,
        eventType,
        title,
        description: description ?? null,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        actorUserId,
      },
    });
  }
}

function buildFullName(firstName: string, lastName: string, middleName?: string): string {
  return [firstName, middleName, lastName].filter((p) => p && p.trim() !== '').join(' ').trim();
}