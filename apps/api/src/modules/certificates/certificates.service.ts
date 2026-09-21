/**
 * Certificates service — a fully tenant-configurable certificate/transcript issuance engine on
 * top of the student 360 data. Templates drive every printable aspect (branded layout, dynamic
 * fields, numbering chain, QR) and the PDF is rendered deterministically at generation time and
 * snapshotted into `contentJson`, so a printout and its verification page can never drift.
 *
 * Lifecycle of one document: REQUESTED → GENERATED → APPROVED → ISSUED (any of those may be
 * REJECTED; an ISSUED document may be REVOKED and then reissued as a new linked document). Every
 * transition appends a CertificateHistoryRow and a centralized audit entry.
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
  CertificateStatus,
  CertificateType,
  type Student,
  type Campus,
  type Program,
  type Batch,
} from '@college-erp/database';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { randomBytes } from 'crypto';
import { AppConfigService } from '../../config/app-config.service';
import { StorageService } from '../../common/storage/storage.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { TenantConfigurationService } from '../tenant-configuration/tenant-configuration.service';
import { certificateScopeFilter } from './certificate-scope';
import {
  certificateTitle,
  resolveCertificateSections,
  type FieldContext,
  type ResultProcessRow,
} from './certificate-fields';
import {
  formatCertificateNumber,
  highestSequence,
  resolveCertificatePrefix,
  resolvePadding,
  typeTail,
  type CertificateNumbering,
} from './certificate-numbering';
import { buildCertificatePdf, type CertificateBranding } from './certificate-pdf';
import type {
  CreateCertificateTemplateDto,
  GenerateCertificateDto,
  ListCertificatesQueryDto,
  ListTemplatesQueryDto,
  ReissueCertificateDto,
  RejectCertificateDto,
  RequestCertificateDto,
  RevokeCertificateDto,
  UpdateCertificateTemplateDto,
} from './dto/certificates.dto';

type Client = PrismaClient;

type StudentWithRelations = Student & {
  program?: Program | null;
  campus?: Campus | null;
  batch?: Batch | null;
};

const GENERATABLE_TYPES = new Set(['TRANSCRIPT', 'GRADE_CARD', 'MARKSHEET']);
const MAX_NUMBER_ATTEMPTS = 25;

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
    private readonly storage: StorageService,
    private readonly permissions: PermissionsService,
    private readonly tenantConfig: TenantConfigurationService,
    private readonly config: AppConfigService,
  ) {}

  private client(): Client {
    return this.tenantPrisma.client as Client;
  }

  private async grants(tenantId: string, userId: string) {
    return this.permissions.getScopeGrantsFor(tenantId, userId, 'certificates.view');
  }

  private async recordHistory(
    params: {
      tenantId: string;
      certificateId: string;
      fromStatus: CertificateStatus;
      toStatus: CertificateStatus;
      actorUserId?: string;
      detail?: Prisma.InputJsonValue;
    },
  ) {
    await this.client().certificateHistoryRow.create({
      data: {
        tenantId: params.tenantId,
        certificateId: params.certificateId,
        fromStatus: params.fromStatus,
        toStatus: params.toStatus,
        actorUserId: params.actorUserId ?? null,
        detailJson: params.detail ?? undefined,
      },
    });
  }

  private async audit(
    tenantId: string,
    actorUserId: string | undefined,
    action: string,
    entityType: string,
    entityId: string,
    payload: { before?: unknown; after?: unknown },
  ) {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: actorUserId ? 'USER' : 'SYSTEM',
      actorUserId,
      action,
      module: AUDIT_MODULES.CERTIFICATES,
      entityType,
      entityId,
      before: payload.before,
      after: payload.after,
    });
  }

  // ── Templates ─────────────────────────────────────────────────────────────

  async listTemplates(tenantId: string, userId: string, query: ListTemplatesQueryDto) {
    void userId;
    const where: Prisma.CertificateTemplateWhereInput = {
      tenantId,
      ...(query.type ? { certificateType: query.type as CertificateType } : {}),
      ...(query.search
        ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { code: { contains: query.search, mode: 'insensitive' } }] }
        : {}),
    };
    const items = await this.client().certificateTemplate.findMany({
      where,
      orderBy: [{ certificateType: 'asc' }, { isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
    return { items, total: items.length };
  }

  async getTemplate(tenantId: string, userId: string, templateId: string) {
    void userId;
    const template = await this.client().certificateTemplate.findFirst({
      where: { id: templateId, tenantId },
      include: { certificates: { select: { id: true, status: true } }, _count: true },
    });
    if (!template) throw new NotFoundException('Certificate template not found.');
    return template;
  }

  async createTemplate(tenantId: string, userId: string, dto: CreateCertificateTemplateDto) {
    const duplicate = await this.client().certificateTemplate.findFirst({
      where: { tenantId, code: dto.code },
    });
    if (duplicate) throw new ConflictException(`A template with the code '${dto.code}' already exists.`);

    const template = await this.client().certificateTemplate.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        certificateType: dto.certificateType as CertificateType,
        fieldConfigJson: (dto.fieldConfig ?? {}) as Prisma.InputJsonValue,
        brandingJson: (dto.branding ?? {}) as Prisma.InputJsonValue,
        numberingJson: (dto.numbering ?? {}) as Prisma.InputJsonValue,
        qrEnabled: dto.qrEnabled ?? true,
        isDefault: dto.isDefault ?? false,
        isActive: dto.isActive ?? true,
        createdBy: userId,
      },
    });

    if (template.isDefault) {
      await this.clearOtherDefaults(tenantId, template.certificateType, template.id);
    }

    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_TEMPLATE_CREATED, 'CertificateTemplate', template.id, {
      after: { code: template.code, certificateType: template.certificateType },
    });
    return template;
  }

  async updateTemplate(tenantId: string, userId: string, templateId: string, dto: UpdateCertificateTemplateDto) {
    const template = await this.getTemplate(tenantId, userId, templateId);
    const updated = await this.client().certificateTemplate.update({
      where: { id: template.id },
      data: {
        name: dto.name,
        fieldConfigJson: dto.fieldConfig !== undefined ? (dto.fieldConfig as Prisma.InputJsonValue) : undefined,
        brandingJson: dto.branding !== undefined ? (dto.branding as Prisma.InputJsonValue) : undefined,
        numberingJson: dto.numbering !== undefined ? (dto.numbering as Prisma.InputJsonValue) : undefined,
        qrEnabled: dto.qrEnabled,
        isDefault: dto.isDefault,
        isActive: dto.isActive,
      },
    });

    if (updated.isDefault) {
      await this.clearOtherDefaults(tenantId, updated.certificateType, updated.id);
    }

    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_TEMPLATE_UPDATED, 'CertificateTemplate', template.id, {
      before: { name: template.name, isActive: template.isActive },
      after: { name: updated.name, isActive: updated.isActive, isDefault: updated.isDefault },
    });
    return updated;
  }

  private async clearOtherDefaults(tenantId: string, certificateType: CertificateType, excludeId: string) {
    await this.client().certificateTemplate.updateMany({
      where: { tenantId, certificateType, isDefault: true, id: { not: excludeId } },
      data: { isDefault: false },
    });
  }

  async archiveTemplate(tenantId: string, userId: string, templateId: string) {
    const template = await this.getTemplate(tenantId, userId, templateId);
    const updated = await this.client().certificateTemplate.update({
      where: { id: template.id },
      data: { isActive: false },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_TEMPLATE_ARCHIVED, 'CertificateTemplate', template.id, {
      after: { isActive: false },
    });
    return updated;
  }

  async deleteTemplate(tenantId: string, userId: string, templateId: string) {
    const template = await this.getTemplate(tenantId, userId, templateId);
    const used = await this.client().studentCertificate.count({ where: { tenantId, templateId: template.id } });
    if (used > 0) {
      throw new BadRequestException('This template is referenced by issued certificates; archive it instead.');
    }
    await this.client().certificateTemplate.delete({ where: { id: template.id } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_TEMPLATE_DELETED, 'CertificateTemplate', template.id, {
      before: { code: template.code },
    });
    return { success: true };
  }

  // ── Student/certificate data helpers ──────────────────────────────────────

  private async assertStudent(tenantId: string, studentId: string): Promise<StudentWithRelations> {
    const student = await this.client().student.findFirst({
      where: { id: studentId, tenantId, deletedAt: null },
      include: {
        program: { select: { id: true, code: true, name: true } },
        campus: { select: { id: true, name: true } },
        batch: { select: { id: true, name: true } },
      },
    });
    if (!student) throw new NotFoundException('Student not found.');
    return student as StudentWithRelations;
  }

  private async findCertificate(tenantId: string, certificateId: string) {
    const certificate = await this.client().studentCertificate.findFirst({
      where: { id: certificateId, tenantId },
      include: {
        template: true,
        reissuedFrom: { select: { id: true, certificateNumber: true, status: true } },
      },
    });
    if (!certificate) throw new NotFoundException('Certificate not found.');
    return certificate;
  }

  /** Latest published-or-locked result process for a student, with its subject results attached. */
  private async latestResultProcess(client: Client, tenantId: string, studentId: string): Promise<ResultProcessRow | null> {
    const process = await client.resultProcess.findFirst({
      where: { tenantId, studentId, state: { in: ['PUBLISHED', 'LOCKED'] } },
      orderBy: { calculatedAt: 'desc' },
      include: {
        session: { select: { id: true, code: true, name: true } },
        calculations: {
          include: { subject: { include: { course: { select: { id: true, code: true, name: true, creditHours: true } } } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!process) return null;
    return {
      sessionName: process.session?.name,
      sessionCode: process.session?.code,
      subjectCount: process.subjectCount,
      passedCount: process.passedCount,
      failedCount: process.failedCount,
      aggregatePercent: process.aggregatePercent,
      gpa: process.gpa,
      cgpa: process.cgpa,
      creditsAttempted: process.creditsAttempted,
      creditsEarned: process.creditsEarned,
      standing: process.standing,
      calculations: (process.calculations ?? []).map((c) => ({
        subjectCode: c.subject?.course?.code,
        subjectName: c.subject?.course?.name,
        creditHours: c.subject?.course?.creditHours,
        maxMarks: c.subject?.maxMarks ?? c.maxMarks,
        effectiveMarks: c.effectiveMarks,
        percentage: c.percentage,
        grade: c.grade,
        gradePoint: c.gradePoint,
        outcome: c.outcome,
      })),
    };
  }

  private async tenantBrandingAndNumbering(tenantId: string) {
    try {
      const { config } = await this.tenantConfig.get(tenantId);
      return { branding: config?.branding ?? null, numbering: config?.numbering ?? null };
    } catch {
      return { branding: null, numbering: null };
    }
  }

  private async resolveTemplate(tenantId: string, type: string, templateId?: string) {
    if (templateId) {
      const template = await this.client().certificateTemplate.findFirst({
        where: { id: templateId, tenantId, isActive: true },
      });
      if (!template) throw new BadRequestException('The chosen template does not exist or is inactive.');
      return template;
    }
    const fallback = await this.client().certificateTemplate.findFirst({
      where: { tenantId, certificateType: type as CertificateType, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'asc' }],
    });
    return fallback ?? null;
  }

  // ── Certificate lifecycle ─────────────────────────────────────────────────

  async request(tenantId: string, userId: string, dto: RequestCertificateDto) {
    const student = await this.assertStudent(tenantId, dto.studentId);
    if (dto.templateId) await this.resolveTemplate(tenantId, dto.certificateType, dto.templateId);

    const certificate = await this.client().studentCertificate.create({
      data: {
        tenantId,
        studentId: student.id,
        certificateType: dto.certificateType as CertificateType,
        title: dto.title ?? certificateTitle(dto.certificateType),
        requestDate: new Date(),
        status: CertificateStatus.REQUESTED,
        templateId: dto.templateId ?? null,
        remarks: dto.remarks,
        createdBy: userId,
      },
    });

    await this.recordHistory({
      tenantId,
      certificateId: certificate.id,
      fromStatus: CertificateStatus.REQUESTED,
      toStatus: CertificateStatus.REQUESTED,
      actorUserId: userId,
      detail: { event: 'REQUESTED' },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_REQUESTED, 'StudentCertificate', certificate.id, {
      after: { studentId: student.id, type: certificate.certificateType },
    });
    return certificate;
  }

  async generate(tenantId: string, userId: string, certificateId: string, dto: GenerateCertificateDto = {}) {
    const certificate = await this.findCertificate(tenantId, certificateId);
    if (certificate.status !== CertificateStatus.REQUESTED) {
      throw new BadRequestException(`Only a REQUESTED certificate can be generated (current status: ${certificate.status}).`);
    }

    const student = await this.assertStudent(tenantId, certificate.studentId);
    const template = await this.resolveTemplate(tenantId, certificate.certificateType, dto.templateId ?? certificate.templateId ?? undefined);

    const { branding: tenantBranding, numbering: tenantNumbering } = await this.tenantBrandingAndNumbering(tenantId);

    const branding = this.mergeBranding(tenantBranding, template?.brandingJson);
    const type = certificate.certificateType;

    let result: ResultProcessRow | null = null;
    if (GENERATABLE_TYPES.has(type)) {
      result = await this.latestResultProcess(this.client(), tenantId, certificate.studentId);
    }

    const context: FieldContext = {
      student: {
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber: student.rollNumber,
        registrationNumber: student.registrationNumber,
        firstName: student.firstName,
        middleName: student.middleName,
        lastName: student.lastName,
        gender: student.gender,
        dateOfBirth: student.dateOfBirth,
        admittedOn: student.admittedOn,
        nationality: student.nationality,
        email: student.email,
        city: student.city,
        state: student.state,
      },
      program: student.program,
      campus: student.campus,
      batch: student.batch,
      certificate: {
        number: null,
        title: certificate.title,
        requestDate: certificate.requestDate.toISOString().slice(0, 10),
        type: type,
        status: certificate.status,
      },
      result,
      branding,
    };

    const sections = resolveCertificateSections(
      (template?.fieldConfigJson as Record<string, string> | null) ?? {},
      type,
      context,
    );

    const qrEnabled = template?.qrEnabled ?? true;
    const qrToken = randomBytes(24).toString('base64url');
    const publicBaseUrl = this.config.get('PUBLIC_BASE_URL').replace(/\/+$/, '');
    const verifyUrl = `${publicBaseUrl}/verify/certificate?token=${qrToken}`;

    const prefix = resolveCertificatePrefix(
      (template?.numberingJson as CertificateNumbering | null) ?? null,
      tenantNumbering as { certificatePrefix?: string } | null,
    );
    const tail = typeTail(type);
    const numbering = template?.numberingJson as CertificateNumbering | null;
    const padding = resolvePadding(numbering);
    const start = typeof numbering?.start === 'number' ? numbering.start : 1;

    const contentJson = {
      template: template ? { id: template.id, code: template.code, name: template.name } : null,
      certificate: {
        id: certificateId,
        number: null,
        title: certificate.title,
        requestDate: certificate.requestDate.toISOString(),
        type,
        status: 'GENERATED',
      },
      issuedTo: student.fullName,
      branding,
      fields: sections.fields,
      table: sections.table ?? null,
      summary: sections.summary ?? null,
      verifyUrl: qrEnabled ? verifyUrl : null,
      qrToken,
    } as unknown as Prisma.InputJsonValue;

    const { certificateNumber, attempted } = await this.allocateNumber(tenantId, certificateId, prefix, tail, start, padding, {
      templateId: template?.id ?? null,
      qrToken,
      contentJson,
      generatedAt: new Date(),
      generatedByUserId: userId,
    });

    // Persist the rendered PDF after the status row is committed so a crash cannot leave a PDF
    // for a certificate that never moved off REQUESTED.
    const storageKey = this.storage.buildKey(tenantId, 'certificates', `${certificateNumber}.pdf`);
    const pdf = buildCertificatePdf({
      title: certificate.title ?? certificateTitle(type),
      certificateNumber,
      issuedTo: student.fullName,
      branding,
      fields: sections.fields,
      table: sections.table,
      summary: sections.summary,
      issuedDate: null,
      verifyUrl: qrEnabled ? verifyUrl : null,
      qrEnabled,
    });
    await this.storage.uploadBuffer(storageKey, pdf, 'application/pdf');
    await this.client().studentCertificate.update({
      where: { id: certificateId },
      data: { storageKey },
    });

    await this.recordHistory({
      tenantId,
      certificateId,
      fromStatus: CertificateStatus.REQUESTED,
      toStatus: CertificateStatus.GENERATED,
      actorUserId: userId,
      detail: { certificateNumber, attempts: attempted },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_GENERATED, 'StudentCertificate', certificateId, {
      after: { certificateNumber, type, template: template?.code ?? null },
    });

    return this.findCertificate(tenantId, certificateId);
  }

  /** Allocate a unique `prefix-tail-seq` number in the tenant, retrying when a concurrent
   * issuance wins the unique constraint first (P2002). The certificate row is flipped to
   * GENERATED inside the retry loop so the resolved number is atomically owned. */
  private async allocateNumber(
    tenantId: string,
    certificateId: string,
    prefix: string,
    tail: string,
    start: number,
    padding: number,
    data: {
      templateId: string | null;
      qrToken: string;
      contentJson: Prisma.InputJsonValue;
      generatedAt: Date;
      generatedByUserId: string;
    },
  ): Promise<{ certificateNumber: string; attempted: number }> {
    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt += 1) {
      const existing = await this.client().studentCertificate.findMany({
        where: { tenantId, certificateNumber: { not: null } },
        select: { certificateNumber: true },
      });
      const sequence =
        highestSequence(
          existing.map((e) => e.certificateNumber as string),
          prefix,
          tail,
          start,
        ) + 1;
      const certificateNumber = formatCertificateNumber(prefix, tail, sequence, padding);

      try {
        await this.client().studentCertificate.update({
          where: { id: certificateId },
          data: {
            status: CertificateStatus.GENERATED,
            certificateNumber,
            templateId: data.templateId,
            qrToken: data.qrToken,
            contentJson: data.contentJson,
            generatedAt: data.generatedAt,
            generatedByUserId: data.generatedByUserId,
          },
        });
        return { certificateNumber, attempted: attempt + 1 };
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }
    throw new ConflictException('Could not allocate a unique certificate number; try again.');
  }

  private mergeBranding(tenantBranding: unknown, templateBranding: unknown): CertificateBranding {
    const tenant = (tenantBranding ?? {}) as Record<string, unknown>;
    const template = (templateBranding ?? {}) as Record<string, unknown>;
    return {
      collegeName: (template.collegeName as string) ?? (tenant.collegeName as string) ?? null,
      tagline: (template.tagline as string) ?? (tenant.tagline as string) ?? null,
      watermark: (template.watermark as string) ?? (tenant.watermark as string) ?? null,
      signedBy: (template.signedBy as string) ?? (tenant.signedBy as string) ?? null,
      headerText: (template.headerText as string) ?? null,
      footerText: (template.footerText as string) ?? null,
      primaryColor: (template.primaryColor as string) ?? (tenant.primaryColor as string) ?? null,
      accentColor: (template.accentColor as string) ?? (tenant.accentColor as string) ?? null,
    };
  }

  async approve(tenantId: string, userId: string, certificateId: string) {
    const certificate = await this.findCertificate(tenantId, certificateId);
    if (certificate.status !== CertificateStatus.GENERATED) {
      throw new BadRequestException(`Only a GENERATED certificate can be approved (current status: ${certificate.status}).`);
    }
    const updated = await this.client().studentCertificate.update({
      where: { id: certificate.id },
      data: { status: CertificateStatus.APPROVED, approvedAt: new Date(), approvedByUserId: userId },
    });
    await this.recordHistory({
      tenantId,
      certificateId: certificate.id,
      fromStatus: CertificateStatus.GENERATED,
      toStatus: CertificateStatus.APPROVED,
      actorUserId: userId,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_APPROVED, 'StudentCertificate', certificate.id, {
      after: { certificateNumber: updated.certificateNumber },
    });
    return updated;
  }

  async issue(tenantId: string, userId: string, certificateId: string) {
    const certificate = await this.findCertificate(tenantId, certificateId);
    if (certificate.status !== CertificateStatus.APPROVED) {
      throw new BadRequestException(`Only an APPROVED certificate can be issued (current status: ${certificate.status}).`);
    }
    const updated = await this.client().studentCertificate.update({
      where: { id: certificate.id },
      data: { status: CertificateStatus.ISSUED, issuedAt: new Date(), issuedByUserId: userId },
    });
    await this.recordHistory({
      tenantId,
      certificateId: certificate.id,
      fromStatus: CertificateStatus.APPROVED,
      toStatus: CertificateStatus.ISSUED,
      actorUserId: userId,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_ISSUED, 'StudentCertificate', certificate.id, {
      after: { certificateNumber: updated.certificateNumber },
    });
    return updated;
  }

  async reject(tenantId: string, userId: string, certificateId: string, dto: RejectCertificateDto) {
    const certificate = await this.findCertificate(tenantId, certificateId);
    if (certificate.status !== CertificateStatus.REQUESTED && certificate.status !== CertificateStatus.GENERATED) {
      throw new BadRequestException(`A ${certificate.status} certificate cannot be rejected.`);
    }
    const from = certificate.status;
    const updated = await this.client().studentCertificate.update({
      where: { id: certificate.id },
      data: { status: CertificateStatus.REJECTED, remarks: dto.reason },
    });
    await this.recordHistory({
      tenantId,
      certificateId: certificate.id,
      fromStatus: from,
      toStatus: CertificateStatus.REJECTED,
      actorUserId: userId,
      detail: { reason: dto.reason },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_REJECTED, 'StudentCertificate', certificate.id, {
      after: { reason: dto.reason },
    });
    return updated;
  }

  async revoke(tenantId: string, userId: string, certificateId: string, dto: RevokeCertificateDto) {
    const certificate = await this.findCertificate(tenantId, certificateId);
    if (certificate.status !== CertificateStatus.ISSUED) {
      throw new BadRequestException(`Only an ISSUED certificate can be revoked (current status: ${certificate.status}).`);
    }
    const updated = await this.client().studentCertificate.update({
      where: { id: certificate.id },
      data: {
        status: CertificateStatus.REVOKED,
        revokedAt: new Date(),
        revokedByUserId: userId,
        revokeReason: dto.reason,
      },
    });
    await this.recordHistory({
      tenantId,
      certificateId: certificate.id,
      fromStatus: CertificateStatus.ISSUED,
      toStatus: CertificateStatus.REVOKED,
      actorUserId: userId,
      detail: { reason: dto.reason },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_REVOKED, 'StudentCertificate', certificate.id, {
      after: { reason: dto.reason },
    });
    return updated;
  }

  async reissue(tenantId: string, userId: string, certificateId: string, dto: ReissueCertificateDto = {}) {
    const original = await this.findCertificate(tenantId, certificateId);
    if (original.status !== CertificateStatus.REVOKED) {
      throw new BadRequestException('Only a REVOKED certificate can be reissued.');
    }

    const templateId = dto.templateId ?? original.templateId ?? undefined;
    const template = await this.resolveTemplate(tenantId, original.certificateType, templateId);

    const student = await this.assertStudent(tenantId, original.studentId);
    const { branding: tenantBranding, numbering: tenantNumbering } = await this.tenantBrandingAndNumbering(tenantId);
    const branding = this.mergeBranding(tenantBranding, template?.brandingJson);
    const type = original.certificateType;

    let result: ResultProcessRow | null = null;
    if (GENERATABLE_TYPES.has(type)) {
      result = await this.latestResultProcess(this.client(), tenantId, original.studentId);
    }

    const qrToken = randomBytes(24).toString('base64url');
    const publicBaseUrl = this.config.get('PUBLIC_BASE_URL').replace(/\/+$/, '');
    const verifyUrl = `${publicBaseUrl}/verify/certificate?token=${qrToken}`;

    const context: FieldContext = {
      student: {
        fullName: student.fullName,
        admissionNumber: student.admissionNumber,
        rollNumber: student.rollNumber,
        registrationNumber: student.registrationNumber,
        firstName: student.firstName,
        middleName: student.middleName,
        lastName: student.lastName,
        gender: student.gender,
        dateOfBirth: student.dateOfBirth,
        admittedOn: student.admittedOn,
        nationality: student.nationality,
        email: student.email,
        city: student.city,
        state: student.state,
      },
      program: student.program,
      campus: student.campus,
      batch: student.batch,
      certificate: {
        number: null,
        title: original.title,
        requestDate: original.requestDate.toISOString().slice(0, 10),
        type,
        status: 'ISSUED',
      },
      result,
      branding,
    };

    const sections = resolveCertificateSections(
      (template?.fieldConfigJson as Record<string, string> | null) ?? {},
      type,
      context,
    );

    const qrEnabled = template?.qrEnabled ?? true;
    const prefix = resolveCertificatePrefix(
      (template?.numberingJson as CertificateNumbering | null) ?? null,
      tenantNumbering as { certificatePrefix?: string } | null,
    );
    const tail = typeTail(type);

    const contentJson: Prisma.InputJsonValue = {
      template: template ? { id: template.id, code: template.code, name: template.name } : null,
      certificate: {
        number: null,
        title: original.title,
        requestDate: original.requestDate.toISOString(),
        type,
        status: 'ISSUED',
        reissuedFromId: original.id,
      },
      issuedTo: student.fullName,
      branding,
      fields: sections.fields,
      table: sections.table ?? null,
      summary: sections.summary ?? null,
      verifyUrl: qrEnabled ? verifyUrl : null,
      qrToken,
    } as unknown as Prisma.InputJsonValue;

    let reissued: Awaited<ReturnType<typeof this.insertReissuedCertificate>> | null = null;
    let attempts = 0;
    for (attempts = 0; attempts < MAX_NUMBER_ATTEMPTS; attempts += 1) {
      const existing = await this.client().studentCertificate.findMany({
        where: { tenantId, certificateNumber: { not: null } },
        select: { certificateNumber: true },
      });
      const sequence = highestSequence(existing.map((e) => e.certificateNumber as string), prefix, tail, 1) + 1;
      const certificateNumber = formatCertificateNumber(prefix, tail, sequence, resolvePadding(template?.numberingJson as CertificateNumbering | null));

      try {
        reissued = await this.insertReissuedCertificate({
          tenantId,
          userId,
          originalId: original.id,
          studentId: student.id,
          certificateType: type,
          title: original.title,
          templateId: template?.id ?? null,
          certificateNumber,
          qrToken,
          contentJson,
        });
        break;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          continue;
        }
        throw error;
      }
    }

    if (attempts >= MAX_NUMBER_ATTEMPTS || !reissued) {
      throw new ConflictException('Could not allocate a unique certificate number; try again.');
    }

    const storageKey = this.storage.buildKey(tenantId, 'certificates', `${reissued.certificateNumber}.pdf`);
    const pdf = buildCertificatePdf({
      title: original.title ?? certificateTitle(type),
      certificateNumber: reissued.certificateNumber as string,
      issuedTo: student.fullName,
      branding,
      fields: sections.fields,
      table: sections.table,
      summary: sections.summary,
      issuedDate: null,
      verifyUrl: qrEnabled ? verifyUrl : null,
      qrEnabled,
    });
    await this.storage.uploadBuffer(storageKey, pdf, 'application/pdf');
    await this.client().studentCertificate.update({
      where: { id: reissued.id },
      data: { storageKey },
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_REISSUED, 'StudentCertificate', reissued.id, {
      after: { reissuedFromId: original.id, certificateNumber: reissued.certificateNumber, attempts },
    });

    return this.findCertificate(tenantId, reissued.id);
  }

  private async insertReissuedCertificate(params: {
    tenantId: string;
    userId: string;
    originalId: string;
    studentId: string;
    certificateType: string;
    title: string | null;
    templateId: string | null;
    certificateNumber: string;
    qrToken: string;
    contentJson: Prisma.InputJsonValue;
  }) {
    const now = new Date();
    const created = await this.client().studentCertificate.create({
      data: {
        tenantId: params.tenantId,
        studentId: params.studentId,
        certificateType: params.certificateType as CertificateType,
        certificateNumber: params.certificateNumber,
        title: params.title,
        requestDate: now,
        status: CertificateStatus.ISSUED,
        templateId: params.templateId,
        qrToken: params.qrToken,
        contentJson: params.contentJson,
        generatedAt: now,
        generatedByUserId: params.userId,
        approvedAt: now,
        approvedByUserId: params.userId,
        issuedAt: now,
        issuedByUserId: params.userId,
        reissuedFromId: params.originalId,
        createdBy: params.userId,
      },
    });

    await this.recordHistory({
      tenantId: params.tenantId,
      certificateId: created.id,
      fromStatus: CertificateStatus.REQUESTED,
      toStatus: CertificateStatus.ISSUED,
      actorUserId: params.userId,
      detail: { event: 'REISSUED', reissuedFromId: params.originalId },
    });

    return created;
  }

  // ── Reads / export / verify ─────────────────────────────────────────────

  async listCertificates(
    tenantId: string,
    userId: string,
    query: ListCertificatesQueryDto,
  ) {
    const scope = certificateScopeFilter(await this.grants(tenantId, userId), userId);
    const where: Prisma.StudentCertificateWhereInput = {
      tenantId,
      ...(scope ?? {}),
      ...(query.status ? { status: query.status as CertificateStatus } : {}),
      ...(query.type ? { certificateType: query.type as CertificateType } : {}),
      ...(query.studentId ? { studentId: query.studentId } : {}),
      ...(query.search
        ? {
            OR: [
              { certificateNumber: { contains: query.search, mode: 'insensitive' } },
              { title: { contains: query.search, mode: 'insensitive' } },
              {
                student: {
                  OR: [
                    { fullName: { contains: query.search, mode: 'insensitive' } },
                    { admissionNumber: { contains: query.search, mode: 'insensitive' } },
                    { rollNumber: { contains: query.search, mode: 'insensitive' } },
                  ],
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.client().studentCertificate.findMany({
        where,
        include: {
          student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
          template: { select: { id: true, code: true, name: true, certificateType: true } },
          history: { orderBy: { createdAt: 'asc' } },
        },
        orderBy: { requestDate: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 100,
      }),
      this.client().studentCertificate.count({ where }),
    ]);
    return { items, total };
  }

  async getCertificate(tenantId: string, userId: string, certificateId: string) {
    void userId;
    const certificate = await this.findCertificate(tenantId, certificateId);
    const history = await this.client().certificateHistoryRow.findMany({
      where: { tenantId, certificateId: certificate.id },
      orderBy: { createdAt: 'asc' },
    });
    return { ...certificate, history };
  }

  async getDownloadUrl(tenantId: string, userId: string, certificateId: string) {
    const certificate = await this.findCertificate(tenantId, certificateId);
    if (!certificate.storageKey) {
      throw new BadRequestException('This certificate has no generated PDF yet.');
    }
    const downloadUrl = await this.storage.getDownloadUrl(tenantId, certificate.storageKey, {
      contentType: 'application/pdf',
      filename: `${certificate.certificateNumber ?? 'certificate'}.pdf`,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_DOWNLOADED, 'StudentCertificate', certificate.id, {
      after: { certificateNumber: certificate.certificateNumber },
    });
    return { certificateId: certificate.id, certificateNumber: certificate.certificateNumber, downloadUrl };
  }

  async exportCertificates(tenantId: string, userId: string, query: ListCertificatesQueryDto) {
    const scope = certificateScopeFilter(await this.grants(tenantId, userId), userId);
    const where: Prisma.StudentCertificateWhereInput = {
      tenantId,
      ...(scope ?? {}),
      ...(query.status ? { status: query.status as CertificateStatus } : {}),
      ...(query.type ? { certificateType: query.type as CertificateType } : {}),
    };
    const items = await this.client().studentCertificate.findMany({
      where,
      include: { student: { select: { fullName: true, admissionNumber: true, rollNumber: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
    });

    const header = ['Certificate No', 'Type', 'Title', 'Status', 'Date', 'Student', 'Admission No', 'Roll No'].join(',');
    const rows = items.map((c) => {
      const date = c.requestDate.toISOString().slice(0, 10);
      return [
        c.certificateNumber ?? '',
        c.certificateType,
        c.title ?? '',
        c.status,
        date,
        c.student.fullName,
        c.student.admissionNumber,
        c.student.rollNumber ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    });
    const csv = [header, ...rows].join('\n');

    await this.audit(tenantId, userId, AUDIT_ACTIONS.CERTIFICATE_EXPORTED, 'StudentCertificate', '-', {
      after: { rows: items.length },
    });
    return { filename: `certificates-${new Date().toISOString().slice(0, 10)}.csv`, csv };
  }

  /** Public verification — intentionally unscoped (a QrToken is itself the credential). */
  async verifyByToken(qrToken: string) {
    const certificate = await this.platformPrisma.client.studentCertificate.findUnique({
      where: { qrToken },
      include: { student: { select: { fullName: true, admissionNumber: true } } },
    });

    if (!certificate) {
      return { valid: false, reason: 'NOT_FOUND', certificate: null };
    }

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: certificate.tenantId,
      actorType: 'SYSTEM',
      action: AUDIT_ACTIONS.CERTIFICATE_VERIFIED,
      module: AUDIT_MODULES.CERTIFICATES,
      entityType: 'StudentCertificate',
      entityId: certificate.id,
      after: { valid: certificate.status === CertificateStatus.ISSUED },
    });

    if (certificate.status === CertificateStatus.REVOKED) {
      return {
        valid: false,
        reason: 'REVOKED',
        certificate: {
          id: certificate.id,
          certificateNumber: certificate.certificateNumber,
          certificateType: certificate.certificateType,
          title: certificate.title,
          studentName: certificate.student.fullName,
          revokedAt: certificate.revokedAt?.toISOString() ?? null,
          revokeReason: certificate.revokeReason,
        },
      };
    }

    if (certificate.status !== CertificateStatus.ISSUED) {
      return {
        valid: false,
        reason: 'NOT_ISSUED',
        certificate: {
          id: certificate.id,
          certificateNumber: certificate.certificateNumber,
          certificateType: certificate.certificateType,
          title: certificate.title,
          studentName: certificate.student.fullName,
          status: certificate.status,
        },
      };
    }

    return {
      valid: true,
      reason: 'VALID',
      certificate: {
        id: certificate.id,
        certificateNumber: certificate.certificateNumber,
        certificateType: certificate.certificateType,
        title: certificate.title,
        studentName: certificate.student.fullName,
        admissionNumber: certificate.student.admissionNumber,
        issuedAt: certificate.issuedAt?.toISOString() ?? null,
        issuedByUserId: certificate.issuedByUserId,
        templateId: certificate.templateId,
        contentJson: certificate.contentJson,
      },
    };
  }
}