/**
 * Placement drives & positions service — drive lifecycle (create, update, publish/status,
 * archive), the position catalog each drive hires for, and the eligibility evaluation engine
 * that scores the tenant's students against a position's criteria (minCgpa / minPercentage /
 * maxBacklogs) using their StudentAcademicRecord (highest qualification) and open
 * CourseBacklog counts. Eligibility rows freeze the criteria + student snapshots at evaluation
 * time so results stay auditable.
 *
 * Scope: catalog rows (drives/positions) are tenant-wide once the caller holds the permission;
 * the students a drive/position can be evaluated/applied against are restricted via
 * placementStudentWhere for the caller's grants.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_ACTIONS, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../rbac/permissions.service';
import { placementStudentWhere } from './placements-scope';
import { recordPlacementAudit, toDate } from './placements-shared';
import * as Dto from './dto/placements.dto';

@Injectable()
export class PlacementDriveService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissions: PermissionsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async mapP2002(err: unknown, message: string): Promise<never> {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw err;
  }

  // ── Drives ────────────────────────────────────────────────────────────────

  async listDrives(query: Dto.QueryDrivesDto) {
    const where: Record<string, unknown> = {};
    if (!query.includeArchived) where.deletedAt = null;
    if (query.companyId) where.companyId = query.companyId;
    if (query.status) where.status = query.status;
    if (query.mode) where.mode = query.mode;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { venue: { contains: query.search, mode: 'insensitive' } },
        { company: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementDrive.findMany({
        where,
        orderBy: [{ driveDate: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 20,
        include: {
          company: { select: { id: true, code: true, name: true, companyType: true } },
          positions: {
            where: { deletedAt: null },
            select: { id: true, title: true, positionType: true, packageCents: true, isActive: true },
          },
          _count: { select: { positions: true, applications: true, rounds: true, selections: true, offers: true } },
        },
      }),
      this.tenantPrisma.client.placementDrive.count({ where }),
    ]);
    return { data, total };
  }

  async getDrive(id: string) {
    const drive = await this.tenantPrisma.client.placementDrive.findFirst({
      where: { id },
      include: {
        company: { select: { id: true, code: true, name: true, companyType: true } },
        coordinatorContact: { select: { id: true, fullName: true, designation: true, email: true, phone: true } },
        positions: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: { _count: { select: { applications: true, eligibility: true } } },
        },
        rounds: { where: { deletedAt: null }, orderBy: { sequence: 'asc' }, include: { _count: { select: { results: true } } } },
        _count: { select: { positions: true, applications: true, rounds: true, selections: true, offers: true, joinings: true, eligibility: true } },
      },
    });
    if (!drive) throw new NotFoundException('Drive not found.');
    return drive;
  }

  async createDrive(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateDriveDto) {
    const company = await this.tenantPrisma.client.placementCompany.findFirst({
      where: { id: dto.companyId, deletedAt: null },
    });
    if (!company) throw new BadRequestException('Company not found.');
    if (dto.coordinatorContactId) {
      await this.assertContactBelongsToCompany(dto.coordinatorContactId, dto.companyId);
    }

    const data: Prisma.PlacementDriveUncheckedCreateInput = {
      tenantId,
      companyId: dto.companyId,
      code: dto.code.trim(),
      title: dto.title.trim(),
      description: dto.description,
      mode: (dto.mode ?? 'ON_CAMPUS') as Prisma.PlacementDriveUncheckedCreateInput['mode'],
      status: (dto.status ?? 'DRAFT') as Prisma.PlacementDriveUncheckedCreateInput['status'],
      driveDate: toDate(dto.driveDate, 'driveDate'),
      applicationDeadline: toDate(dto.applicationDeadline, 'applicationDeadline'),
      venue: dto.venue,
      coordinatorContactId: dto.coordinatorContactId,
      eligibilityNotes: dto.eligibilityNotes,
      createdBy: user.id,
    };
    const created = await this.tenantPrisma.client.placementDrive
      .create({ data })
      .catch((e) => this.mapP2002(e, 'A drive with this code already exists.'));
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_DRIVE_CREATED,
      'PlacementDrive',
      created.id,
      { code: created.code, title: created.title, companyId: dto.companyId },
    );
    return created;
  }

  async updateDrive(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateDriveDto) {
    const drive = await this.driveOrThrow(id);
    if (dto.companyId) {
      const company = await this.tenantPrisma.client.placementCompany.findFirst({ where: { id: dto.companyId, deletedAt: null } });
      if (!company) throw new BadRequestException('Company not found.');
    }
    if (dto.coordinatorContactId !== undefined) {
      const companyId = dto.companyId ?? drive.companyId;
      if (dto.coordinatorContactId) await this.assertContactBelongsToCompany(dto.coordinatorContactId, companyId);
    }

    const data: Prisma.PlacementDriveUncheckedUpdateInput = {
      companyId: dto.companyId,
      ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      description: dto.description,
      mode: dto.mode as Prisma.PlacementDriveUncheckedUpdateInput['mode'],
      status: dto.status as Prisma.PlacementDriveUncheckedUpdateInput['status'],
      driveDate: toDate(dto.driveDate, 'driveDate'),
      applicationDeadline: toDate(dto.applicationDeadline, 'applicationDeadline'),
      venue: dto.venue,
      coordinatorContactId: dto.coordinatorContactId,
      eligibilityNotes: dto.eligibilityNotes,
      updatedBy: user.id,
    };
    (Object.keys(data) as Array<keyof typeof data>).forEach((key) => {
      if (data[key] === undefined) delete data[key];
    });
    const updated = await this.tenantPrisma.client.placementDrive
      .update({ where: { id }, data })
      .catch((e) => this.mapP2002(e, 'A drive with this code already exists.'));
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_DRIVE_UPDATED,
      'PlacementDrive',
      id,
      dto,
    );
    return updated;
  }

  /** Drive status change with an optional publish notification sweep to eligible students. */
  async changeDriveStatus(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.ChangeDriveStatusDto) {
    const drive = await this.driveOrThrow(id);
    if (drive.status === dto.status) return drive;

    const fromStatus = drive.status;
    const updated = await this.tenantPrisma.client.placementDrive.update({
      where: { id },
      data: { status: dto.status as Prisma.PlacementDriveUncheckedUpdateInput['status'], updatedBy: user.id },
    });

    const published = fromStatus === 'DRAFT' && dto.status === 'SCHEDULED';
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      published ? AUDIT_ACTIONS.PLACEMENT_DRIVE_PUBLISHED : AUDIT_ACTIONS.PLACEMENT_DRIVE_STATUS_CHANGED,
      'PlacementDrive',
      id,
      { from: fromStatus, to: dto.status, reason: dto.reason },
    );

    if (published) {
      await this.notifyEligibleStudentsOfPublish(tenantId, updated);
    }
    return updated;
  }

  async archiveDrive(tenantId: string, user: AuthenticatedUser, id: string, restore = false) {
    const drive = await this.driveOrThrow(id);
    if (!restore) {
      const applications = await this.tenantPrisma.client.placementApplication.count({ where: { driveId: id } });
      if (applications > 0) throw new BadRequestException('Drive has applications and cannot be archived.');
    }
    const updated = await this.tenantPrisma.client.placementDrive.update({
      where: { id },
      data: { deletedAt: restore ? null : new Date(), updatedBy: user.id },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      restore ? AUDIT_ACTIONS.PLACEMENT_DRIVE_RESTORED : AUDIT_ACTIONS.PLACEMENT_DRIVE_ARCHIVED,
      'PlacementDrive',
      id,
      { title: drive.title },
    );
    return updated;
  }

  private async driveOrThrow(id: string) {
    const found = await this.tenantPrisma.client.placementDrive.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Drive not found.');
    return found;
  }

  private async assertContactBelongsToCompany(contactId: string, companyId: string) {
    const contact = await this.tenantPrisma.client.placementContact.findFirst({
      where: { id: contactId, companyId, deletedAt: null },
    });
    if (!contact) throw new BadRequestException('The coordinator contact must belong to the drive company.');
    return contact;
  }

  private async notifyEligibleStudentsOfPublish(tenantId: string, drive: { id: string; title: string; code: string }) {
    // Publishing a drive is a tenant-wide catalogue event — every student with a linked login is
    // notified, independent of who is publishing (the placement permission holder is GLOBAL).
    const students = await this.tenantPrisma.client.student.findMany({
      where: { deletedAt: null, userId: { not: null } },
      select: { id: true, userId: true },
      take: 500,
    });
    const subject = `Placement drive open: ${drive.title}`;
    const body = `Applications for the ${drive.title} drive (${drive.code}) are now open. Check your eligible positions before the deadline.`;
    await Promise.all(
      students
        .filter((s) => s.userId)
        .map((s) => this.notifications.sendSystem(tenantId, { recipientUserId: s.userId as string, subject, body })),
    );
  }

  // ── Positions ─────────────────────────────────────────────────────────────

  async listPositions(query: { driveId?: string; includeArchived?: boolean; skip?: number; take?: number }) {
    const where: Record<string, unknown> = {};
    if (!query.includeArchived) where.deletedAt = null;
    if (query.driveId) where.driveId = query.driveId;
    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementPosition.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          drive: { select: { id: true, title: true, code: true, status: true } },
          _count: { select: { applications: true, eligibility: true } },
        },
      }),
      this.tenantPrisma.client.placementPosition.count({ where }),
    ]);
    return { data, total };
  }

  async getPosition(id: string) {
    const position = await this.tenantPrisma.client.placementPosition.findFirst({
      where: { id },
      include: {
        drive: { include: { company: { select: { id: true, name: true, code: true } } } },
        _count: { select: { applications: true, eligibility: true, selections: true, offers: true, outcomes: true } },
      },
    });
    if (!position) throw new NotFoundException('Position not found.');
    return position;
  }

  async createPosition(tenantId: string, user: AuthenticatedUser, dto: Dto.CreatePositionDto) {
    const drive = await this.driveOrThrow(dto.driveId);
    if (drive.deletedAt) throw new BadRequestException('Cannot add a position to an archived drive.');

    const created = await this.tenantPrisma.client.placementPosition.create({
      data: {
        tenantId,
        driveId: dto.driveId,
        title: dto.title.trim(),
        positionType: (dto.positionType ?? 'FULL_TIME') as Prisma.PlacementPositionUncheckedCreateInput['positionType'],
        location: dto.location,
        openings: dto.openings ?? 1,
        description: dto.description,
        minCgpa: dto.minCgpa,
        minPercentage: dto.minPercentage,
        maxBacklogs: dto.maxBacklogs,
        packageCents: dto.packageCents,
        packageNotes: dto.packageNotes,
        isActive: dto.isActive ?? true,
        createdBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_POSITION_CREATED,
      'PlacementPosition',
      created.id,
      { driveId: dto.driveId, title: created.title, packageCents: created.packageCents },
    );
    return created;
  }

  async updatePosition(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdatePositionDto) {
    await this.positionOrThrow(id);
    const data: Prisma.PlacementPositionUncheckedUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
      positionType: dto.positionType as Prisma.PlacementPositionUncheckedUpdateInput['positionType'],
      location: dto.location,
      openings: dto.openings,
      description: dto.description,
      minCgpa: dto.minCgpa,
      minPercentage: dto.minPercentage,
      maxBacklogs: dto.maxBacklogs,
      packageCents: dto.packageCents,
      packageNotes: dto.packageNotes,
      isActive: dto.isActive,
      updatedBy: user.id,
    };
    (Object.keys(data) as Array<keyof typeof data>).forEach((key) => {
      if (data[key] === undefined) delete data[key];
    });
    const updated = await this.tenantPrisma.client.placementPosition.update({ where: { id }, data });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_POSITION_UPDATED,
      'PlacementPosition',
      id,
      dto,
    );
    return updated;
  }

  async archivePosition(tenantId: string, user: AuthenticatedUser, id: string, restore = false) {
    const position = await this.positionOrThrow(id);
    if (!restore) {
      const applications = await this.tenantPrisma.client.placementApplication.count({ where: { positionId: id } });
      if (applications > 0) throw new BadRequestException('Position has applications and cannot be archived.');
    }
    const updated = await this.tenantPrisma.client.placementPosition.update({
      where: { id },
      data: { deletedAt: restore ? null : new Date(), isActive: restore ? true : false, updatedBy: user.id },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      restore ? AUDIT_ACTIONS.PLACEMENT_POSITION_UPDATED : AUDIT_ACTIONS.PLACEMENT_POSITION_ARCHIVED,
      'PlacementPosition',
      id,
      { title: position.title },
    );
    return updated;
  }

  private async positionOrThrow(id: string) {
    const found = await this.tenantPrisma.client.placementPosition.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Position not found.');
    return found;
  }

  // ── Eligibility ───────────────────────────────────────────────────────────

  async listEligibility(tenantId: string, user: AuthenticatedUser, query: Dto.QueryEligibilityDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);

    const where: Record<string, unknown> = { student: studentWhere };
    if (query.driveId) where.driveId = query.driveId;
    if (query.positionId) where.positionId = query.positionId;
    if (query.status) where.status = query.status;
    if (query.studentId) where.studentId = query.studentId;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementEligibility.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          student: { select: { id: true, admissionNumber: true, fullName: true, programId: true } },
          position: { select: { id: true, title: true } },
        },
      }),
      this.tenantPrisma.client.placementEligibility.count({ where }),
    ]);
    return { data, total };
  }

  /** (Re)evaluates a batch of students against one position's criteria. When studentIds is empty
   * the caller-scoped enrolled students are evaluated. `force` re-evaluates rows that already
   * hold a finalized decision; `exempted` marks every row EXEMPTED in one pass. */
  async evaluateEligibility(tenantId: string, user: AuthenticatedUser, dto: Dto.EvaluateEligibilityDto) {
    const position = await this.tenantPrisma.client.placementPosition.findFirst({
      where: { id: dto.positionId },
      include: { drive: { select: { id: true, title: true, companyId: true } } },
    });
    if (!position) throw new NotFoundException('Position not found.');

    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_UPDATE);
    const studentWhere = placementStudentWhere(grants, user.id);

    const students = await this.tenantPrisma.client.student.findMany({
      where: {
        ...studentWhere,
        deletedAt: null,
        ...(dto.studentIds && dto.studentIds.length > 0 ? { id: { in: dto.studentIds } } : {}),
      },
      select: {
        id: true,
        admissionNumber: true,
        fullName: true,
        programId: true,
        academicRecords: {
          where: { isHighestQualification: true },
          orderBy: { yearOfPassing: 'desc' },
          take: 1,
          select: { gpa: true, percentage: true, yearOfPassing: true },
        },
      },
    });

    const backlogCounts = await this.tenantPrisma.client.courseBacklog.groupBy({
      by: ['studentId'],
      where: { studentId: { in: students.map((s) => s.id) }, status: 'OPEN' },
      _count: { _all: true },
    });
    const openBacklogs = new Map(backlogCounts.map((b) => [b.studentId, b._count._all]));

    const eligible: string[] = [];
    const notEligible: string[] = [];
    const exempted: string[] = [];
    const skipped: string[] = [];
    const details: Array<{ studentId: string; fullName: string | null; admissionNumber: string | null; status: string; reason: string | null }> = [];

    for (const student of students) {

      // Existing decision — skip unless forcing or the record is still PENDING.
      const existing = await this.tenantPrisma.client.placementEligibility.findFirst({
        where: { driveId: position.driveId, positionId: position.id, studentId: student.id },
      });
      if (existing && existing.status !== 'PENDING' && !dto.force) {
        skipped.push(student.id);
        details.push({ studentId: student.id, fullName: student.fullName, admissionNumber: student.admissionNumber, status: existing.status, reason: 'Already evaluated' });
        continue;
      }

      if (dto.exempted) {
        const data = {
          status: 'EXEMPTED' as const,
          criteriaSnapshot: { minCgpa: position.minCgpa, minPercentage: position.minPercentage, maxBacklogs: position.maxBacklogs },
          studentSnapshot: null,
          remarks: 'Manually exempted',
          evaluatedByUserId: user.id,
          evaluatedAt: new Date(),
          updatedBy: user.id,
        };
        await this.upsertEligibility(tenantId, position.driveId, position.id, student.id, data);
        exempted.push(student.id);
        details.push({ studentId: student.id, fullName: student.fullName, admissionNumber: student.admissionNumber, status: 'EXEMPTED', reason: null });
        continue;
      }

      const record = student.academicRecords[0];
      const gpa = record?.gpa ?? null;
      const percentage = record?.percentage ?? null;
      const backlogs = openBacklogs.get(student.id) ?? 0;

      const cgpaOk = position.minCgpa === null || position.minCgpa === undefined || (gpa !== null && gpa >= position.minCgpa);
      const percentageOk = position.minPercentage === null || position.minPercentage === undefined || (percentage !== null && percentage >= position.minPercentage);
      const backlogsOk = position.maxBacklogs === null || position.maxBacklogs === undefined || backlogs <= position.maxBacklogs;

      const reason = !cgpaOk
        ? `CGPA ${gpa ?? 'n/a'} below ${position.minCgpa}`
        : !percentageOk
          ? `Percentage ${percentage ?? 'n/a'} below ${position.minPercentage}`
          : !backlogsOk
            ? `${backlogs} backlogs exceed allowed ${position.maxBacklogs}`
            : 'Meets all criteria';

      const status = cgpaOk && percentageOk && backlogsOk ? 'ELIGIBLE' : 'NOT_ELIGIBLE';

      await this.upsertEligibility(tenantId, position.driveId, position.id, student.id, {
        status,
        criteriaSnapshot: { minCgpa: position.minCgpa, minPercentage: position.minPercentage, maxBacklogs: position.maxBacklogs },
        studentSnapshot: { gpa, percentage, backlogs, yearOfPassing: record?.yearOfPassing ?? null },
        remarks: reason,
        evaluatedByUserId: user.id,
        evaluatedAt: new Date(),
        updatedBy: user.id,
      });

      (status === 'ELIGIBLE' ? eligible : notEligible).push(student.id);
      details.push({ studentId: student.id, fullName: student.fullName, admissionNumber: student.admissionNumber, status, reason });
    }

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_ELIGIBILITY_EVALUATED,
      'PlacementEligibility',
      position.id,
      { eligible: eligible.length, notEligible: notEligible.length, exempted: exempted.length, skipped: skipped.length, force: dto.force },
    );

    return { eligible: eligible.length, notEligible: notEligible.length, exempted: exempted.length, skipped: skipped.length, details };
  }

  async overrideEligibility(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.OverrideEligibilityDto) {
    const existing = await this.tenantPrisma.client.placementEligibility.findFirst({ where: { id } });
    if (!existing) throw new NotFoundException('Eligibility record not found.');

    const updated = await this.tenantPrisma.client.placementEligibility.update({
      where: { id },
      data: {
status: dto.status as Prisma.PlacementEligibilityUncheckedUpdateInput['status'],
        remarks: dto.remarks ?? existing.remarks,
        evaluatedByUserId: user.id,
        evaluatedAt: new Date(),
        updatedBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      dto.status === 'EXEMPTED' ? AUDIT_ACTIONS.PLACEMENT_ELIGIBILITY_EXEMPTED : AUDIT_ACTIONS.PLACEMENT_ELIGIBILITY_UPDATED,
      'PlacementEligibility',
      id,
      { status: dto.status, remarks: dto.remarks },
    );
    return updated;
  }

  /** Students eligible for bulk application: caller-scoped, already evaluated ELIGIBLE/EXEMPTED. */
  async listEligibleStudents(tenantId: string, user: AuthenticatedUser, positionId: string) {
    const position = await this.positionOrThrow(positionId);
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const rows = await this.tenantPrisma.client.placementEligibility.findMany({
      where: {
        positionId: position.id,
        status: { in: ['ELIGIBLE', 'EXEMPTED'] },
        ...(studentWhere ? { student: studentWhere } : {}),
      },
      orderBy: { updatedAt: 'desc' },
      include: { student: { select: { id: true, admissionNumber: true, fullName: true, programId: true } } },
      take: 500,
    });
    return rows.map((r) => ({ ...r.student, eligibilityStatus: r.status }));
  }

  private async upsertEligibility(
    tenantId: string,
    driveId: string,
    positionId: string,
    studentId: string,
    payload: {
      status: 'PENDING' | 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'EXEMPTED';
      criteriaSnapshot?: Prisma.InputJsonValue | null;
      studentSnapshot?: Prisma.InputJsonValue | null;
      remarks?: string | null;
      evaluatedByUserId?: string | null;
      evaluatedAt?: Date | null;
      updatedBy?: string | null;
    },
  ) {
    const existing = await this.tenantPrisma.client.placementEligibility.findFirst({
      where: { driveId, positionId, studentId },
    });
    if (existing) {
      return this.tenantPrisma.client.placementEligibility.update({
        where: { id: existing.id },
        data: {
          status: payload.status,
          criteriaSnapshot: payload.criteriaSnapshot ?? Prisma.DbNull,
          studentSnapshot: payload.studentSnapshot ?? Prisma.DbNull,
          remarks: payload.remarks,
          evaluatedByUserId: payload.evaluatedByUserId,
          evaluatedAt: payload.evaluatedAt,
          updatedBy: payload.updatedBy,
        },
      });
    }
    return this.tenantPrisma.client.placementEligibility.create({
      data: {
        driveId,
        positionId,
        studentId,
        tenantId,
        status: payload.status,
        criteriaSnapshot: payload.criteriaSnapshot ?? undefined,
        studentSnapshot: payload.studentSnapshot ?? undefined,
        remarks: payload.remarks,
        evaluatedByUserId: payload.evaluatedByUserId,
        evaluatedAt: payload.evaluatedAt,
        createdBy: payload.updatedBy,
      },
    });
  }
}