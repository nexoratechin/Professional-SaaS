/**
 * Placement applications service — resumes (signed-URL upload/download like EmployeeDocument),
 * student applications to positions, drive rounds & per-student results, selections, offers and
 * joining records. Every student-anchored row is filtered by the caller's grants via
 * placementStudentWhere; catalog rows (rounds) are tenant-wide.
 *
 * Lifecycle notifications are sent to the student (sendSystem, when Student.userId is set) on
 * shortlist/reject, round scheduling, offer issue and joining updates — mirroring how the HR /
 * attendance modules notify users.
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
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../rbac/permissions.service';
import { placementStudentWhere } from './placements-scope';
import { placementStudentSelect, recordPlacementAudit, toDate } from './placements-shared';
import * as Dto from './dto/placements.dto';

type Where = Record<string, unknown>;

export interface StudentWithUser {
  id: string;
  userId: string | null;
}

@Injectable()
export class PlacementApplicationService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  private async mapP2002(err: unknown, message: string): Promise<never> {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw err;
  }

  private async notifyStudent(tenantId: string, student: StudentWithUser, subject: string, body: string) {
    if (!student.userId) return Promise.resolve();
    return this.notifications.sendSystem(tenantId, { recipientUserId: student.userId, subject, body });
  }

  // ── Resumes ───────────────────────────────────────────────────────────────

  async listResumes(tenantId: string, user: AuthenticatedUser, query: Dto.QueryResumesDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const where: Where = {};
    if (!query.includeArchived) where.deletedAt = null;
    if (query.studentId) where.studentId = query.studentId;
    if (studentWhere) where.student = studentWhere;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementResume.findMany({
        where,
        orderBy: [{ isPrimary: 'desc' }, { updatedAt: 'desc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 20,
        include: { student: { select: placementStudentSelect } },
      }),
      this.tenantPrisma.client.placementResume.count({ where }),
    ]);
    return { data, total };
  }

  async requestResumeUpload(tenantId: string, user: AuthenticatedUser, dto: Dto.ResumeUploadRequestDto) {
    await this.studentOrThrow(dto.studentId);
    const key = this.storage.buildKey(tenantId, 'placement-resumes', dto.filename);
    const uploadUrl = await this.storage.getUploadUrl(tenantId, key, dto.contentType);

    const resume = await this.tenantPrisma.client.placementResume.create({
      data: {
        tenantId,
        studentId: dto.studentId,
        title: dto.title.trim(),
        fileKey: key,
        contentType: dto.contentType,
        uploadedByUserId: user.id,
        createdBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_RESUME_UPLOAD_REQUESTED,
      'PlacementResume',
      resume.id,
      { title: resume.title, studentId: dto.studentId },
    );
    return { ...resume, uploadUrl, key };
  }

  async confirmResumeUpload(tenantId: string, user: AuthenticatedUser, dto: Dto.ConfirmResumeUploadDto) {
    const resume = await this.resumeOrThrow(dto.id);
    this.storage.assertKeyBelongsToTenant(tenantId, dto.key);

    await this.setPrimaryIfRequested(resume.studentId, dto.id, dto.isPrimary);
    const updated = await this.tenantPrisma.client.placementResume.update({
      where: { id: dto.id },
      data: {
        fileKey: dto.key,
        contentType: dto.contentType ?? resume.contentType,
        sizeBytes: dto.sizeBytes ?? resume.sizeBytes,
        isPrimary: dto.isPrimary ?? resume.isPrimary,
        updatedBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_RESUME_UPLOAD_CONFIRMED,
      'PlacementResume',
      dto.id,
      { key: dto.key, sizeBytes: dto.sizeBytes },
    );
    return updated;
  }

  async getResumeDownloadUrl(tenantId: string, user: AuthenticatedUser, id: string) {
    const resume = await this.resumeOrThrow(id);
    const url = await this.storage.getDownloadUrl(tenantId, resume.fileKey, { contentType: resume.contentType ?? undefined });
    return { url, fileKey: resume.fileKey };
  }

  async updateResume(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateResumeDto) {
    const resume = await this.resumeOrThrow(id);
    if (dto.isPrimary) await this.setPrimaryIfRequested(resume.studentId, id, true);
    const updated = await this.tenantPrisma.client.placementResume.update({
      where: { id },
      data: { ...(dto.title !== undefined ? { title: dto.title.trim() } : {}), isPrimary: dto.isPrimary, updatedBy: user.id },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_RESUME_UPDATED,
      'PlacementResume',
      id,
      dto,
    );
    return updated;
  }

  async deleteResume(tenantId: string, user: AuthenticatedUser, id: string) {
    const resume = await this.resumeOrThrow(id);
    const referenced = await this.tenantPrisma.client.placementApplication.count({ where: { resumeId: id } });
    await this.tenantPrisma.client.placementResume.update({
      where: { id },
      data: { deletedAt: new Date(), isPrimary: false, updatedBy: user.id },
    });
    if (referenced === 0) {
      await this.storage.delete(tenantId, resume.fileKey);
    }
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_RESUME_DELETED,
      'PlacementResume',
      id,
      { title: resume.title },
    );
  }

  private async resumeOrThrow(id: string) {
    const found = await this.tenantPrisma.client.placementResume.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Resume not found.');
    return found;
  }

  /** Undoes the previous primary on the student's resumes when promoting a new one. */
  private async setPrimaryIfRequested(studentId: string, resumeId: string, isPrimary: boolean | undefined) {
    if (!isPrimary) return;
    await this.tenantPrisma.client.placementResume.updateMany({
      where: { studentId, deletedAt: null, NOT: { id: resumeId } },
      data: { isPrimary: false },
    });
  }

  // ── Applications ──────────────────────────────────────────────────────────

  async listApplications(tenantId: string, user: AuthenticatedUser, query: Dto.QueryApplicationsDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const where: Where = {};
    if (query.driveId) where.driveId = query.driveId;
    if (query.positionId) where.positionId = query.positionId;
    if (query.studentId) where.studentId = query.studentId;
    if (query.status) where.status = query.status;
    if (!query.includeAll) where.status = { not: 'WITHDRAWN' };
    if (studentWhere) where.student = studentWhere;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementApplication.findMany({
        where,
        orderBy: { appliedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 25,
        include: {
          drive: { select: { id: true, title: true, code: true, status: true } },
          position: { include: { drive: { select: { company: { select: { name: true } } } } } },
          student: { select: placementStudentSelect },
          resume: { select: { id: true, title: true, isPrimary: true } },
          selection: { select: { id: true, selectedAt: true } },
          offer: { select: { id: true, offerLetterNumber: true, status: true } },
        },
      }),
      this.tenantPrisma.client.placementApplication.count({ where }),
    ]);
    return { data, total };
  }

  async getApplication(tenantId: string, user: AuthenticatedUser, id: string) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const application = await this.tenantPrisma.client.placementApplication.findFirst({
      where: { id, ...(studentWhere ? { student: studentWhere } : {}) },
      include: {
        drive: { include: { company: { select: { id: true, name: true, code: true } } } },
        position: true,
        student: { select: placementStudentSelect },
        resume: { select: { id: true, title: true, isPrimary: true, fileKey: true } },
        selection: true,
        offer: { include: { joining: true } },
        roundResults: { include: { round: { select: { id: true, sequence: true, roundType: true, title: true } } } },
      },
    });
    if (!application) throw new NotFoundException('Application not found.');
    return application;
  }

  async createApplication(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateApplicationDto) {
    await this.assertApplicationTargets(dto.driveId, dto.positionId, dto.studentId, dto.resumeId);
    const created = await this.tenantPrisma.client.placementApplication
      .create({
        data: {
          tenantId,
          driveId: dto.driveId,
          positionId: dto.positionId,
          studentId: dto.studentId,
          resumeId: dto.resumeId,
          remarks: dto.remarks,
          createdBy: user.id,
        },
      })
      .catch((e) => this.mapP2002(e, 'This student has already applied for this position.'));
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_APPLICATION_CREATED,
      'PlacementApplication',
      created.id,
      { driveId: dto.driveId, positionId: dto.positionId, studentId: dto.studentId },
    );
    return created;
  }

  async bulkCreateApplications(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateApplicationsBulkDto) {
    const position = await this.tenantPrisma.client.placementPosition.findFirst({ where: { id: dto.positionId, driveId: dto.driveId } });
    if (!position) throw new BadRequestException('Position not found for the given drive.');

    const hasCriteria = position.minCgpa !== null || position.minPercentage !== null || position.maxBacklogs !== null;
    let studentIds = dto.studentIds;
    if (hasCriteria) {
      const eligible = await this.tenantPrisma.client.placementEligibility.findMany({
        where: {
          driveId: dto.driveId,
          positionId: dto.positionId,
          studentId: { in: dto.studentIds },
          status: { in: ['ELIGIBLE', 'EXEMPTED'] },
        },
        select: { studentId: true },
      });
      studentIds = eligible.map((e) => e.studentId);
    }

    const rows = studentIds.map((sid) => ({
      tenantId,
      driveId: dto.driveId,
      positionId: dto.positionId,
      studentId: sid,
      resumeId: dto.resumeId,
      createdBy: user.id,
    }));

    let created = 0;
    if (rows.length > 0) {
      const result = await this.tenantPrisma.client.placementApplication.createMany({ data: rows, skipDuplicates: true });
      created = result.count;
    }

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_APPLICATION_BULK_CREATED,
      'PlacementApplication',
      dto.positionId,
      { requested: dto.studentIds.length, created, skipped: dto.studentIds.length - created },
    );
    return { requested: dto.studentIds.length, created, skipped: dto.studentIds.length - created };
  }

  async updateApplicationStatus(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateApplicationStatusDto) {
    const application = await this.applicationOrThrow(id);
    if (application.status === dto.status) return application;

    const now = new Date();
    const data: Prisma.PlacementApplicationUncheckedUpdateInput = {
      status: dto.status as Prisma.PlacementApplicationUncheckedUpdateInput['status'],
      remarks: dto.remarks ?? application.remarks,
      shortlistedAt: dto.status === 'SHORTLISTED' ? now : undefined,
      rejectedAt: dto.status === 'REJECTED' ? now : undefined,
      withdrawnAt: dto.status === 'WITHDRAWN' ? now : undefined,
      updatedBy: user.id,
    };
    const updated = await this.tenantPrisma.client.placementApplication.update({ where: { id }, data });

    let action: string = AUDIT_ACTIONS.PLACEMENT_APPLICATION_UPDATED;
    if (dto.status === 'SHORTLISTED') action = AUDIT_ACTIONS.PLACEMENT_APPLICATION_SHORTLISTED;
    if (dto.status === 'REJECTED') action = AUDIT_ACTIONS.PLACEMENT_APPLICATION_REJECTED;
    if (dto.status === 'WITHDRAWN') action = AUDIT_ACTIONS.PLACEMENT_APPLICATION_WITHDRAWN;
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      action,
      'PlacementApplication',
      id,
      { from: application.status, to: dto.status },
    );

    if (dto.status === 'SHORTLISTED' || dto.status === 'REJECTED') {
      const student = await this.tenantPrisma.client.student.findFirst({
        where: { id: application.studentId },
        select: { id: true, userId: true },
      });
      if (student) {
        await this.notifyStudent(
          tenantId,
          student,
          dto.status === 'SHORTLISTED' ? 'Your application was shortlisted' : 'Your application was not shortlisted',
          dto.status === 'SHORTLISTED'
            ? `You have been shortlisted for a position in a placement drive. Prepare for the next rounds.`
            : `Your application for a placement drive was rejected. Better luck next time.`,
        );
      }
    }
    return updated;
  }

  private async assertApplicationTargets(driveId: string, positionId: string, studentId: string, resumeId?: string) {
    const position = await this.tenantPrisma.client.placementPosition.findFirst({
      where: { id: positionId, driveId },
      include: { drive: { select: { id: true, status: true, applicationDeadline: true, deletedAt: true } } },
    });
    if (!position) throw new BadRequestException('Position not found for the given drive.');
    if (position.drive.deletedAt) throw new BadRequestException('Cannot apply to an archived drive.');
    if (position.drive.status === 'COMPLETED' || position.drive.status === 'CANCELLED') {
      throw new BadRequestException('Applications are closed for this drive.');
    }
    if (position.drive.applicationDeadline && position.drive.applicationDeadline < new Date()) {
      throw new BadRequestException('The application deadline has passed.');
    }

    await this.studentOrThrow(studentId);

    const hasCriteria = position.minCgpa !== null || position.minPercentage !== null || position.maxBacklogs !== null;
    if (hasCriteria) {
      const eligibility = await this.tenantPrisma.client.placementEligibility.findFirst({
        where: { driveId, positionId, studentId },
      });
      if (!eligibility || !['ELIGIBLE', 'EXEMPTED'].includes(eligibility.status)) {
        throw new BadRequestException('The student must be evaluated as eligible before applying.');
      }
    }

    if (resumeId) {
      const resume = await this.tenantPrisma.client.placementResume.findFirst({ where: { id: resumeId, deletedAt: null } });
      if (!resume || resume.studentId !== studentId) {
        throw new BadRequestException('The resume must belong to the student.');
      }
    }
  }

  private async applicationOrThrow(id: string) {
    const found = await this.tenantPrisma.client.placementApplication.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Application not found.');
    return found;
  }

  private async studentOrThrow(id: string) {
    const found = await this.tenantPrisma.client.student.findFirst({ where: { id, deletedAt: null } });
    if (!found) throw new NotFoundException('Student not found.');
    return found;
  }

  // ── Rounds ────────────────────────────────────────────────────────────────

  async listRounds(driveId: string) {
    const drive = await this.tenantPrisma.client.placementDrive.findFirst({ where: { id: driveId } });
    if (!drive) throw new NotFoundException('Drive not found.');
    return this.tenantPrisma.client.placementRound.findMany({
      where: { driveId, deletedAt: null },
      orderBy: { sequence: 'asc' },
      include: { _count: { select: { results: true } } },
    });
  }

  async createRound(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateRoundDto) {
    const drive = await this.tenantPrisma.client.placementDrive.findFirst({ where: { id: dto.driveId, deletedAt: null } });
    if (!drive) throw new BadRequestException('Drive not found.');

    const created = await this.tenantPrisma.client.placementRound
      .create({
        data: {
          tenantId,
          driveId: dto.driveId,
          sequence: dto.sequence,
          roundType: dto.roundType as Prisma.PlacementRoundUncheckedCreateInput['roundType'],
          title: dto.title,
          scheduledAt: toDate(dto.scheduledAt, 'scheduledAt'),
          locationOrLink: dto.locationOrLink,
          status: (dto.status ?? 'SCHEDULED') as Prisma.PlacementRoundUncheckedCreateInput['status'],
          notes: dto.notes,
          createdBy: user.id,
        },
      })
      .catch((e) => this.mapP2002(e, 'A round with this sequence already exists for the drive.'));

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_ROUND_CREATED,
      'PlacementRound',
      created.id,
      { driveId: dto.driveId, sequence: created.sequence, roundType: created.roundType },
    );

    if (created.status === 'SCHEDULED') {
      await this.notifyApplicantsOfRound(tenantId, created.driveId, created.sequence, created.title);
    }
    return created;
  }

  async updateRound(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateRoundDto) {
    const round = await this.roundOrThrow(id);
    const data: Prisma.PlacementRoundUncheckedUpdateInput = {
      sequence: dto.sequence,
      roundType: dto.roundType as Prisma.PlacementRoundUncheckedUpdateInput['roundType'],
      title: dto.title,
      scheduledAt: toDate(dto.scheduledAt, 'scheduledAt'),
      locationOrLink: dto.locationOrLink,
      status: dto.status as Prisma.PlacementRoundUncheckedUpdateInput['status'],
      notes: dto.notes,
      updatedBy: user.id,
    };
    (Object.keys(data) as Array<keyof typeof data>).forEach((key) => {
      if (data[key] === undefined) delete data[key];
    });
    const updated = await this.tenantPrisma.client.placementRound
      .update({ where: { id }, data })
      .catch((e) => this.mapP2002(e, 'A round with this sequence already exists for the drive.'));

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_ROUND_UPDATED,
      'PlacementRound',
      id,
      dto,
    );

    if (dto.status === 'SCHEDULED' && round.status !== 'SCHEDULED') {
      await this.notifyApplicantsOfRound(tenantId, round.driveId, updated.sequence, updated.title);
    }
    return updated;
  }

  async deleteRound(tenantId: string, user: AuthenticatedUser, id: string) {
    await this.roundOrThrow(id);
    const hasResults = await this.tenantPrisma.client.placementRoundResult.count({ where: { roundId: id } });
    if (hasResults > 0) throw new BadRequestException('Round already has recorded results and cannot be deleted.');
    await this.tenantPrisma.client.placementRound.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id } });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_ROUND_DELETED,
      'PlacementRound',
      id,
    );
  }

  private async roundOrThrow(id: string) {
    const found = await this.tenantPrisma.client.placementRound.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Round not found.');
    return found;
  }

  /** Notifies every applicant of the drive's student about a scheduled round. */
  private async notifyApplicantsOfRound(tenantId: string, driveId: string, sequence: number, title: string | null) {
    const applicants = await this.tenantPrisma.client.placementApplication.findMany({
      where: { driveId, status: { in: ['APPLIED', 'SHORTLISTED'] } },
      select: { studentId: true, student: { select: { id: true, userId: true } } },
      distinct: ['studentId'],
    });
    const subject = `New placement round scheduled (round ${sequence})`;
    const body = `Round ${sequence}${title ? ` — ${title}` : ''} has been scheduled for a placement drive you applied to. Check the announcements for details.`;
    await Promise.all(
      applicants
        .map((a) => a.student)
        .filter((s) => s.userId)
        .map((s) => this.notifyStudent(tenantId, s, subject, body)),
    );
  }

  // ── Round results ─────────────────────────────────────────────────────────

  async listRoundResults(tenantId: string, user: AuthenticatedUser, roundId: string, result?: string) {
    const round = await this.roundOrThrow(roundId);
    const where: Where = { roundId: round.id };
    if (result) where.result = result;
    return this.tenantPrisma.client.placementRoundResult.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: {
        application: {
          include: {
            student: { select: { id: true, admissionNumber: true, fullName: true } },
            position: { select: { id: true, title: true } },
          },
        },
      },
    });
  }

  async recordResult(tenantId: string, user: AuthenticatedUser, dto: Dto.RecordRoundResultDto) {
    const round = await this.roundOrThrow(dto.roundId);
    await this.assertResultApplication(round.driveId, dto.applicationId);

    const existing = await this.tenantPrisma.client.placementRoundResult.findFirst({
      where: { roundId: dto.roundId, applicationId: dto.applicationId },
    });

    const data = {
      result: dto.result as Prisma.PlacementRoundResultUncheckedUpdateInput['result'],
      score: dto.score,
      feedback: dto.feedback,
      assessedByUserId: user.id,
      assessedAt: new Date(),
      updatedBy: user.id,
    };

    const saved = existing
      ? await this.tenantPrisma.client.placementRoundResult.update({ where: { id: existing.id }, data })
      : await this.tenantPrisma.client.placementRoundResult.create({
          data: {
            roundId: dto.roundId,
            applicationId: dto.applicationId,
            tenantId,
            result: dto.result as Prisma.PlacementRoundResultUncheckedCreateInput['result'],
            score: dto.score,
            feedback: dto.feedback,
            assessedByUserId: user.id,
            assessedAt: new Date(),
            createdBy: user.id,
          },
        });

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      existing ? AUDIT_ACTIONS.PLACEMENT_ROUND_RESULT_UPDATED : AUDIT_ACTIONS.PLACEMENT_ROUND_RESULT_RECORDED,
      'PlacementRoundResult',
      saved.id,
      { roundId: dto.roundId, applicationId: dto.applicationId, result: dto.result },
    );
    return saved;
  }

  async bulkRecordResults(tenantId: string, user: AuthenticatedUser, dto: Dto.BulkRecordRoundResultsDto) {
    const round = await this.roundOrThrow(dto.roundId);
    const saved: Array<{ applicationId: string; result: string }> = [];
    const skipped: string[] = [];

    for (const entry of dto.results) {
      await this.assertResultApplication(round.driveId, entry.applicationId);
      const existing = await this.tenantPrisma.client.placementRoundResult.findFirst({
        where: { roundId: dto.roundId, applicationId: entry.applicationId },
      });
      const record = existing
        ? await this.tenantPrisma.client.placementRoundResult.update({
            where: { id: existing.id },
            data: {
              result: entry.result as Prisma.PlacementRoundResultUncheckedUpdateInput['result'],
              score: entry.score,
              feedback: entry.feedback,
              assessedByUserId: user.id,
              assessedAt: new Date(),
              updatedBy: user.id,
            },
          })
        : await this.tenantPrisma.client.placementRoundResult.create({
            data: {
              roundId: dto.roundId,
              applicationId: entry.applicationId,
              tenantId,
              result: entry.result as Prisma.PlacementRoundResultUncheckedCreateInput['result'],
              score: entry.score,
              feedback: entry.feedback,
              assessedByUserId: user.id,
              assessedAt: new Date(),
              createdBy: user.id,
            },
          });
      saved.push({ applicationId: record.applicationId, result: record.result as string });
    }

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_ROUND_RESULTS_BULK_RECORDED,
      'PlacementRoundResult',
      dto.roundId,
      { recorded: saved.length },
    );
    return { recorded: saved, skipped };
  }

  private async assertResultApplication(driveId: string, applicationId: string) {
    const application = await this.tenantPrisma.client.placementApplication.findFirst({
      where: { id: applicationId, driveId },
    });
    if (!application) throw new BadRequestException('Application not found for this drive.');
    if (application.status === 'WITHDRAWN') throw new BadRequestException('Withdrawn applications cannot receive round results.');
    return application;
  }

  // ── Selections ────────────────────────────────────────────────────────────

  async listSelections(tenantId: string, user: AuthenticatedUser, query: Dto.QuerySelectionsDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const where: Where = {};
    if (query.driveId) where.driveId = query.driveId;
    if (query.positionId) where.positionId = query.positionId;
    if (query.studentId) where.studentId = query.studentId;
    if (studentWhere) where.student = studentWhere;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementSelection.findMany({
        where,
        orderBy: { selectedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 25,
        include: {
          student: { select: placementStudentSelect },
          position: { select: { id: true, title: true, positionType: true, packageCents: true } },
          drive: { select: { id: true, title: true, code: true } },
          offer: { select: { id: true, offerLetterNumber: true, status: true } },
        },
      }),
      this.tenantPrisma.client.placementSelection.count({ where }),
    ]);
    return { data, total };
  }

  async createSelection(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateSelectionDto) {
    const application = await this.applicationOrThrow(dto.applicationId);
    if (application.status === 'WITHDRAWN') throw new BadRequestException('Cannot select a withdrawn application.');
    const existing = await this.tenantPrisma.client.placementSelection.findFirst({
      where: { applicationId: dto.applicationId },
    });
    if (existing) throw new ConflictException('This application is already selected.');

    const created = await this.tenantPrisma.client.placementSelection.create({
      data: {
        tenantId,
        driveId: application.driveId,
        positionId: application.positionId,
        applicationId: application.id,
        studentId: application.studentId,
        selectedByUserId: user.id,
        notes: dto.notes,
        createdBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_SELECTION_CREATED,
      'PlacementSelection',
      created.id,
      { applicationId: dto.applicationId, studentId: application.studentId },
    );

    const student = await this.tenantPrisma.client.student.findFirst({
      where: { id: application.studentId },
      select: { id: true, userId: true },
    });
    if (student) {
      await this.notifyStudent(
        tenantId,
        student,
        'You have been selected!',
        'Congratulations! You have been selected for a position in a placement drive. An offer should follow shortly.',
      );
    }
    return created;
  }

  async removeSelection(tenantId: string, user: AuthenticatedUser, id: string) {
    const selection = await this.tenantPrisma.client.placementSelection.findFirst({ where: { id } });
    if (!selection) throw new NotFoundException('Selection not found.');
    const sameSelectionOffer = await this.tenantPrisma.client.placementOffer.count({ where: { selectionId: id } });
    if (sameSelectionOffer > 0) throw new BadRequestException('An offer references this selection; cannot remove it.');
    await this.tenantPrisma.client.placementSelection.delete({ where: { id } });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_SELECTION_REMOVED,
      'PlacementSelection',
      id,
    );
  }

  // ── Offers ────────────────────────────────────────────────────────────────

  async listOffers(tenantId: string, user: AuthenticatedUser, query: Dto.QueryOffersDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const where: Where = {};
    if (!query.includeArchived) where.deletedAt = null;
    if (query.driveId) where.driveId = query.driveId;
    if (query.positionId) where.positionId = query.positionId;
    if (query.studentId) where.studentId = query.studentId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { offerLetterNumber: { contains: query.search, mode: 'insensitive' } },
        { student: { fullName: { contains: query.search, mode: 'insensitive' } } },
      ];
    }
    if (studentWhere) where.student = studentWhere;

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementOffer.findMany({
        where,
        orderBy: { issuedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 25,
        include: {
          student: { select: placementStudentSelect },
          position: { select: { id: true, title: true, positionType: true } },
          drive: { select: { id: true, title: true, code: true, company: { select: { name: true } } } },
          joining: true,
        },
      }),
      this.tenantPrisma.client.placementOffer.count({ where }),
    ]);
    return { data, total };
  }

  async getOffer(id: string) {
    const offer = await this.tenantPrisma.client.placementOffer.findFirst({
      where: { id },
      include: {
        student: { select: placementStudentSelect },
        position: { select: { id: true, title: true, positionType: true, packageCents: true, location: true } },
        drive: { select: { id: true, title: true, code: true, company: { select: { id: true, name: true } } } },
        application: { select: { id: true, appliedAt: true, status: true } },
        selection: { select: { id: true, selectedAt: true, notes: true } },
        joining: true,
      },
    });
    if (!offer) throw new NotFoundException('Offer not found.');
    return offer;
  }

  async createOffer(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateOfferDto) {
    const application = await this.applicationOrThrow(dto.applicationId);
    if (application.status !== 'SHORTLISTED') {
      const hasSelection = dto.selectionId
        ? !!(await this.tenantPrisma.client.placementSelection.findFirst({ where: { id: dto.selectionId, applicationId: dto.applicationId } }))
        : false;
      if (!hasSelection) throw new BadRequestException('Offer can only be issued after the student is shortlisted/selected.');
    }

    const existingOffer = await this.tenantPrisma.client.placementOffer.findFirst({ where: { applicationId: dto.applicationId } });
    if (existingOffer) throw new ConflictException('An offer already exists for this application.');

    const created = await this.tenantPrisma.client.placementOffer
      .create({
        data: {
          tenantId,
          driveId: application.driveId,
          positionId: application.positionId,
          applicationId: application.id,
          selectionId: dto.selectionId,
          studentId: application.studentId,
          offerLetterNumber: dto.offerLetterNumber.trim(),
          packageCents: dto.packageCents,
          joiningLocation: dto.joiningLocation,
          expiryDate: toDate(dto.expiryDate, 'expiryDate'),
          notes: dto.notes,
          createdBy: user.id,
        },
      })
      .catch((e) => this.mapP2002(e, 'An offer with this letter number already exists.'));

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_OFFER_CREATED,
      'PlacementOffer',
      created.id,
      { offerLetterNumber: created.offerLetterNumber, studentId: application.studentId },
    );

    const student = await this.tenantPrisma.client.student.findFirst({
      where: { id: application.studentId },
      select: { id: true, userId: true },
    });
    if (student) {
      await this.notifyStudent(
        tenantId,
        student,
        'You received an offer letter',
        `An offer letter (${created.offerLetterNumber}) has been issued to you. Review and respond before the expiry date.`,
      );
    }
    return created;
  }

  async updateOffer(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateOfferDto) {
    const offer = await this.offerOrThrow(id);
    const data: Prisma.PlacementOfferUncheckedUpdateInput = {
      ...(dto.offerLetterNumber !== undefined ? { offerLetterNumber: dto.offerLetterNumber.trim() } : {}),
      packageCents: dto.packageCents,
      joiningLocation: dto.joiningLocation,
      expiryDate: toDate(dto.expiryDate, 'expiryDate'),
      status: dto.status as Prisma.PlacementOfferUncheckedUpdateInput['status'],
      notes: dto.notes,
      updatedBy: user.id,
    };
    if (dto.status === 'ACCEPTED' && !offer.acceptedAt) data.acceptedAt = new Date();
    if (dto.status === 'DECLINED' && !offer.declinedAt) data.declinedAt = new Date();
    (Object.keys(data) as Array<keyof typeof data>).forEach((key) => {
      if (data[key] === undefined) delete data[key];
    });
    const updated = await this.tenantPrisma.client.placementOffer
      .update({ where: { id }, data })
      .catch((e) => this.mapP2002(e, 'An offer with this letter number already exists.'));

    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      dto.status === 'ACCEPTED' || dto.status === 'DECLINED'
        ? dto.status === 'ACCEPTED'
          ? AUDIT_ACTIONS.PLACEMENT_OFFER_ACCEPTED
          : AUDIT_ACTIONS.PLACEMENT_OFFER_DECLINED
        : AUDIT_ACTIONS.PLACEMENT_OFFER_UPDATED,
      'PlacementOffer',
      id,
      dto,
    );

    if (dto.status === 'ACCEPTED') {
      await this.ensureJoiningForOffer(tenantId, updated);
    }
    return updated;
  }

  async decideOffer(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.OfferDecisionDto) {
    return this.updateOffer(tenantId, user, id, { status: dto.decision, notes: dto.notes });
  }

  private async offerOrThrow(id: string) {
    const found = await this.tenantPrisma.client.placementOffer.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Offer not found.');
    return found;
  }

  private async ensureJoiningForOffer(tenantId: string, offer: { id: string; driveId: string }) {
    const existing = await this.tenantPrisma.client.placementJoining.findFirst({ where: { offerId: offer.id } });
    if (!existing) {
      await this.tenantPrisma.client.placementJoining.create({
        data: { tenantId, driveId: offer.driveId, offerId: offer.id, status: 'PENDING' },
      });
    }
  }

  // ── Joinings ──────────────────────────────────────────────────────────────

  async listJoinings(tenantId: string, user: AuthenticatedUser, query: Dto.QueryJoiningsDto) {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, user.id, K.PLACEMENTS_VIEW);
    const studentWhere = placementStudentWhere(grants, user.id);
    const where: Where = {};
    if (query.driveId) where.driveId = query.driveId;
    if (query.status) where.status = query.status;
    if (studentWhere) where.offer = { student: studentWhere };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementJoining.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 25,
        include: {
          offer: {
            select: {
              id: true,
              offerLetterNumber: true,
              packageCents: true,
              joiningLocation: true,
              position: { select: { id: true, title: true } },
              drive: { select: { id: true, title: true, company: { select: { name: true } } } },
              student: { select: placementStudentSelect },
            },
          },
        },
      }),
      this.tenantPrisma.client.placementJoining.count({ where }),
    ]);
    return { data, total };
  }

  async createJoining(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateJoiningDto) {
    const offer = await this.offerOrThrow(dto.offerId);
    if (offer.status !== 'ACCEPTED') {
      throw new BadRequestException('Joining can only be created for an accepted offer.');
    }
    const existing = await this.tenantPrisma.client.placementJoining.findFirst({ where: { offerId: dto.offerId } });
    if (existing) throw new ConflictException('Joining record already exists for this offer.');

    const created = await this.tenantPrisma.client.placementJoining.create({
      data: {
        tenantId,
        driveId: offer.driveId,
        offerId: dto.offerId,
        expectedJoiningDate: toDate(dto.expectedJoiningDate, 'expectedJoiningDate'),
        actualJoiningDate: toDate(dto.actualJoiningDate, 'actualJoiningDate'),
        joiningLocation: dto.joiningLocation,
        status: dto.status as Prisma.PlacementJoiningUncheckedCreateInput['status'],
        remarks: dto.remarks,
        createdBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_JOINING_CREATED,
      'PlacementJoining',
      created.id,
      { offerId: dto.offerId, status: created.status },
    );
    return created;
  }

  async updateJoining(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateJoiningDto) {
    const joining = await this.tenantPrisma.client.placementJoining.findFirst({ where: { id } });
    if (!joining) throw new NotFoundException('Joining record not found.');

    const actualJoiningDate =
      dto.actualJoiningDate !== undefined
        ? toDate(dto.actualJoiningDate, 'actualJoiningDate')
        : dto.status === 'JOINED'
          ? joining.actualJoiningDate ?? new Date()
          : undefined;

    const updated = await this.tenantPrisma.client.placementJoining.update({
      where: { id },
      data: {
        expectedJoiningDate: toDate(dto.expectedJoiningDate, 'expectedJoiningDate'),
        actualJoiningDate,
        joiningLocation: dto.joiningLocation,
        status: dto.status as Prisma.PlacementJoiningUncheckedUpdateInput['status'],
        remarks: dto.remarks,
        updatedBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_JOINING_UPDATED,
      'PlacementJoining',
      id,
      dto,
    );

    if (dto.status === 'JOINED' || dto.status === 'NOT_JOINED') {
      const offer = await this.tenantPrisma.client.placementOffer.findFirst({
        where: { id: joining.offerId },
        select: { studentId: true },
      });
      if (offer) {
        const student = await this.tenantPrisma.client.student.findFirst({
          where: { id: offer.studentId },
          select: { id: true, userId: true },
        });
        if (student) {
          await this.notifyStudent(
            tenantId,
            student,
            dto.status === 'JOINED' ? 'Welcome to your new workplace' : 'Joining not completed',
            dto.status === 'JOINED'
              ? 'Your joining has been marked complete. Congratulations on starting your career!'
              : 'Please contact the placement cell regarding your pending joining.',
          );
        }
      }
    }
    return updated;
  }
}