import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomBytes } from 'node:crypto';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import {
  createTenantScopedClient,
  type Prisma,
  type AdmissionApplicantAccess,
  type AdmissionApplication,
  type AdmissionOffer,
} from '@college-erp/database';
import { QUEUE_NAMES, type DocumentVirusScanJobData } from '@college-erp/types';
import { AppConfigService } from '../../../config/app-config.service';
import { PlatformPrismaService } from '../../../common/prisma/platform-prisma.service';
import { StorageService } from '../../../common/storage/storage.service';
import { TenantConnectionService } from '../../../common/tenant/tenant-connection.service';
import { TenantLookupService } from '../../../common/tenant/tenant-lookup.service';
import { AuditService } from '../../audit/audit.service';
import { ADMISSION_FORM_FIELDS, DEFAULT_DOCUMENT_CHECKLIST, ADMISSION_NUMBER_PREFIX } from '../admissions.constants';
import { ApplicantAccessService } from './applicant-access.service';
import { AdmissionPortalNotificationsService } from './admission-portal-notifications.service';
import { publicPortalConfig, resolvePortalConfig, type AdmissionPortalConfig } from './admission-portal.config';
import type {
  CreatePortalApplicationDto,
  PortalQualificationDto,
  PortalSubmitDto,
  PortalUploadUrlDto,
  UpdatePortalApplicationDto,
} from './dto/public-admissions.dto';

interface ResolvedPortalTenant {
  tenantId: string;
  slug: string;
  name: string;
}

interface PortalSessionRow {
  id: string;
  publicSlug: string | null;
  name: string;
  status: string;
  startAt: Date;
  endAt: Date;
  portalEnabled: boolean;
  portalOpenAt: Date | null;
  portalCloseAt: Date | null;
  portalInstructions: unknown;
  applicationFeeCents: number;
  admissionFeeCents: number;
  academicYearId: string;
  requiredDocuments: unknown;
  academicYear: { name: string } | null;
  programs: Array<{
    id: string;
    seats: number;
    filledSeats: number;
    applicationFeeCents: number;
    admissionFeeCents: number;
    tuitionFeeCents: number;
    status: string;
    requiredDocuments: unknown;
    program: { name: string; code: string; degreeLevel: string | null; durationYears: number | null } | null;
  }>;
}

const MAX_DOCUMENTS_PER_APPLICATION = 20;
const SESSION_INCLUDE = {
  academicYear: { select: { name: true } },
  programs: {
    where: { status: { in: ['OPEN', 'FULL'] } },
    include: {
      program: { select: { name: true, code: true, degreeLevel: true, durationYears: true } },
    },
  },
} satisfies Prisma.AdmissionSessionInclude;

/**
 * Everything the public can do to an admission application, scoped by tenant slug and by an
 * applicant access row. No method here trusts a client-supplied tenant, application owner or
 * status: the tenant comes from the slug, the application from the token's access row, and every
 * transition re-checks the stored status.
 *
 * The service uses `createTenantScopedClient` rather than TenantScopedPrismaService because public
 * routes deliberately bypass TenantResolutionMiddleware (there is no request tenant context to
 * inherit) — the slug is the only tenant input.
 */
@Injectable()
export class PublicAdmissionsService {
  constructor(
    private readonly tenantLookup: TenantLookupService,
    private readonly tenantConnection: TenantConnectionService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly storage: StorageService,
    private readonly access: ApplicantAccessService,
    private readonly notifications: AdmissionPortalNotificationsService,
    private readonly auditService: AuditService,
    private readonly appConfig: AppConfigService,
    @InjectQueue(QUEUE_NAMES.DOCUMENT_VIRUS_SCAN)
    private readonly scanQueue: Queue<DocumentVirusScanJobData>,
  ) {}

  // ── Tenant + configuration ──────────────────────────────────────────────────────────────────

  /**
   * Resolves the slug exactly like TenantResolutionMiddleware does, but returns a uniform 404 for
   * unknown / suspended / unavailable tenants so the public surface cannot be used to enumerate
   * college slugs or their lifecycle state.
   */
  async resolveTenant(slug: string): Promise<ResolvedPortalTenant> {
    const tenant = await this.tenantLookup.findBySlug(slug);
    if (!tenant || tenant.status === 'SUSPENDED' || tenant.status === 'CANCELED') {
      throw new NotFoundException('This admissions portal is not available.');
    }
    if (tenant.dataIsolationMode && tenant.dataIsolationMode !== 'SHARED') {
      const ready = await this.tenantConnection.ensureRegistered(tenant.id);
      if (!ready) throw new NotFoundException('This admissions portal is not available.');
    }

    const row = await this.platformPrisma.client.tenant.findUnique({
      where: { id: tenant.id },
      select: { name: true },
    });
    if (!row) throw new NotFoundException('This admissions portal is not available.');

    return { tenantId: tenant.id, slug: tenant.slug, name: row.name };
  }

  private async configFor(tenantId: string, session?: { portalInstructions: unknown } | null): Promise<AdmissionPortalConfig> {
    const row = await this.platformPrisma.client.tenantConfiguration.findUnique({ where: { tenantId } });
    const section = (row?.data as Record<string, unknown> | null)?.admissionsPortal ?? null;
    const instructions =
      session?.portalInstructions && typeof session.portalInstructions === 'object'
        ? (session.portalInstructions as Record<string, unknown>)
        : null;
    return resolvePortalConfig(section as never, instructions);
  }

  // ── Catalogue + form ────────────────────────────────────────────────────────────────────────

  async listSessions(slug: string) {
    const tenant = await this.resolveTenant(slug);
    const config = await this.configFor(tenant.tenantId);
    if (!config.enabled) throw new NotFoundException('This admissions portal is not available.');

    const client = createTenantScopedClient(tenant.tenantId);
    const sessions = (await client.admissionSession.findMany({
      where: { portalEnabled: true, publicSlug: { not: null }, status: 'OPEN' },
      include: SESSION_INCLUDE,
      orderBy: { startAt: 'desc' },
    })) as unknown as PortalSessionRow[];

    const now = new Date();
    const open = sessions.filter((session) => this.isOpen(session, now));

    return {
      college: { slug: tenant.slug, name: tenant.name },
      sessions: open.map((session) => {
        const sessionConfig = resolvePortalConfig(null, session.portalInstructions as Record<string, unknown> | null);
        return {
          publicSlug: session.publicSlug,
          name: session.name,
          academicYear: session.academicYear?.name ?? null,
          opensAt: (session.portalOpenAt ?? session.startAt).toISOString(),
          closesAt: (session.portalCloseAt ?? session.endAt).toISOString(),
          applicationFeeCents: session.applicationFeeCents,
          admissionFeeCents: session.admissionFeeCents,
          instructions: session.portalInstructions ?? null,
          supportEmail: sessionConfig.supportEmail,
          supportPhone: sessionConfig.supportPhone,
          programs: session.programs.map((offer) => ({
            offerId: offer.id,
            name: offer.program?.name ?? 'Programme',
            code: offer.program?.code ?? null,
            degreeLevel: offer.program?.degreeLevel ?? null,
            durationYears: offer.program?.durationYears ?? null,
            seats: offer.seats,
            seatsAvailable: offer.seats > 0 ? Math.max(0, offer.seats - offer.filledSeats) : null,
            full: offer.seats > 0 && offer.filledSeats >= offer.seats,
            applicationFeeCents: offer.applicationFeeCents,
            admissionFeeCents: offer.admissionFeeCents,
            tuitionFeeCents: offer.tuitionFeeCents,
          })),
        };
      }),
    };
  }

  async getForm(slug: string, publicSlug: string, programOfferId?: string) {
    const tenant = await this.resolveTenant(slug);
    const client = createTenantScopedClient(tenant.tenantId);
    const session = await this.findSession(client, publicSlug);
    const config = await this.configFor(tenant.tenantId, session);

    this.assertOpen(session, config, tenant.slug);

    const offer = programOfferId
      ? ((session.programs as PortalSessionRow['programs']).find((entry) => entry.id === programOfferId) ?? null)
      : null;
    if (programOfferId && !offer) {
      throw new NotFoundException('That programme is not offered in this admission session.');
    }

    const configured = await client.admissionFormField.findMany({
      where: { sessionId: session.id, isActive: true },
      orderBy: { sequenceOrder: 'asc' },
    });
    const fields =
      configured.length > 0
        ? configured.map((field) => ({
            key: field.code,
            label: field.label,
            type: this.mapFieldType(field.fieldType),
            required: field.required,
            options: (field.options as string[] | null) ?? undefined,
            helpText: field.helpText,
            placeholder: field.placeholder,
          }))
        : ADMISSION_FORM_FIELDS;

    return {
      session: {
        publicSlug: session.publicSlug,
        name: session.name,
        academicYear: session.academicYear?.name ?? null,
        opensAt: (session.portalOpenAt ?? session.startAt).toISOString(),
        closesAt: (session.portalCloseAt ?? session.endAt).toISOString(),
      },
      program: offer
        ? {
            offerId: offer.id,
            name: offer.program?.name ?? 'Programme',
            applicationFeeCents: offer.applicationFeeCents,
            admissionFeeCents: offer.admissionFeeCents,
          }
        : null,
      fields,
      documentChecklist: this.checklistFor(session, offer),
      fees: {
        applicationFeeCents: offer?.applicationFeeCents ?? session.applicationFeeCents,
        admissionFeeCents: offer?.admissionFeeCents ?? session.admissionFeeCents,
        onlinePaymentAvailable: false,
      },
      ...publicPortalConfig(config),
    };
  }

  // ── OTP / resume ────────────────────────────────────────────────────────────────────────────

  async requestOtp(
    slug: string,
    dto: { channel: 'EMAIL' | 'PHONE'; contact: string },
    meta: { ip: string | null; userAgent: string | null },
  ) {
    const tenant = await this.resolveTenant(slug);
    const config = await this.configFor(tenant.tenantId);
    if (!config.enabled) throw new NotFoundException('This admissions portal is not available.');

    return this.access.requestOtp({
      tenantId: tenant.tenantId,
      tenantName: tenant.name,
      config,
      channel: dto.channel,
      contact: dto.contact,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async verifyOtp(
    slug: string,
    dto: { channel: 'EMAIL' | 'PHONE'; contact: string; code: string },
    meta: { ip: string | null; userAgent: string | null },
  ) {
    const tenant = await this.resolveTenant(slug);
    const config = await this.configFor(tenant.tenantId);
    if (!config.enabled) throw new NotFoundException('This admissions portal is not available.');

    return this.access.verifyOtp({
      tenantId: tenant.tenantId,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      config,
      appBaseUrl: this.appConfig.get('PUBLIC_BASE_URL'),
      channel: dto.channel,
      contact: dto.contact,
      code: dto.code,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async resume(slug: string, resumeToken: string) {
    const tenant = await this.resolveTenant(slug);
    const config = await this.configFor(tenant.tenantId);
    return this.access.resume({ tenantId: tenant.tenantId, config, resumeToken });
  }

  // ── Draft lifecycle ─────────────────────────────────────────────────────────────────────────

  async createApplication(slug: string, accessId: string, dto: CreatePortalApplicationDto) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const client = createTenantScopedClient(tenant.tenantId);
    const session = await this.findSession(client, dto.publicSlug);
    const config = await this.configFor(tenant.tenantId, session);
    this.assertOpen(session, config, tenant.slug);

    if (access.applicationId) {
      const existing = await client.admissionApplication.findFirst({ where: { id: access.applicationId } });
      if (existing && ['INITIATED', 'SUBMITTED', 'UNDER_VERIFICATION'].includes(existing.status)) {
        throw new ConflictException({
          statusCode: 409,
          code: 'APPLICATION_ALREADY_STARTED',
          message: 'You already have an application in progress for this contact.',
          applicationId: existing.id,
        });
      }
    }

    const offer = (session.programs as PortalSessionRow['programs']).find((entry) => entry.id === dto.programOfferId);
    if (!offer) throw new NotFoundException('That programme is not offered in this admission session.');
    if (offer.status === 'FULL' || (offer.seats > 0 && offer.filledSeats >= offer.seats)) {
      throw new ConflictException('This programme is full. Choose another programme or contact the admissions office.');
    }

    this.assertContactMatches(access, dto.email, dto.phone);

    const campusId = await this.resolveCampusId(tenant.tenantId, session);
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const middleName = dto.middleName?.trim() || null;
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');

    const applicationNumber = await this.generateApplicationNumber(tenant.tenantId);
    const publicReference = await this.generatePublicReference(tenant.tenantId);

    const created = await client.admissionApplication.create({
      data: {
        tenantId: tenant.tenantId,
        applicationNumber,
        publicReference,
        sessionId: session.id,
        admissionProgramId: offer.id,
        campusId,
        academicYearId: session.academicYearId,
        firstName,
        middleName,
        lastName,
        fullName,
        gender: (dto.gender ?? 'NOT_SPECIFIED') as never,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        email: dto.email?.trim().toLowerCase() ?? (access.channel === 'EMAIL' ? access.contact : null),
        phone: dto.phone?.trim() ?? (access.channel === 'PHONE' ? access.contact : null),
        category: dto.category ?? null,
        nationality: dto.nationality ?? 'Indian',
        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        postalCode: dto.postalCode ?? null,
        country: dto.country ?? 'India',
        guardian: (dto.guardian ?? undefined) as never,
        data: (dto.data ?? undefined) as never,
        status: 'INITIATED',
        submittedVia: 'PORTAL',
        createdBy: null,
        updatedBy: null,
      },
    });

    await this.access.bindApplication(tenant.tenantId, access.id, created.id);
    await this.logActivity(tenant.tenantId, created.id, 'APPLICATION_STARTED', 'Application started on the public portal');
    await this.audit(tenant.tenantId, AUDIT_ACTIONS.ADMISSION_APPLICATION_CREATED, created.id, access.id, {
      channel: access.channel,
      reference: publicReference,
      via: 'PORTAL',
    });

    const duplicateOf = await this.findDuplicate(tenant.tenantId, created);
    if (duplicateOf) {
      await client.admissionApplication.update({ where: { id: created.id }, data: { duplicateOfId: duplicateOf } });
      await this.logActivity(tenant.tenantId, created.id, 'DUPLICATE_DETECTED', 'Possible duplicate application');
    }

    return this.viewApplication(tenant.tenantId, created.id, access, config);
  }

  async updateApplication(slug: string, accessId: string, applicationId: string, dto: UpdatePortalApplicationDto) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const app = await this.ownedApplication(tenant.tenantId, access, applicationId);
    const config = await this.configFor(tenant.tenantId);
    this.assertEditable(app);

    const client = createTenantScopedClient(tenant.tenantId);
    const firstName = dto.firstName?.trim() ?? app.firstName;
    const lastName = dto.lastName?.trim() ?? app.lastName;
    const middleName = dto.middleName !== undefined ? dto.middleName.trim() || null : app.middleName;
    const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');

    await client.admissionApplication.update({
      where: { id: app.id },
      data: {
        firstName,
        middleName,
        lastName,
        fullName,
        gender: (dto.gender ?? app.gender) as never,
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : app.dateOfBirth,
        email: dto.email !== undefined ? dto.email?.trim().toLowerCase() || null : app.email,
        phone: dto.phone !== undefined ? dto.phone?.trim() || null : app.phone,
        category: dto.category !== undefined ? dto.category : app.category,
        nationality: dto.nationality !== undefined ? dto.nationality : app.nationality,
        addressLine1: dto.addressLine1 !== undefined ? dto.addressLine1 : app.addressLine1,
        addressLine2: dto.addressLine2 !== undefined ? dto.addressLine2 : app.addressLine2,
        city: dto.city !== undefined ? dto.city : app.city,
        state: dto.state !== undefined ? dto.state : app.state,
        postalCode: dto.postalCode !== undefined ? dto.postalCode : app.postalCode,
        country: dto.country !== undefined ? dto.country : app.country,
        guardian: dto.guardian !== undefined ? (dto.guardian as never) : (app.guardian as never),
        data: dto.data !== undefined ? (dto.data as never) : (app.data as never),
        updatedBy: null,
      },
    });

    await this.logActivity(tenant.tenantId, app.id, 'APPLICATION_UPDATED', 'Applicant updated their application');
    await this.audit(tenant.tenantId, AUDIT_ACTIONS.ADMISSION_PORTAL_APPLICATION_UPDATED, app.id, access.id, {
      fields: Object.keys(dto),
    });

    return this.viewApplication(tenant.tenantId, app.id, access, config);
  }

  async addQualification(slug: string, accessId: string, applicationId: string, dto: PortalQualificationDto) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const app = await this.ownedApplication(tenant.tenantId, access, applicationId);
    this.assertEditable(app);
    const client = createTenantScopedClient(tenant.tenantId);

    const created = await client.admissionQualification.create({
      data: {
        tenantId: tenant.tenantId,
        applicationId: app.id,
        institution: dto.institution.trim(),
        board: dto.board ?? null,
        degree: dto.degree ?? null,
        yearOfPassing: dto.yearOfPassing ?? null,
        percentage: dto.percentage ?? null,
        gpa: dto.gpa ?? null,
        grade: dto.grade ?? null,
        marksObtained: dto.marksObtained ?? null,
        marksOutOf: dto.marksOutOf ?? null,
        rank: dto.rank ?? null,
        isHighestQualification: dto.isHighestQualification ?? false,
        verificationStatus: 'PENDING',
      } as never,
    });

    return { id: created.id };
  }

  async deleteQualification(slug: string, accessId: string, applicationId: string, qualificationId: string) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const app = await this.ownedApplication(tenant.tenantId, access, applicationId);
    this.assertEditable(app);
    const client = createTenantScopedClient(tenant.tenantId);

    const row = await client.admissionQualification.findFirst({
      where: { id: qualificationId, applicationId: app.id },
    });
    if (!row) throw new NotFoundException('Qualification not found.');
    await client.admissionQualification.delete({ where: { id: row.id } });
    return { deleted: true };
  }

  // ── Documents ───────────────────────────────────────────────────────────────────────────────

  async requestDocumentUpload(slug: string, accessId: string, applicationId: string, dto: PortalUploadUrlDto) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const app = await this.ownedApplication(tenant.tenantId, access, applicationId);
    this.assertEditable(app);

    const session = await this.sessionForApplication(tenant.tenantId, app);
    const config = await this.configFor(tenant.tenantId, session);
    const checklist = this.checklistFor(session, null);
    const category = dto.category.trim().toUpperCase();
    if (!checklist.includes(category)) {
      throw new BadRequestException(`"${category}" is not required for this session (${checklist.join(', ')}).`);
    }

    const mimeType = (dto.contentType.split(';')[0] ?? dto.contentType).trim().toLowerCase();
    if (!config.allowedMimeTypes.includes(mimeType)) {
      throw new BadRequestException(`Files of type ${mimeType} are not accepted.`);
    }
    if (dto.sizeBytes > config.maxUploadBytes) {
      throw new BadRequestException(
        `Each file must be ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB or smaller.`,
      );
    }

    const client = createTenantScopedClient(tenant.tenantId);
    const existingCount = await client.admissionDocument.count({ where: { applicationId: app.id } });
    if (existingCount >= MAX_DOCUMENTS_PER_APPLICATION) {
      throw new BadRequestException('Too many documents on this application. Contact the admissions office.');
    }

    const key = this.storage.buildKey(tenant.tenantId, `admissions/${app.id}`, dto.filename);
    const document = await client.admissionDocument.create({
      data: {
        tenantId: tenant.tenantId,
        applicationId: app.id,
        category,
        documentName: dto.filename.trim(),
        storageKey: key,
        originalFilename: dto.filename.trim(),
        mimeType,
        sizeBytes: dto.sizeBytes,
        status: 'PENDING',
        uploadedVia: 'PORTAL',
        scanStatus: 'PENDING',
        uploadedBy: null,
      },
    });

    const url = await this.storage.getUploadUrl(tenant.tenantId, key, mimeType);
    return {
      documentId: document.id,
      uploadUrl: url,
      method: 'PUT' as const,
      headers: { 'Content-Type': mimeType },
      expiresInSeconds: 15 * 60,
    };
  }

  async confirmDocumentUpload(slug: string, accessId: string, applicationId: string, documentId: string) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const app = await this.ownedApplication(tenant.tenantId, access, applicationId);
    this.assertEditable(app);

    const client = createTenantScopedClient(tenant.tenantId);
    const document = await client.admissionDocument.findFirst({ where: { id: documentId, applicationId: app.id } });
    if (!document || !document.storageKey) throw new NotFoundException('Upload not found.');
    this.storage.assertKeyInCategory(tenant.tenantId, document.storageKey, `admissions/${app.id}`);

    const exists = await this.storage.objectExists(tenant.tenantId, document.storageKey);
    if (!exists) {
      throw new BadRequestException('The file was not received. Please upload it again.');
    }

    const metadata = await this.storage.getObjectMetadata(tenant.tenantId, document.storageKey);
    const config = await this.configFor(tenant.tenantId);
    if (metadata.sizeBytes <= 0 || metadata.sizeBytes > config.maxUploadBytes) {
      await this.storage.delete(tenant.tenantId, document.storageKey).catch(() => undefined);
      await client.admissionDocument.delete({ where: { id: document.id } });
      throw new BadRequestException(
        `Each file must be between 1 byte and ${Math.round(config.maxUploadBytes / (1024 * 1024))} MB.`,
      );
    }

    const updated = await client.admissionDocument.update({
      where: { id: document.id },
      data: {
        sizeBytes: metadata.sizeBytes,
        mimeType: metadata.contentType ?? document.mimeType,
        scanStatus: 'SCANNING',
      },
    });

    await this.scanQueue
      .add(
        'scan',
        { tenantId: tenant.tenantId, admissionDocumentId: document.id },
        { attempts: 3, backoff: { type: 'exponential', delay: 2_000 }, removeOnComplete: 1_000, removeOnFail: 5_000 },
      )
      .catch(() => undefined); // a scan failure must not fail the applicant's upload

    await this.logActivity(tenant.tenantId, app.id, 'DOCUMENT_UPLOADED', `Applicant uploaded ${document.category}`);
    await this.audit(tenant.tenantId, AUDIT_ACTIONS.ADMISSION_DOCUMENT_UPLOADED, document.id, access.id, {
      category: document.category,
      sizeBytes: metadata.sizeBytes,
      via: 'PORTAL',
    });

    return { id: updated.id, category: updated.category, status: updated.status, scanStatus: updated.scanStatus };
  }

  async deleteDocument(slug: string, accessId: string, applicationId: string, documentId: string) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const app = await this.ownedApplication(tenant.tenantId, access, applicationId);
    this.assertEditable(app);

    const client = createTenantScopedClient(tenant.tenantId);
    const document = await client.admissionDocument.findFirst({ where: { id: documentId, applicationId: app.id } });
    if (!document) throw new NotFoundException('Document not found.');
    if (document.scanStatus === 'INFECTED') {
      // Quarantined payload is already gone; just drop the row.
      await client.admissionDocument.delete({ where: { id: document.id } });
      return { deleted: true };
    }

    if (document.storageKey) {
      await this.storage.delete(tenant.tenantId, document.storageKey).catch(() => undefined);
    }
    await client.admissionDocument.delete({ where: { id: document.id } });
    await this.logActivity(tenant.tenantId, app.id, 'DOCUMENT_REMOVED', `Applicant removed ${document.category}`);
    return { deleted: true };
  }

  async downloadUrl(slug: string, accessId: string, applicationId: string, documentId: string) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const app = await this.ownedApplication(tenant.tenantId, access, applicationId);
    const client = createTenantScopedClient(tenant.tenantId);
    const document = await client.admissionDocument.findFirst({ where: { id: documentId, applicationId: app.id } });
    if (!document?.storageKey) throw new NotFoundException('Document not found.');
    if (document.scanStatus === 'INFECTED') throw new BadRequestException('This file was rejected by the security scan.');
    return {
      url: await this.storage.getDownloadUrl(tenant.tenantId, document.storageKey, {
        filename: document.originalFilename ?? document.documentName,
        contentType: document.mimeType ?? undefined,
      }),
      filename: document.originalFilename ?? document.documentName,
    };
  }

  // ── Submit + tracking ───────────────────────────────────────────────────────────────────────

  async submitApplication(slug: string, accessId: string, applicationId: string, dto: PortalSubmitDto) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const app = await this.ownedApplication(tenant.tenantId, access, applicationId);
    this.assertEditable(app);

    if (!dto.declarationAccepted) {
      throw new BadRequestException('You must accept the declaration before submitting.');
    }

    const session = await this.sessionForApplication(tenant.tenantId, app);
    const config = await this.configFor(tenant.tenantId, session);
    if (dto.consentVersion !== config.consentVersion) {
      throw new BadRequestException('The declaration has changed. Reload the page and accept the current version.');
    }

    const client = createTenantScopedClient(tenant.tenantId);
    const documents = await client.admissionDocument.findMany({ where: { applicationId: app.id } });
    const checklist = this.checklistFor(session, null);
    const present = new Set(
      documents
        .filter((doc) => doc.storageKey && doc.status !== 'REJECTED' && doc.scanStatus !== 'INFECTED')
        .map((doc) => doc.category.toUpperCase()),
    );
    const missing = checklist.filter((category) => !present.has(category));
    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Upload the remaining documents before submitting.',
        code: 'DOCUMENTS_MISSING',
        missingDocuments: missing,
      });
    }

    await this.assertRequiredAnswers(client, app, session);

    const now = new Date();
    await client.admissionApplication.update({
      where: { id: app.id },
      data: {
        status: 'SUBMITTED',
        submittedAt: now,
        consentAcceptedAt: now,
        consentVersion: dto.consentVersion,
        updatedBy: null,
      },
    });

    await this.logActivity(tenant.tenantId, app.id, 'APPLICATION_SUBMITTED', 'Application submitted on the public portal');
    await this.audit(tenant.tenantId, AUDIT_ACTIONS.ADMISSION_PORTAL_APPLICATION_SUBMITTED, app.id, access.id, {
      reference: app.publicReference,
      documents: documents.length,
    });

    const address = access.contact;
    await this.notifications
      .sendApplicationReceived({
        tenantId: tenant.tenantId,
        address,
        name: app.fullName,
        channel: access.channel as 'EMAIL' | 'SMS',
        reference: app.publicReference ?? '',
        collegeName: tenant.name,
        supportEmail: config.supportEmail,
        supportPhone: config.supportPhone,
      })
      .catch(() => undefined);

    return this.viewApplication(tenant.tenantId, app.id, access, config);
  }

  async track(slug: string, accessId: string, reference: string) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const config = await this.configFor(tenant.tenantId);
    const client = createTenantScopedClient(tenant.tenantId);

    const app = await client.admissionApplication.findFirst({
      where: {
        publicReference: reference,
        ...(access.applicationId ? { id: access.applicationId } : {}),
      },
    });
    if (!app) throw new NotFoundException('No application found for that reference.');
    this.assertContactMatches(access, app.email, app.phone);

    return this.viewApplication(tenant.tenantId, app.id, access, config);
  }

  async listMyApplications(slug: string, accessId: string) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const client = createTenantScopedClient(tenant.tenantId);
    const apps = await client.admissionApplication.findMany({
      where: access.applicationId ? { id: access.applicationId } : { id: '__none__' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, publicReference: true, status: true, createdAt: true, submittedAt: true },
    });
    return { applications: apps };
  }

  // ── Offers ──────────────────────────────────────────────────────────────────────────────────

  async respondToOffer(slug: string, accessId: string, offerId: string, decision: 'accept' | 'decline', remarks?: string) {
    const tenant = await this.resolveTenant(slug);
    const access = await this.requireVerifiedAccess(tenant.tenantId, accessId);
    const client = createTenantScopedClient(tenant.tenantId);

    const offer = await client.admissionOffer.findFirst({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Offer not found.');
    const app = await this.ownedApplication(tenant.tenantId, access, offer.applicationId);

    if (offer.status === (decision === 'accept' ? 'ACCEPTED' : 'DECLINED')) {
      return this.viewApplication(tenant.tenantId, app.id, access, await this.configFor(tenant.tenantId));
    }
    if (offer.status !== 'ISSUED') throw new BadRequestException(`This offer is ${offer.status.toLowerCase()}.`);
    if (offer.expiresAt < new Date()) {
      await client.admissionOffer.update({ where: { id: offer.id }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('This offer has expired. Contact the admissions office.');
    }

    const now = new Date();
    await client.$transaction(async (tx) => {
      await tx.admissionOffer.update({
        where: { id: offer.id },
        data:
          decision === 'accept'
            ? { status: 'ACCEPTED', acceptedAt: now, remarks: remarks ?? offer.remarks }
            : { status: 'DECLINED', declinedAt: now, remarks: remarks ?? offer.remarks },
      });
      await tx.admissionApplication.update({
        where: { id: app.id },
        data: { status: decision === 'accept' ? 'OFFER_ACCEPTED' : 'SELECTED', updatedBy: null },
      });
      if (decision === 'decline') {
        // The seat was reserved when the offer was issued; give it back atomically.
        const programOffer = await tx.admissionProgramOffer.findFirst({ where: { id: app.admissionProgramId } });
        if (programOffer && programOffer.filledSeats > 0) {
          await tx.admissionProgramOffer.update({
            where: { id: programOffer.id },
            data: { filledSeats: programOffer.filledSeats - 1, status: 'OPEN' },
          });
        }
      }
    });

    await this.logActivity(
      tenant.tenantId,
      app.id,
      decision === 'accept' ? 'OFFER_ACCEPTED' : 'OFFER_DECLINED',
      `Applicant ${decision === 'accept' ? 'accepted' : 'declined'} offer ${offer.offerNumber}`,
    );
    await this.audit(
      tenant.tenantId,
      decision === 'accept' ? AUDIT_ACTIONS.ADMISSION_OFFER_ACCEPTED : AUDIT_ACTIONS.ADMISSION_OFFER_DECLINED,
      offer.id,
      access.id,
      { via: 'PORTAL', remarks: remarks ?? null },
    );

    return this.viewApplication(tenant.tenantId, app.id, access, await this.configFor(tenant.tenantId));
  }

  // ── Internals ───────────────────────────────────────────────────────────────────────────────

  private async findSession(client: ReturnType<typeof createTenantScopedClient>, publicSlug: string) {
    const session = (await client.admissionSession.findFirst({
      where: { publicSlug, portalEnabled: true },
      include: SESSION_INCLUDE,
    })) as unknown as PortalSessionRow | null;
    if (!session) throw new NotFoundException('This admission session is not available.');
    return session;
  }

  private async sessionForApplication(tenantId: string, app: AdmissionApplication): Promise<PortalSessionRow> {
    const client = createTenantScopedClient(tenantId);
    const session = (await client.admissionSession.findFirst({
      where: { id: app.sessionId },
      include: SESSION_INCLUDE,
    })) as unknown as PortalSessionRow | null;
    if (!session) throw new NotFoundException('Admission session not found.');
    return session;
  }

  private isOpen(session: PortalSessionRow, now: Date): boolean {
    if (!session.portalEnabled || !session.publicSlug || session.status !== 'OPEN') return false;
    const opensAt = session.portalOpenAt ?? session.startAt;
    const closesAt = session.portalCloseAt ?? session.endAt;
    return now >= opensAt && now <= closesAt;
  }

  private assertOpen(session: PortalSessionRow, config: AdmissionPortalConfig, slug: string): void {
    if (!config.enabled) throw new NotFoundException('This admissions portal is not available.');
    if (!this.isOpen(session, new Date())) {
      throw new BadRequestException({
        message: 'Applications are not open for this session right now.',
        code: 'SESSION_CLOSED',
        collegeSlug: slug,
      });
    }
  }

  private assertEditable(app: AdmissionApplication): void {
    if (!['INITIATED', 'SUBMITTED'].includes(app.status)) {
      throw new ConflictException({
        statusCode: 409,
        code: 'APPLICATION_LOCKED',
        message: 'This application can no longer be changed online. Contact the admissions office.',
      });
    }
  }

  private checklistFor(session: PortalSessionRow, offer: PortalSessionRow['programs'][number] | null): string[] {
    const fromOffer = Array.isArray(offer?.requiredDocuments) ? (offer?.requiredDocuments as string[]) : null;
    const fromSession = Array.isArray(session.requiredDocuments) ? (session.requiredDocuments as string[]) : null;
    const list = fromOffer?.length ? fromOffer : fromSession?.length ? fromSession : [...DEFAULT_DOCUMENT_CHECKLIST];
    return list.map((entry) => String(entry).toUpperCase());
  }

  private async resolveCampusId(tenantId: string, session: PortalSessionRow): Promise<string> {
    const instruction = (session.portalInstructions ?? {}) as Record<string, unknown>;
    const configured = typeof instruction.campusId === 'string' ? instruction.campusId : null;
    const client = createTenantScopedClient(tenantId);
    if (configured) {
      const campus = await client.campus.findFirst({ where: { id: configured } });
      if (!campus) throw new BadRequestException('The configured campus for this portal no longer exists.');
      return campus.id;
    }
    const campus = await client.campus.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!campus) throw new BadRequestException('This college has no campus configured for admissions.');
    return campus.id;
  }

  private async ownedApplication(
    tenantId: string,
    access: AdmissionApplicantAccess,
    applicationId: string,
  ): Promise<AdmissionApplication> {
    if (access.applicationId !== applicationId) {
      // Same message as a real 404: an applicant must not be able to probe other applications.
      throw new NotFoundException('Application not found.');
    }
    const client = createTenantScopedClient(tenantId);
    const app = await client.admissionApplication.findFirst({ where: { id: applicationId } });
    if (!app) throw new NotFoundException('Application not found.');
    return app;
  }

  private async requireVerifiedAccess(tenantId: string, accessId: string): Promise<AdmissionApplicantAccess> {
    return this.access.requireAccess(tenantId, accessId);
  }

  private assertContactMatches(access: AdmissionApplicantAccess, email?: string | null, phone?: string | null): void {
    const normalisedAccess = access.contact;
    if (access.channel === 'EMAIL') {
      if (email && email.trim().toLowerCase() !== normalisedAccess) {
        throw new BadRequestException('Use the email address you verified.');
      }
      return;
    }
    if (phone && phone.replace(/[^0-9]/g, '') !== normalisedAccess.replace(/[^0-9]/g, '')) {
      throw new BadRequestException('Use the phone number you verified.');
    }
  }

  private async assertRequiredAnswers(
    client: ReturnType<typeof createTenantScopedClient>,
    app: AdmissionApplication,
    session: PortalSessionRow,
  ): Promise<void> {
    const configured = await client.admissionFormField.findMany({
      where: { sessionId: session.id, isActive: true, required: true },
    });
    const requiredFields = configured.length
      ? configured.map((field) => field.code)
      : ADMISSION_FORM_FIELDS.filter((field) => field.required).map((field) => field.key);
    const answers = (app.data ?? {}) as Record<string, unknown>;
    const missing = requiredFields.filter((key) => {
      const value = answers[key];
      return value === undefined || value === null || value === '';
    });
    if (missing.length > 0) {
      throw new BadRequestException({
        message: 'Complete the required form fields before submitting.',
        code: 'FORM_INCOMPLETE',
        missingFields: missing,
      });
    }
  }

  private async viewApplication(
    tenantId: string,
    applicationId: string,
    access: AdmissionApplicantAccess,
    config: AdmissionPortalConfig,
  ) {
    const client = createTenantScopedClient(tenantId);
    const app = await client.admissionApplication.findFirst({
      where: { id: applicationId },
      include: {
        admissionProgram: { include: { program: true } },
        session: true,
        documents: { orderBy: { createdAt: 'asc' } },
        offers: { orderBy: { createdAt: 'asc' } },
        qualifications: { orderBy: { createdAt: 'asc' } },
        activities: { orderBy: { occurredAt: 'desc' }, take: 50 },
      },
    });
    if (!app) throw new NotFoundException('Application not found.');

    const checklist = Array.isArray(app.session?.requiredDocuments)
      ? (app.session.requiredDocuments as string[])
      : [...DEFAULT_DOCUMENT_CHECKLIST];

    return {
      id: app.id,
      reference: app.publicReference,
      status: app.status,
      editable: ['INITIATED', 'SUBMITTED'].includes(app.status),
      submittedAt: app.submittedAt?.toISOString() ?? null,
      createdAt: app.createdAt.toISOString(),
      session: { name: app.session?.name, publicSlug: app.session?.publicSlug },
      program: {
        offerId: app.admissionProgramId,
        name: app.admissionProgram?.program?.name ?? null,
      },
      applicant: {
        fullName: app.fullName,
        email: app.email,
        phone: app.phone,
      },
      documents: app.documents.map((doc) => ({
        id: doc.id,
        category: doc.category,
        name: doc.originalFilename ?? doc.documentName,
        status: doc.status,
        scanStatus: doc.scanStatus,
        uploadedAt: doc.createdAt.toISOString(),
        downloadable: Boolean(doc.storageKey) && doc.scanStatus !== 'INFECTED',
      })),
      checklist: checklist.map((category) => String(category).toUpperCase()),
      missingDocuments: checklist
        .map((category) => String(category).toUpperCase())
        .filter((category) => !app.documents.some((doc) => doc.category.toUpperCase() === category && doc.storageKey)),
      qualifications: app.qualifications.map((row) => ({
        id: row.id,
        institution: row.institution,
        board: row.board,
        degree: row.degree,
        yearOfPassing: row.yearOfPassing,
        percentage: row.percentage,
        verificationStatus: row.verificationStatus,
      })),
      offers: app.offers.map((offer: AdmissionOffer) => ({
        id: offer.id,
        offerNumber: offer.offerNumber,
        status: offer.status,
        issuedAt: offer.issuedAt.toISOString(),
        expiresAt: offer.expiresAt.toISOString(),
        admissionFeeCents: offer.admissionFeeCents,
      })),
      fee: {
        applicationFeeCents: app.session?.applicationFeeCents ?? 0,
        admissionFeeCents: app.session?.admissionFeeCents ?? 0,
        paid: Boolean(app.feePaidAt),
        receiptNumber: app.feeReceiptNumber,
        onlinePaymentAvailable: false,
        note: 'Pay at the admissions office; the receipt appears here once recorded.',
      },
      consent: {
        acceptedAt: app.consentAcceptedAt?.toISOString() ?? null,
        version: app.consentVersion,
        currentVersion: config.consentVersion,
      },
      timeline: app.activities.map((row) => ({
        eventType: row.eventType,
        title: row.title,
        description: row.description,
        at: row.occurredAt.toISOString(),
      })),
      verifiedContact: access.channel === 'EMAIL' ? maskEmail(access.contact) : maskPhone(access.contact),
    };
  }

  private async generatePublicReference(tenantId: string): Promise<string> {
    const client = createTenantScopedClient(tenantId);
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = `AP-${randomBytes(4).toString('hex').toUpperCase()}`;
      const existing = await client.admissionApplication.count({ where: { publicReference: candidate } });
      if (existing === 0) return candidate;
    }
    throw new ConflictException('Could not allocate an application reference; please retry.');
  }

  private async generateApplicationNumber(tenantId: string): Promise<string> {
    const client = createTenantScopedClient(tenantId);
    for (let attempt = 0; attempt < 6; attempt++) {
      const candidate = `${ADMISSION_NUMBER_PREFIX}-${new Date().getFullYear()}-${randomBytes(3).toString('hex').toUpperCase()}`;
      const existing = await client.admissionApplication.count({ where: { applicationNumber: candidate } });
      if (existing === 0) return candidate;
    }
    throw new ConflictException('Could not allocate an application number; please retry.');
  }

  private async findDuplicate(tenantId: string, candidate: AdmissionApplication): Promise<string | null> {
    const client = createTenantScopedClient(tenantId);
    if (candidate.email) {
      const found = await client.admissionApplication.findFirst({
        where: { sessionId: candidate.sessionId, email: candidate.email, id: { not: candidate.id } },
        select: { id: true },
      });
      if (found) return found.id;
    }
    if (candidate.phone) {
      const digits = candidate.phone.replace(/[^0-9]/g, '');
      if (digits.length >= 6) {
        const found = await client.admissionApplication.findFirst({
          where: { sessionId: candidate.sessionId, phone: { contains: digits.slice(-8) }, id: { not: candidate.id } },
          select: { id: true },
        });
        if (found) return found.id;
      }
    }
    return null;
  }

  private async logActivity(tenantId: string, applicationId: string, eventType: string, title: string): Promise<void> {
    const client = createTenantScopedClient(tenantId);
    await client.admissionActivity.create({
      data: { tenantId, applicationId, eventType, title, actorUserId: null },
    });
  }

  private async audit(
    tenantId: string,
    action: string,
    entityId: string,
    accessId: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'APPLICANT',
      action,
      module: AUDIT_MODULES.ADMISSIONS,
      entityType: 'AdmissionApplication',
      entityId,
      after: { ...after, applicantAccessId: accessId },
    });
  }

  private mapFieldType(type: string): string {
    switch (type) {
      case 'NUMBER':
        return 'NUMBER';
      case 'DATE':
        return 'DATE';
      case 'SELECT':
      case 'RADIO':
        return 'SELECT';
      case 'CHECKBOX':
        return 'MULTISELECT';
      default:
        return 'TEXT';
    }
  }
}

function maskEmail(value: string): string {
  const [local, domain] = value.split('@');
  if (!local || !domain) return '•••';
  return `${local.slice(0, 2)}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
}

function maskPhone(value: string): string {
  return `${value.slice(0, 3)}${'•'.repeat(Math.max(1, value.length - 5))}${value.slice(-2)}`;
}
