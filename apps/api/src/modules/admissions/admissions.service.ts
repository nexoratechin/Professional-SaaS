/**
 * Admissions lifecycle service: sessions (seat matrix), enquiries, applications, documents,
 * verification, merit ranking, counselling, offers, admission fee, and enrollment (which
 * auto-creates the Student + StudentAdmission + enrollment/fee/guardian records). Every
 * operation is tenant-scoped via TenantScopedPrismaService; durable events land in both the
 * centralized audit trail (module 'admissions') and the application's AdmissionActivity timeline.
 *
 * Stage-guard discipline: each transition validates the applicant's current status so the state
 * machine can't be skipped (e.g. an offer requires SELECTED, enrollment requires FEE_PAID).
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
import { AUDIT_ACTIONS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService } from '../rbac/permissions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { WorkflowDefinitionsService } from '../workflow/workflow-definitions.service';
import { WorkflowEngineService } from '../workflow/workflow-engine.service';
import { rowsToCsv } from '../organization/org-csv';
import { admissionScopeFilter } from './admissions-scope';
import {
  DEFAULT_DOCUMENT_CHECKLIST,
  ADMISSION_FORM_FIELDS,
  ADMISSION_NUMBER_PREFIX,
  OFFER_NUMBER_PREFIX,
  RECEIPT_NUMBER_PREFIX,
  ADMISSION_EVENTS,
  ADMISSION_APPLICATION_EXPORT_COLUMNS,
  ADMISSION_ENQUIRY_EXPORT_COLUMNS,
  ADMISSION_MERIT_EXPORT_COLUMNS,
} from './admissions.constants';
import {
  ADMISSION_APPLICATION_STATUSES as APP_STATUSES,
  CreateAdmissionApplicationDto,
  CreateAdmissionEnquiryDto,
  CreateAdmissionProgramDto,
  CreateAdmissionSessionDto,
  CreateApplicationDocumentDto,
  CreateCounsellingSlotDto,
  CreateQualificationDto,
  DocumentDecisionDto,
  EnrollApplicationDto,
  IssueOfferDto,
  ListAdmissionApplicationQueryDto,
  PayAdmissionFeeDto,
  ScoreAdmissionApplicationDto,
  UpdateAdmissionApplicationDto,
  UpdateAdmissionEnquiryDto,
  UpdateAdmissionProgramDto,
  UpdateAdmissionSessionDto,
  UpdateApplicationDocumentDto,
  UpdateCounsellingSlotDto,
  UpdateQualificationDto,
  SetAdmissionFormFieldsDto,
  CreateAdmissionEligibilityRuleDto,
  UpdateAdmissionEligibilityRuleDto,
  FlagDuplicateDto,
  BulkImportApplicationDto,
  BulkVerifyApplicationsDto,
  SendAdmissionMessageDto,
  AdmissionAnalyticsQueryDto,
} from './dto/admissions.dto';

type Client = PrismaClient;

/** Default expiry window for an issued offer (14 days). */
const OFFER_VALIDITY_DAYS = 14;

/** Statuses an application must hold to have its seat counted as allocated. */
const FEEDING_STATUSES = ['OFFERED', 'OFFER_ACCEPTED', 'FEE_PAID', 'ENROLLED'];

@Injectable()
export class AdmissionsService {
  private readonly logger = new Logger(AdmissionsService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissionsService: PermissionsService,
    private readonly notifications: NotificationsService,
    private readonly workflowDefinitions: WorkflowDefinitionsService,
    private readonly workflowEngine: WorkflowEngineService,
  ) {}

  // ── Scope ─────────────────────────────────────────────────────────────────

  /** Converts the caller's `admissions.view` grants into an AdmissionApplication `where`.
   * Admissions is staff-facing (applicants don't log in), so OWN is deliberately impossible. */
  private async applicationScope(tenantId: string, userId: string): Promise<Record<string, any> | undefined> {
    const grants = await this.permissionsService.getScopeGrantsFor(tenantId, userId, 'admissions.view');
    return admissionScopeFilter(grants);
  }

  /** Loads an application row guarded by the caller's grants, or throws NotFound. */
  private async assertApplicationInScope(applicationId: string, tenantId: string, userId: string) {
    const scope = await this.applicationScope(tenantId, userId);
    const row = await (this.tenantPrisma.client as Client).admissionApplication.findFirst({
      where: { id: applicationId, ...(scope ?? {}) },
      include: this.APPLICATION_INCLUDES,
    });
    if (!row) throw new NotFoundException('Admission application not found.');
    return row;
  }

  private get APPLICATION_INCLUDES(): Prisma.AdmissionApplicationInclude {
    return {
      session: true,
      admissionProgram: { include: { program: true } },
      campus: true,
      academicYear: true,
      counsellingSlot: true,
      enquiry: true,
      duplicateOf: { select: { id: true, applicationNumber: true, fullName: true, email: true, phone: true, status: true } },
      documents: { orderBy: { createdAt: 'asc' as const } },
      qualifications: { orderBy: { createdAt: 'asc' as const } },
      offers: { orderBy: { createdAt: 'asc' as const } },
      payments: { orderBy: { createdAt: 'asc' as const } },
      activities: { orderBy: { occurredAt: 'desc' as const } },
    };
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  async listSessions(_tenantId: string) {
    return (this.tenantPrisma.client as Client).admissionSession.findMany({
      where: {},
      orderBy: { createdAt: 'desc' },
      include: {
        academicYear: true,
        _count: { select: { applications: true, programs: true, enquiries: true } },
      },
    });
  }

  async getSession(tenantId: string, sessionId: string) {
    const session = await (this.tenantPrisma.client as Client).admissionSession.findFirst({
      where: { id: sessionId },
      include: { academicYear: true, programs: { include: { program: true } } },
    });
    if (!session) throw new NotFoundException('Admission session not found.');
    return session;
  }

  async createSession(tenantId: string, userId: string, dto: CreateAdmissionSessionDto) {
    const start = new Date(dto.startAt);
    const end = new Date(dto.endAt);
    if (end <= start) throw new BadRequestException('endAt must be after startAt.');
    await this.assertRef({ model: 'academicYear', id: dto.academicYearId, label: 'Academic year' });

    const session = await (this.tenantPrisma.client as any).admissionSession.create({
      data: {
        code: dto.code.trim().toUpperCase(),
        name: dto.name.trim(),
        academicYearId: dto.academicYearId,
        startAt: start,
        endAt: end,
        applicationFeeCents: dto.applicationFeeCents ?? 0,
        admissionFeeCents: dto.admissionFeeCents ?? 0,
        requiredDocuments: dto.requiredDocuments?.length ? (dto.requiredDocuments as any) : undefined,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_SESSION_CREATED, 'AdmissionSession', session.id, {
      after: { code: session.code, name: session.name },
    });
    return this.getSession(tenantId, session.id);
  }

  async updateSession(tenantId: string, userId: string, sessionId: string, dto: UpdateAdmissionSessionDto) {
    const before = await this.getSession(tenantId, sessionId);
    const data: Record<string, any> = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.startAt !== undefined) data.startAt = new Date(dto.startAt);
    if (dto.endAt !== undefined) data.endAt = new Date(dto.endAt);
    if (dto.startAt || dto.endAt) {
      const start = data.startAt ?? before.startAt;
      const end = data.endAt ?? before.endAt;
      if (end <= start) throw new BadRequestException('endAt must be after startAt.');
    }
    if (dto.applicationFeeCents !== undefined) data.applicationFeeCents = dto.applicationFeeCents;
    if (dto.admissionFeeCents !== undefined) data.admissionFeeCents = dto.admissionFeeCents;
    if (dto.requiredDocuments !== undefined) data.requiredDocuments = dto.requiredDocuments as any;
    data.updatedBy = userId;

    const session = await (this.tenantPrisma.client as any).admissionSession.update({
      where: { id: sessionId },
      data,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_SESSION_UPDATED, 'AdmissionSession', sessionId, {
      before: { name: before.name },
      after: { name: session.name },
    });
    return this.getSession(tenantId, sessionId);
  }

  async closeSession(tenantId: string, userId: string, sessionId: string) {
    const before = await this.getSession(tenantId, sessionId);
    if (before.status !== 'OPEN') return { id: sessionId, status: before.status };
    const session = await (this.tenantPrisma.client as any).admissionSession.update({
      where: { id: sessionId },
      data: { status: 'CLOSED', updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_SESSION_CLOSED, 'AdmissionSession', sessionId, {
      before: { status: 'OPEN' },
      after: { status: session.status },
    });
    return { id: sessionId, status: session.status };
  }

  // ── Program offers (seat matrix) ──────────────────────────────────────────

  async listPrograms(tenantId: string, sessionId?: string) {
    return (this.tenantPrisma.client as Client).admissionProgramOffer.findMany({
      where: sessionId ? { sessionId } : {},
      orderBy: [{ session: { createdAt: 'desc' } }, { program: { name: 'asc' } }],
      include: { session: { select: { id: true, code: true, name: true, status: true } }, program: true },
    });
  }

  async createProgram(tenantId: string, userId: string, dto: CreateAdmissionProgramDto) {
    await this.assertRef({ model: 'admissionSession', id: dto.sessionId, label: 'Admission session' });
    await this.assertRef({ model: 'program', id: dto.programId, label: 'Program' });
    const seats = dto.seats ?? 0;

    const program = await (this.tenantPrisma.client as any).admissionProgramOffer.create({
      data: {
        sessionId: dto.sessionId,
        programId: dto.programId,
        seats,
        applicationFeeCents: dto.applicationFeeCents ?? 0,
        admissionFeeCents: dto.admissionFeeCents ?? 0,
        tuitionFeeCents: dto.tuitionFeeCents ?? 0,
        requiredDocuments: dto.requiredDocuments?.length ? (dto.requiredDocuments as any) : undefined,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_PROGRAM_CREATED, 'AdmissionProgramOffer', program.id, {
      after: { sessionId: dto.sessionId, programId: dto.programId, seats },
    });
    return program;
  }

  async updateProgram(tenantId: string, userId: string, programId: string, dto: UpdateAdmissionProgramDto) {
    const before = await (this.tenantPrisma.client as Client).admissionProgramOffer.findFirst({
      where: { id: programId },
    });
    if (!before) throw new NotFoundException('Admission program offer not found.');
    const data: Record<string, any> = { ...dto, updatedBy: userId };
    delete data.requiredDocuments;
    if (dto.requiredDocuments !== undefined) data.requiredDocuments = dto.requiredDocuments as any;
    const seats = dto.seats ?? before.seats;
    const filledSeats = dto.seats !== undefined ? Math.min(before.filledSeats, seats) : before.filledSeats;
    data.filledSeats = filledSeats;
    data.status = seats > 0 && filledSeats >= seats ? 'FULL' : 'OPEN';

    const program = await (this.tenantPrisma.client as any).admissionProgramOffer.update({
      where: { id: programId },
      data,
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_PROGRAM_UPDATED, 'AdmissionProgramOffer', programId, {
      before: { seats: before.seats, filledSeats: before.filledSeats },
      after: { seats: program.seats, filledSeats: program.filledSeats },
    });
    return program;
  }

  // ── Enquiries ─────────────────────────────────────────────────────────────

  async listEnquiries(tenantId: string, query: { search?: string; source?: string; sessionId?: string; skip?: number; take?: number }) {
    const where: Record<string, any> = {};
    if (query.search) {
      const contains = { contains: query.search, mode: 'insensitive' as const };
      where.OR = [{ name: contains }, { email: contains }, { phone: contains }];
    }
    if (query.source) where.source = query.source;
    if (query.sessionId) where.sessionId = query.sessionId;

    const [data, total] = await Promise.all([
      (this.tenantPrisma.client as Client).admissionEnquiry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { program: true, session: { select: { id: true, code: true, name: true } } },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      (this.tenantPrisma.client as Client).admissionEnquiry.count({ where }),
    ]);
    return { data, total };
  }

  async createEnquiry(tenantId: string, userId: string, dto: CreateAdmissionEnquiryDto) {
    if (dto.programId) await this.assertRef({ model: 'program', id: dto.programId, label: 'Program' });
    if (dto.sessionId) await this.assertRef({ model: 'admissionSession', id: dto.sessionId, label: 'Admission session' });
    const enquiry = await (this.tenantPrisma.client as any).admissionEnquiry.create({
      data: {
        name: dto.name.trim(),
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        programId: dto.programId ?? null,
        sessionId: dto.sessionId ?? null,
        source: dto.source ?? 'WEBSITE',
        message: dto.message ?? null,
        followUpAt: dto.followUpAt ? new Date(dto.followUpAt) : null,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_ENQUIRY_CREATED, 'AdmissionEnquiry', enquiry.id, {
      after: { name: enquiry.name, source: enquiry.source },
    });
    return enquiry;
  }

  async updateEnquiry(tenantId: string, userId: string, enquiryId: string, dto: UpdateAdmissionEnquiryDto) {
    const before = await (this.tenantPrisma.client as Client).admissionEnquiry.findFirst({ where: { id: enquiryId } });
    if (!before) throw new NotFoundException('Enquiry not found.');
    const enquiry = await (this.tenantPrisma.client as any).admissionEnquiry.update({
      where: { id: enquiryId },
      data: {
        email: dto.email ?? before.email,
        phone: dto.phone ?? before.phone,
        message: dto.message ?? before.message,
        followUpAt: dto.followUpAt !== undefined ? (dto.followUpAt ? new Date(dto.followUpAt) : null) : before.followUpAt,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_ENQUIRY_UPDATED, 'AdmissionEnquiry', enquiryId, {
      before: { name: before.name },
      after: { name: enquiry.name },
    });
    return enquiry;
  }

  async convertEnquiry(tenantId: string, userId: string, enquiryId: string) {
    const enquiry = await (this.tenantPrisma.client as Client).admissionEnquiry.findFirst({ where: { id: enquiryId } });
    if (!enquiry) throw new NotFoundException('Enquiry not found.');
    if (enquiry.convertedToApplicationId) {
      return this.getApplication(enquiry.convertedToApplicationId, tenantId, userId);
    }

    const session = enquiry.sessionId
      ? await (this.tenantPrisma.client as Client).admissionSession.findFirst({ where: { id: enquiry.sessionId } })
      : null;
    const programOffer = enquiry.programId
      ? await (this.tenantPrisma.client as Client).admissionProgramOffer.findFirst({
          where: session ? { sessionId: session.id, programId: enquiry.programId } : { programId: enquiry.programId },
          orderBy: { createdAt: 'desc' },
        })
      : null;
    if (!session || !programOffer) {
      throw new BadRequestException('The enquiry must reference an admission session and program before converting.');
    }

    const suffix = enquiry.name.trim().split(/\s+/).slice(0, 2).join(' ');
    const defaultCampus = await (this.tenantPrisma.client as Client).campus.findFirst({
      where: {},
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!defaultCampus) {
      throw new BadRequestException('No campus has been configured — create the application from the application form instead.');
    }
    const parts = suffix.split(' ');

    const application = await (this.tenantPrisma.client as any).admissionApplication.create({
      data: {
        applicationNumber: await this.generateApplicationNumber(),
        sessionId: session.id,
        admissionProgramId: programOffer.id,
        campusId: defaultCampus.id,
        academicYearId: session.academicYearId,
        enquiryId: enquiry.id,
        firstName: parts[0] ?? 'Unknown',
        middleName: null,
        lastName: parts[1] ?? 'Unknown',
        fullName: enquiry.name.trim(),
        email: enquiry.email ?? null,
        phone: enquiry.phone ?? null,
        status: 'INITIATED',
        createdBy: userId,
        updatedBy: userId,
      },
    });

    await (this.tenantPrisma.client as any).admissionEnquiry.update({
      where: { id: enquiry.id },
      data: { convertedToApplicationId: application.id, convertedAt: new Date(), updatedBy: userId },
    });
    await this.logActivity(application.id, ADMISSION_EVENTS.ENQUIRY_CONVERTED, 'Enquiry converted to application', userId);
    await this.logActivity(application.id, ADMISSION_EVENTS.APPLICATION_CREATED, 'Application created', userId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_ENQUIRY_CONVERTED, 'AdmissionEnquiry', enquiry.id, {
      after: { applicationId: application.id },
    });

    const full = await (this.tenantPrisma.client as Client).admissionApplication.findFirst({
      where: { id: application.id },
      include: this.APPLICATION_INCLUDES,
    });
    return full;
  }

  // ── Applications ──────────────────────────────────────────────────────────

  async listApplications(tenantId: string, userId: string, query: ListAdmissionApplicationQueryDto) {
    const scope = await this.applicationScope(tenantId, userId);
    const where: Record<string, any> = {};
    if (scope) Object.assign(where, scope);

    if (query.search) {
      const contains = { contains: query.search, mode: 'insensitive' as const };
      where.OR = [
        { applicationNumber: contains },
        { fullName: contains },
        { firstName: contains },
        { lastName: contains },
        { email: contains },
        { phone: contains },
      ];
    }
    if (query.sessionId) where.sessionId = query.sessionId;
    if (query.admissionProgramId) where.admissionProgramId = query.admissionProgramId;
    if (query.campusId) where.campusId = query.campusId;
    if (query.status) {
      const statuses = query.status
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s): s is (typeof APP_STATUSES)[number] => (APP_STATUSES as readonly string[]).includes(s));
      if (statuses.length > 0) where.status = { in: statuses };
    }

    const orderBy = this.buildListOrderBy(query);

    const ids = await (this.tenantPrisma.client as Client).admissionApplication
      .findMany({ where, select: { id: true }, skip: query.skip ?? 0, take: query.take ?? 50, orderBy })
      .then((rows) => rows.map((r) => r.id));

    const [data, total] = await Promise.all([
      ids.length
        ? (this.tenantPrisma.client as Client).admissionApplication.findMany({
            where: { id: { in: ids } },
            orderBy,
            include: {
              session: { select: { id: true, code: true, name: true, status: true } },
              admissionProgram: { select: { id: true, seats: true, filledSeats: true, admissionFeeCents: true, program: { select: { id: true, code: true, name: true } } } },
              campus: { select: { id: true, code: true, name: true } },
              academicYear: { select: { id: true, code: true, name: true } },
              counsellingSlot: { select: { id: true, date: true, venue: true } },
            },
          })
        : Promise.resolve([]),
      (this.tenantPrisma.client as Client).admissionApplication.count({ where }),
    ]);

    return { data, total };
  }

  private buildListOrderBy(query: ListAdmissionApplicationQueryDto): Record<string, 'asc' | 'desc'> {
    const direction = query.sortOrder === 'asc' ? 'asc' : 'desc';
    switch (query.sortBy) {
      case 'meritScore':
        return { meritScore: direction };
      case 'meritRank':
        return { meritRank: direction };
      case 'applicationNumber':
        return { applicationNumber: direction };
      default:
        return { createdAt: direction };
    }
  }

  async getApplication(applicationId: string, tenantId: string, userId: string) {
    const raw = await this.assertApplicationInScope(applicationId, tenantId, userId);
    const row = { ...raw } as any;
    row.admissionProgram = raw.admissionProgram;
    return row;
  }

  async createApplication(tenantId: string, userId: string, dto: CreateAdmissionApplicationDto) {
    const session = await (this.tenantPrisma.client as Client).admissionSession.findFirst({
      where: { id: dto.sessionId },
    });
    if (!session) throw new NotFoundException('Admission session not found.');
    const offer = await (this.tenantPrisma.client as Client).admissionProgramOffer.findFirst({
      where: { id: dto.admissionProgramId, sessionId: dto.sessionId },
    });
    if (!offer) throw new NotFoundException('Program offer not found in this session.');
    if (session.status !== 'OPEN') throw new BadRequestException('This admission session is closed.');
    await this.assertRef({ model: 'campus', id: dto.campusId, label: 'Campus' });
    await this.assertRef({ model: 'academicYear', id: dto.academicYearId, label: 'Academic year' });
    if (session.academicYearId !== dto.academicYearId) {
      throw new BadRequestException('Academic year must match the session.');
    }
    if (dto.enquiryId) {
      const enquiry = await (this.tenantPrisma.client as Client).admissionEnquiry.findFirst({
        where: { id: dto.enquiryId },
      });
      if (!enquiry) throw new NotFoundException('Enquiry not found.');
    }

    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();
    const fullName = [firstName, dto.middleName, lastName].filter((p) => p && p.trim()).join(' ').trim();
    const applicationNumber = await this.generateApplicationNumber();

    const application = await (this.tenantPrisma.client as any).admissionApplication.create({
      data: {
        applicationNumber,
        sessionId: dto.sessionId,
        admissionProgramId: dto.admissionProgramId,
        campusId: dto.campusId,
        academicYearId: dto.academicYearId,
        enquiryId: dto.enquiryId ?? null,
        firstName,
        middleName: dto.middleName ?? null,
        lastName,
        fullName,
        gender: dto.gender ?? 'NOT_SPECIFIED',
        dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        email: dto.email ?? null,
        phone: dto.phone ?? null,
        category: dto.category ?? null,
        nationality: dto.nationality ?? 'Indian',
        addressLine1: dto.addressLine1 ?? null,
        addressLine2: dto.addressLine2 ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        postalCode: dto.postalCode ?? null,
        country: dto.country ?? 'India',
        guardian: (dto.guardian ?? null) as any,
        data: (dto.data ?? null) as any,
        remarks: dto.remarks ?? null,
        status: 'INITIATED',
        createdBy: userId,
        updatedBy: userId,
      },
    });
    if (dto.enquiryId) {
      await (this.tenantPrisma.client as any).admissionEnquiry.update({
        where: { id: dto.enquiryId },
        data: { convertedToApplicationId: application.id, convertedAt: new Date(), updatedBy: userId },
      });
    }
    const duplicateOf = await this.findDuplicateCandidate(application);
    if (duplicateOf) {
      await (this.tenantPrisma.client as any).admissionApplication.update({
        where: { id: application.id },
        data: { duplicateOfId: duplicateOf },
      });
      await this.logActivity(application.id, ADMISSION_EVENTS.DUPLICATE_DETECTED, 'Possible duplicate application', userId, `Matched existing application ${duplicateOf}`);
      await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_DUPLICATE_DETECTED, 'AdmissionApplication', application.id, {
        after: { duplicateOfId: duplicateOf },
      });
    }
    await this.logActivity(application.id, ADMISSION_EVENTS.APPLICATION_CREATED, 'Application created', userId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_APPLICATION_CREATED, 'AdmissionApplication', application.id, {
      after: { applicationNumber, fullName },
    });
    return this.getApplication(application.id, tenantId, userId);
  }

  async updateApplication(applicationId: string, tenantId: string, userId: string, dto: UpdateAdmissionApplicationDto) {
    const before = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (!['INITIATED', 'SUBMITTED', 'UNDER_VERIFICATION'].includes(before.status)) {
      throw new BadRequestException('Applications can only be edited while pending, submitted, or under verification.');
    }

    const firstName = (dto.firstName?.trim() || before.firstName);
    const lastName = (dto.lastName?.trim() || before.lastName);
    const middleName = dto.middleName !== undefined ? dto.middleName : before.middleName;
    const data: Record<string, any> = {
      firstName,
      lastName,
      middleName,
      fullName: [firstName, middleName, lastName].filter((p) => p && p.trim()).join(' ').trim(),
      gender: dto.gender ?? before.gender,
      dateOfBirth: dto.dateOfBirth !== undefined ? (dto.dateOfBirth ? new Date(dto.dateOfBirth) : null) : before.dateOfBirth,
      email: dto.email !== undefined ? dto.email : before.email,
      phone: dto.phone !== undefined ? dto.phone : before.phone,
      category: dto.category !== undefined ? dto.category : before.category,
      nationality: dto.nationality !== undefined ? dto.nationality : before.nationality,
      addressLine1: dto.addressLine1 !== undefined ? dto.addressLine1 : before.addressLine1,
      addressLine2: dto.addressLine2 !== undefined ? dto.addressLine2 : before.addressLine2,
      city: dto.city !== undefined ? dto.city : before.city,
      state: dto.state !== undefined ? dto.state : before.state,
      postalCode: dto.postalCode !== undefined ? dto.postalCode : before.postalCode,
      country: dto.country !== undefined ? dto.country : before.country,
      guardian: dto.guardian !== undefined ? ((dto.guardian ?? null) as any) : before.guardian,
      data: dto.data !== undefined ? ((dto.data ?? null) as any) : before.data,
      remarks: dto.remarks !== undefined ? dto.remarks : before.remarks,
      updatedBy: userId,
    };

    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data,
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.APPLICATION_UPDATED, 'Application details updated', userId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_APPLICATION_UPDATED, 'AdmissionApplication', applicationId, {
      before: { fullName: before.fullName, status: before.status },
      after: { fullName: application.fullName, status: application.status },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  async submitApplication(applicationId: string, tenantId: string, userId: string) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (app.status === 'SUBMITTED') return this.getApplication(applicationId, tenantId, userId);
    if (app.status !== 'INITIATED') throw new BadRequestException(`Cannot submit an application in status ${app.status}.`);

    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { status: 'SUBMITTED', submittedAt: new Date(), submittedBy: userId, updatedBy: userId },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.APPLICATION_SUBMITTED, 'Application submitted', userId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_APPLICATION_SUBMITTED, 'AdmissionApplication', applicationId, {
      before: { status: 'INITIATED' },
      after: { status: application.status },
    });
    await this.syncAdmissionWorkflow(tenantId, userId, applicationId, 'SUBMIT');
    await this.notifyStageChange(tenantId, app, 'Application submitted', `Application ${applicationId} was submitted and is pending review.`);
    return this.getApplication(applicationId, tenantId, userId);
  }

  async cancelApplication(applicationId: string, tenantId: string, userId: string, reason?: string) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (['ENROLLED', 'REJECTED', 'CANCELLED'].includes(app.status)) {
      throw new BadRequestException(`Application cannot be cancelled from status ${app.status}.`);
    }

    if (FEEDING_STATUSES.includes(app.status)) {
      await this.releaseSeat(app.admissionProgramId);
      const offer = app.offers?.find((o: any) => o.status === 'ISSUED');
      if (offer) {
        await (this.tenantPrisma.client as any).admissionOffer.update({
          where: { id: offer.id },
          data: { status: 'DECLINED', declinedAt: new Date(), remarks: reason ?? 'Application cancelled' },
        });
      }
    }

    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { status: 'CANCELLED', remarks: reason ?? app.remarks, updatedBy: userId },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.APPLICATION_CANCELLED, 'Application cancelled', userId, reason);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_APPLICATION_CANCELLED, 'AdmissionApplication', applicationId, {
      before: { status: app.status },
      after: { status: application.status, reason: reason ?? null },
    });
    await this.syncAdmissionWorkflow(tenantId, userId, applicationId, 'CANCEL');
    return this.getApplication(applicationId, tenantId, userId);
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  async createDocument(applicationId: string, tenantId: string, userId: string, dto: CreateApplicationDocumentDto) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (!['INITIATED', 'SUBMITTED', 'UNDER_VERIFICATION', 'DOCUMENTS_VERIFIED'].includes(app.status)) {
      throw new BadRequestException('Documents can only be attached before the applicant is shortlisted.');
    }
    const session = app.session as any;
    const required = session?.requiredDocuments?.length ? session.requiredDocuments : DEFAULT_DOCUMENT_CHECKLIST;
    const normalizedCategory = dto.category.trim().toUpperCase();
    if (!(required as string[]).includes(normalizedCategory)) {
      throw new BadRequestException(`"${dto.category}" is not in the session's document checklist (${required.join(', ')}).`);
    }

    const document = await (this.tenantPrisma.client as any).admissionDocument.create({
      data: {
        applicationId,
        category: normalizedCategory,
        documentName: dto.documentName.trim(),
        storageKey: dto.storageKey ?? null,
        originalFilename: dto.originalFilename ?? null,
        mimeType: dto.mimeType ?? null,
        sizeBytes: dto.sizeBytes ?? null,
        status: 'PENDING',
        uploadedBy: userId,
      },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.DOCUMENT_UPLOADED, `Document uploaded: ${normalizedCategory}`, userId, dto.documentName, 'AdmissionDocument', document.id);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_DOCUMENT_UPLOADED, 'AdmissionDocument', document.id, {
      after: { applicationId, category: normalizedCategory, documentName: dto.documentName },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  async updateDocument(documentId: string, tenantId: string, userId: string, dto: UpdateApplicationDocumentDto) {
    const document = await this.assertDocument(documentId);
    await (this.tenantPrisma.client as any).admissionDocument.update({
      where: { id: documentId },
      data: {
        documentName: dto.documentName ?? document.documentName,
        remarks: dto.remarks !== undefined ? dto.remarks : document.remarks,
      },
    });
    await this.logActivity(document.applicationId, ADMISSION_EVENTS.DOCUMENT_UPDATED, 'Document updated', userId, undefined, 'AdmissionDocument', documentId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_DOCUMENT_UPDATED, 'AdmissionDocument', documentId, {
      before: { documentName: document.documentName },
      after: { documentName: dto.documentName ?? document.documentName },
    });
    return this.getApplication(document.applicationId, tenantId, userId);
  }

  async verifyDocument(documentId: string, tenantId: string, userId: string, dto: DocumentDecisionDto) {
    const document = await this.assertDocument(documentId);
    const updated = await (this.tenantPrisma.client as any).admissionDocument.update({
      where: { id: documentId },
      data: { status: 'VERIFIED', verifiedAt: new Date(), verifiedBy: userId, remarks: dto.remarks ?? document.remarks },
    });
    await this.logActivity(document.applicationId, ADMISSION_EVENTS.DOCUMENT_VERIFIED, `Document verified: ${document.category}`, userId, dto.remarks, 'AdmissionDocument', documentId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_DOCUMENT_VERIFIED, 'AdmissionDocument', documentId, {
      before: { status: document.status },
      after: { status: updated.status },
    });
    return this.getApplication(document.applicationId, tenantId, userId);
  }

  async rejectDocument(documentId: string, tenantId: string, userId: string, dto: DocumentDecisionDto) {
    if (!dto.remarks?.trim()) throw new BadRequestException('A rejection reason is required.');
    const document = await this.assertDocument(documentId);
    const updated = await (this.tenantPrisma.client as any).admissionDocument.update({
      where: { id: documentId },
      data: { status: 'REJECTED', verifiedAt: new Date(), verifiedBy: userId, remarks: dto.remarks.trim() },
    });
    await this.logActivity(document.applicationId, ADMISSION_EVENTS.DOCUMENT_REJECTED, `Document rejected: ${document.category}`, userId, dto.remarks, 'AdmissionDocument', documentId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_DOCUMENT_REJECTED, 'AdmissionDocument', documentId, {
      before: { status: document.status },
      after: { status: updated.status, remarks: dto.remarks },
    });
    return this.getApplication(document.applicationId, tenantId, userId);
  }

  async deleteDocument(documentId: string, tenantId: string, userId: string) {
    const document = await this.assertDocument(documentId);
    await (this.tenantPrisma.client as any).admissionDocument.delete({ where: { id: documentId } });
    await this.logActivity(document.applicationId, ADMISSION_EVENTS.DOCUMENT_UPLOADED.replace('uploaded', 'deleted'), 'Document deleted', userId, document.documentName, 'AdmissionDocument', documentId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_DOCUMENT_DELETED, 'AdmissionDocument', documentId, {
      before: { category: document.category, documentName: document.documentName },
    });
    return this.getApplication(document.applicationId, tenantId, userId);
  }

  private async assertDocument(documentId: string) {
    const document = await (this.tenantPrisma.client as Client).admissionDocument.findFirst({
      where: { id: documentId },
      include: { application: { select: { id: true, status: true } } },
    });
    if (!document) throw new NotFoundException('Document not found.');
    return document;
  }

  // ── Qualifications ────────────────────────────────────────────────────────

  async createQualification(applicationId: string, tenantId: string, userId: string, dto: CreateQualificationDto) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (app.documents && !['INITIATED', 'SUBMITTED', 'UNDER_VERIFICATION', 'DOCUMENTS_VERIFIED'].includes(app.status)) {
      throw new BadRequestException('Qualifications can only be edited before the merit list is published.');
    }
    const qualification = await (this.tenantPrisma.client as any).admissionQualification.create({
      data: {
        applicationId,
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
        remarks: dto.remarks ?? null,
        createdBy: userId,
      },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.QUALIFICATION_CREATED, `Qualification added: ${dto.institution}`, userId, undefined, 'AdmissionQualification', qualification.id);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_QUALIFICATION_CREATED, 'AdmissionQualification', qualification.id, {
      after: { applicationId, institution: dto.institution },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  async updateQualification(qualificationId: string, tenantId: string, userId: string, dto: UpdateQualificationDto) {
    const before = await (this.tenantPrisma.client as Client).admissionQualification.findFirst({ where: { id: qualificationId } });
    if (!before) throw new NotFoundException('Qualification not found.');
    const qualification = await (this.tenantPrisma.client as any).admissionQualification.update({
      where: { id: qualificationId },
      data: { ...dto, remarks: dto.remarks ?? before.remarks },
    });
    await this.logActivity(before.applicationId, ADMISSION_EVENTS.QUALIFICATION_CREATED, 'Qualification updated', userId, undefined, 'AdmissionQualification', qualificationId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_QUALIFICATION_UPDATED, 'AdmissionQualification', qualificationId, {
      before: { institution: before.institution },
      after: { institution: qualification.institution },
    });
    return this.getApplication(before.applicationId, tenantId, userId);
  }

  async deleteQualification(qualificationId: string, tenantId: string, userId: string) {
    const before = await (this.tenantPrisma.client as Client).admissionQualification.findFirst({ where: { id: qualificationId } });
    if (!before) throw new NotFoundException('Qualification not found.');
    await (this.tenantPrisma.client as any).admissionQualification.delete({ where: { id: qualificationId } });
    await this.logActivity(before.applicationId, ADMISSION_EVENTS.QUALIFICATION_UPDATED, 'Qualification removed', userId, before.institution, 'AdmissionQualification', qualificationId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_QUALIFICATION_DELETED, 'AdmissionQualification', qualificationId, {
      before: { institution: before.institution },
    });
    return this.getApplication(before.applicationId, tenantId, userId);
  }

  // ── Verification / merit ──────────────────────────────────────────────────

  async completeVerification(applicationId: string, tenantId: string, userId: string) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (app.status === 'DOCUMENTS_VERIFIED') return this.getApplication(applicationId, tenantId, userId);
    if (!['SUBMITTED', 'UNDER_VERIFICATION', 'DOCUMENTS_VERIFIED'].includes(app.status)) {
      throw new BadRequestException(`Verification can only run on submitted applications (got ${app.status}).`);
    }

    const session = app.session as any;
    const required = (session?.requiredDocuments?.length ? session.requiredDocuments : DEFAULT_DOCUMENT_CHECKLIST) as string[];
    const verifiedCategories = new Set(
      (app.documents ?? []).filter((d: any) => d.status === 'VERIFIED').map((d: any) => d.category),
    );
    const missing = required.filter((c) => !verifiedCategories.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(`Document verification incomplete — missing verified documents: ${missing.join(', ')}.`);
    }

    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { status: 'DOCUMENTS_VERIFIED', updatedBy: userId },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.VERIFICATION_COMPLETED, 'Documents verified', userId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_VERIFICATION_COMPLETED, 'AdmissionApplication', applicationId, {
      before: { status: app.status },
      after: { status: application.status, requiredDocuments: required },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  async scoreApplication(applicationId: string, tenantId: string, userId: string, dto: ScoreAdmissionApplicationDto) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (!['DOCUMENTS_VERIFIED', 'MERIT_LISTED'].includes(app.status)) {
      throw new BadRequestException('Applications must have verified documents before scoring.');
    }
    let score = dto.meritScore;
    if (dto.auto || score === undefined) {
      const computed = this.computeMeritScore(app);
      if (computed === null) {
        throw new BadRequestException('Cannot auto-score this application — add a highest qualification with a percentage, GPA, or marks.');
      }
      score = computed;
    }
    score = Math.max(0, Math.min(100, Number(score)));

    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { meritScore: score, updatedBy: userId },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.MERIT_SCORED, `Merit score set: ${score}`, userId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_MERIT_SCORED, 'AdmissionApplication', applicationId, {
      before: { meritScore: app.meritScore },
      after: { meritScore: application.meritScore },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  /** Computes a merit score from the highest qualification: percentage, marks ratio, or GPA. */
  private computeMeritScore(app: any): number | null {
    const records = (app.qualifications ?? []) as any[];
    const highest = records.find((r) => r.isHighestQualification) ?? records[0];
    if (!highest) return null;
    if (typeof highest.percentage === 'number') return highest.percentage;
    if (highest.marksOutOf && highest.marksObtained !== undefined && highest.marksObtained !== null) {
      return (highest.marksObtained / highest.marksOutOf) * 100;
    }
    if (typeof highest.gpa === 'number') return (highest.gpa / 10) * 100;
    return null;
  }

  async publishMerit(tenantId: string, userId: string, sessionId: string) {
    const session = await (this.tenantPrisma.client as Client).admissionSession.findFirst({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Admission session not found.');

    const scorable = await (this.tenantPrisma.client as Client).admissionApplication.findMany({
      where: {
        sessionId,
        status: { in: ['DOCUMENTS_VERIFIED', 'MERIT_LISTED', 'COUNSELLING_SCHEDULED', 'COUNSELLED', 'SELECTED', 'WAITLISTED'] },
        meritScore: { not: null },
      },
      select: { id: true, meritScore: true },
      orderBy: [{ meritScore: 'desc' }, { createdAt: 'asc' }],
    });

    const rankMap = new Map<string, number>();
    scorable.forEach((row, index) => rankMap.set(row.id, index + 1));

    for (const row of scorable) {
      await (this.tenantPrisma.client as any).admissionApplication.update({
        where: { id: row.id },
        data: { meritRank: rankMap.get(row.id), status: 'MERIT_LISTED', updatedBy: userId },
      });
    }

    const updated = await (this.tenantPrisma.client as any).admissionSession.update({
      where: { id: sessionId },
      data: { meritPublishedAt: new Date(), updatedBy: userId },
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_SESSION_MERIT_PUBLISHED, 'AdmissionSession', sessionId, {
      after: { ranked: scorable.length, publishedAt: updated.meritPublishedAt },
    });
    return { sessionId, ranked: scorable.length, publishedAt: updated.meritPublishedAt };
  }

  // ── Counselling ───────────────────────────────────────────────────────────

  async createCounsellingSlot(tenantId: string, userId: string, dto: CreateCounsellingSlotDto) {
    await this.assertRef({ model: 'admissionSession', id: dto.sessionId, label: 'Admission session' });
    if (dto.programId) await this.assertRef({ model: 'program', id: dto.programId, label: 'Program' });
    const slot = await (this.tenantPrisma.client as any).admissionCounsellingSlot.create({
      data: {
        sessionId: dto.sessionId,
        programId: dto.programId ?? null,
        date: new Date(dto.date),
        venue: dto.venue ?? null,
        capacity: dto.capacity ?? 1,
        bookedCount: 0,
        createdBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_COUNSELLING_SLOT_CREATED, 'AdmissionCounsellingSlot', slot.id, {
      after: { sessionId: dto.sessionId, date: slot.date },
    });
    return slot;
  }

  async updateCounsellingSlot(tenantId: string, userId: string, slotId: string, dto: UpdateCounsellingSlotDto) {
    const before = await this.assertSlot(slotId);
    const capacity = dto.capacity ?? before.capacity;
    if (capacity < before.bookedCount) {
      throw new BadRequestException('Capacity cannot be reduced below the number of booked applicants.');
    }
    const slot = await (this.tenantPrisma.client as any).admissionCounsellingSlot.update({
      where: { id: slotId },
      data: {
        date: dto.date ? new Date(dto.date) : before.date,
        venue: dto.venue !== undefined ? dto.venue : before.venue,
        capacity,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_COUNSELLING_SLOT_UPDATED, 'AdmissionCounsellingSlot', slotId, {
      before: { capacity: before.capacity },
      after: { capacity: slot.capacity },
    });
    return slot;
  }

  async listCounsellingSlots(tenantId: string, sessionId?: string, programId?: string) {
    return (this.tenantPrisma.client as Client).admissionCounsellingSlot.findMany({
      where: sessionId ? { sessionId, ...(programId ? { programId } : {}) } : {},
      orderBy: { date: 'asc' },
      include: { session: { select: { id: true, code: true, name: true } }, program: { select: { id: true, code: true, name: true } } },
    });
  }

  async bookCounselling(applicationId: string, tenantId: string, userId: string, slotId: string) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (!['MERIT_LISTED', 'COUNSELLING_SCHEDULED', 'DOCUMENTS_VERIFIED'].includes(app.status)) {
      throw new BadRequestException('Only merit-listed applications can book counselling.');
    }
    const slot = await this.assertSlot(slotId);
    if (slot.sessionId !== app.sessionId) throw new BadRequestException('The slot belongs to a different admission session.');
    if (slot.bookedCount >= slot.capacity) throw new ConflictException('This counselling slot is full.');
    if (slot.date < new Date()) throw new BadRequestException('Cannot book a counselling slot in the past.');

    if (app.counsellingSlotId && app.counsellingSlotId !== slotId) {
      const oldSlot = await (this.tenantPrisma.client as Client).admissionCounsellingSlot.findFirst({
        where: { id: app.counsellingSlotId },
      });
      if (oldSlot) {
        await (this.tenantPrisma.client as any).admissionCounsellingSlot.update({
          where: { id: oldSlot.id },
          data: { bookedCount: Math.max(0, oldSlot.bookedCount - 1) },
        });
      }
    }

    await (this.tenantPrisma.client as any).admissionCounsellingSlot.update({
      where: { id: slotId },
      data: { bookedCount: slot.bookedCount + 1 },
    });
    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { counsellingSlotId: slotId, status: 'COUNSELLING_SCHEDULED', updatedBy: userId },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.COUNSELLING_BOOKED, `Counselling booked: ${slot.date.toISOString().slice(0, 10)}`, userId, slot.venue ?? undefined, 'AdmissionCounsellingSlot', slotId);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_COUNSELLING_BOOKED, 'AdmissionApplication', applicationId, {
      before: { status: app.status },
      after: { status: application.status, slotId },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  async counselled(applicationId: string, tenantId: string, userId: string, decision: 'SELECTED' | 'WAITLISTED' | 'REJECTED', remarks?: string) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (app.status === 'CANCELLED' || app.status === 'ENROLLED' || app.status === 'REJECTED') {
      throw new BadRequestException(`Cannot record a counselling decision on status ${app.status}.`);
    }

    const action =
      decision === 'SELECTED' ? AUDIT_ACTIONS.ADMISSION_SELECTED
      : decision === 'WAITLISTED' ? AUDIT_ACTIONS.ADMISSION_WAITLISTED
      : AUDIT_ACTIONS.ADMISSION_COUNSELLED;

    const data: Record<string, any> = {
      counselledAt: new Date(),
      updatedBy: userId,
    };
    if (decision === 'SELECTED') {
      data.status = 'SELECTED';
      data.selectedAt = new Date();
      data.rejectedReason = null;
    } else if (decision === 'WAITLISTED') {
      data.status = 'WAITLISTED';
      data.selectedAt = null;
    } else {
      data.status = 'REJECTED';
      data.rejectedReason = remarks ?? null;
    }

    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data,
    });
    const event = decision === 'SELECTED' ? ADMISSION_EVENTS.SELECTED : decision === 'WAITLISTED' ? ADMISSION_EVENTS.WAITLISTED : ADMISSION_EVENTS.COUNSELLED;
    await this.logActivity(applicationId, ADMISSION_EVENTS.COUNSELLED, `Counselling recorded: ${decision}`, userId, remarks);
    if (event !== ADMISSION_EVENTS.COUNSELLED) {
      await this.logActivity(applicationId, event, decision === 'SELECTED' ? 'Selected for admission' : 'Waitlisted', userId, remarks);
    }
    await this.audit(tenantId, userId, action, 'AdmissionApplication', applicationId, {
      before: { status: app.status },
      after: { status: application.status, remarks: remarks ?? null },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  // ── Offers ────────────────────────────────────────────────────────────────

  async issueOffer(applicationId: string, tenantId: string, userId: string, dto: IssueOfferDto) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (!['SELECTED', 'OFFERED'].includes(app.status)) {
      throw new BadRequestException(`Offers can only be issued to selected applicants (got ${app.status}).`);
    }

    const offer = app.admissionProgram as any;
    if (offer.seats > 0 && offer.filledSeats >= offer.seats) {
      await (this.tenantPrisma.client as any).admissionProgramOffer.update({
        where: { id: offer.id },
        data: { status: 'FULL' },
      });
      throw new ConflictException('This program has no remaining seats.');
    }

    const fee = dto.admissionFeeCents !== undefined ? dto.admissionFeeCents : (offer.admissionFeeCents ?? 0);
    const issuedAt = new Date();
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : new Date(issuedAt.getTime() + OFFER_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
    const offerNumber = await this.generateNumber(OFFER_NUMBER_PREFIX);

    const created = await (this.tenantPrisma.client as any).admissionOffer.create({
      data: {
        applicationId,
        offerNumber,
        admissionFeeCents: fee,
        issuedAt,
        expiresAt,
        status: 'ISSUED',
        remarks: dto.remarks ?? null,
        createdBy: userId,
      },
    });
    const program = await (this.tenantPrisma.client as any).admissionProgramOffer.update({
      where: { id: offer.id },
      data: { filledSeats: offer.filledSeats + 1, status: offer.seats > 0 && offer.filledSeats + 1 >= offer.seats ? 'FULL' : 'OPEN' },
    });
    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { status: 'OFFERED', updatedBy: userId },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.OFFER_ISSUED, `Offer letter issued: ${offerNumber}`, userId, `Admission fee ${fee}`, 'AdmissionOffer', created.id);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_OFFER_ISSUED, 'AdmissionOffer', created.id, {
      after: { applicationId, offerNumber, admissionFeeCents: fee, expiresAt, seatsLeft: program.seats - program.filledSeats },
    });
    void application;
    return this.getApplication(applicationId, tenantId, userId);
  }

  async acceptOffer(offerId: string, tenantId: string, userId: string, remarks?: string) {
    const offer = await (this.tenantPrisma.client as Client).admissionOffer.findFirst({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Offer not found.');
    if (offer.status === 'ACCEPTED') return this.getApplication(offer.applicationId, tenantId, userId);
    if (offer.status !== 'ISSUED') throw new BadRequestException(`Offer is ${offer.status}, not issuable.`);
    if (offer.expiresAt < new Date()) {
      await (this.tenantPrisma.client as any).admissionOffer.update({ where: { id: offerId }, data: { status: 'EXPIRED' } });
      throw new BadRequestException('This offer has expired.');
    }

    await (this.tenantPrisma.client as any).admissionOffer.update({
      where: { id: offerId },
      data: { status: 'ACCEPTED', acceptedAt: new Date(), remarks: remarks ?? offer.remarks },
    });
    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: offer.applicationId },
      data: { status: 'OFFER_ACCEPTED', updatedBy: userId },
    });
    await this.logActivity(offer.applicationId, ADMISSION_EVENTS.OFFER_ACCEPTED, `Offer accepted: ${offer.offerNumber}`, userId, remarks);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_OFFER_ACCEPTED, 'AdmissionOffer', offerId, {
      before: { status: 'ISSUED' },
      after: { status: 'ACCEPTED', applicationStatus: application.status },
    });
    return this.getApplication(offer.applicationId, tenantId, userId);
  }

  async declineOffer(offerId: string, tenantId: string, userId: string, remarks?: string) {
    const offer = await (this.tenantPrisma.client as Client).admissionOffer.findFirst({ where: { id: offerId } });
    if (!offer) throw new NotFoundException('Offer not found.');
    if (offer.status === 'DECLINED') return this.getApplication(offer.applicationId, tenantId, userId);
    if (offer.status !== 'ISSUED') throw new BadRequestException(`Offer is ${offer.status}, not declinable.`);

    await (this.tenantPrisma.client as any).admissionOffer.update({
      where: { id: offerId },
      data: { status: 'DECLINED', declinedAt: new Date(), remarks: remarks ?? offer.remarks },
    });
    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: offer.applicationId },
      data: { status: 'SELECTED', updatedBy: userId },
    });
    await this.releaseSeat(offer.applicationId);
    await this.logActivity(offer.applicationId, ADMISSION_EVENTS.OFFER_DECLINED, `Offer declined: ${offer.offerNumber}`, userId, remarks);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_OFFER_DECLINED, 'AdmissionOffer', offerId, {
      before: { status: 'ISSUED' },
      after: { status: 'DECLINED', applicationStatus: application.status },
    });
    return this.getApplication(offer.applicationId, tenantId, userId);
  }

  private async releaseSeat(applicationId: string) {
    const app = await (this.tenantPrisma.client as Client).admissionApplication.findFirst({
      where: { id: applicationId },
      select: { admissionProgramId: true, admissionProgram: true },
    });
    if (!app?.admissionProgramId) return;
    const offer = app.admissionProgram;
    if (offer.filledSeats > 0) {
      await (this.tenantPrisma.client as any).admissionProgramOffer.update({
        where: { id: offer.id },
        data: { filledSeats: offer.filledSeats - 1, status: 'OPEN' },
      });
    }
  }

  // ── Admission fee ─────────────────────────────────────────────────────────

  async payAdmissionFee(applicationId: string, tenantId: string, userId: string, dto: PayAdmissionFeeDto) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (app.status !== 'OFFER_ACCEPTED') {
      throw new BadRequestException('The admission fee can only be paid after the offer is accepted.');
    }
    const offer = (app.offers as any[]).find((o) => o.status === 'ACCEPTED') ?? (app.offers as any[]).slice(-1)[0];
    if (!offer) throw new BadRequestException('No accepted offer found for fee collection.');
    const amount = dto.amountCents ?? offer.admissionFeeCents;
    if (!amount || amount <= 0) {
      throw new BadRequestException('No admission fee is due — enroll directly.');
    }

    const receiptNumber = await this.generateNumber(RECEIPT_NUMBER_PREFIX);
    const payment = await (this.tenantPrisma.client as any).admissionFeePayment.create({
      data: {
        applicationId,
        amountCents: amount,
        currency: 'INR',
        paymentDate: dto.paymentDate ? new Date(dto.paymentDate) : new Date(),
        method: dto.method,
        status: 'SUCCEEDED',
        referenceNumber: dto.referenceNumber ?? null,
        receiptNumber,
        remarks: dto.remarks ?? null,
        recordedByUserId: userId,
      },
    });
    const application = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { status: 'FEE_PAID', feePaidAt: new Date(), feeReceiptNumber: receiptNumber, updatedBy: userId },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.FEE_PAID, `Admission fee paid: ${amount}`, userId, `Receipt ${receiptNumber}`, 'AdmissionFeePayment', payment.id);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_FEE_PAID, 'AdmissionFeePayment', payment.id, {
      after: { applicationId, amountCents: amount, receiptNumber, applicationStatus: application.status },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  // ── Enrollment (auto-creates the Student) ────────────────────────────────

  async enroll(applicationId: string, tenantId: string, userId: string, dto: EnrollApplicationDto) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (app.status === 'ENROLLED') throw new ConflictException('This applicant is already enrolled.');
    if (app.status !== 'FEE_PAID' && app.status !== 'OFFER_ACCEPTED') {
      throw new BadRequestException(`Enrollment requires a paid fee (got ${app.status}).`);
    }
    if (app.status === 'OFFER_ACCEPTED') {
      const fee = ((app.offers as any[]).find((o) => o.status === 'ACCEPTED')?.admissionFeeCents ?? 0) as number;
      if (fee > 0) throw new BadRequestException('The admission fee must be paid before enrollment.');
    }

    const offerRow = app.admissionProgram as any;
    const programId = offerRow.programId as string;
    const sectionId = dto.sectionId ?? null;
    const rollNumber = dto.rollNumber ?? null;

    return this.tenantPrisma.client.$transaction(async (tx: any) => {
      const student = await tx.student.create({
        data: {
          campusId: app.campusId,
          admissionNumber: app.applicationNumber,
          rollNumber,
          firstName: app.firstName,
          middleName: app.middleName,
          lastName: app.lastName,
          fullName: app.fullName,
          gender: app.gender,
          dateOfBirth: app.dateOfBirth,
          email: app.email,
          primaryPhone: app.phone,
          category: app.category,
          nationality: app.nationality,
          currentAddressLine1: app.addressLine1,
          currentAddressLine2: app.addressLine2,
          city: app.city,
          state: app.state,
          postalCode: app.postalCode,
          country: app.country,
          status: 'ENROLLED',
          programId,
          sectionId,
          academicYearId: app.academicYearId,
          admittedOn: new Date(),
          yearOfAdmission: new Date().getFullYear(),
          createdBy: userId,
          updatedBy: userId,
        },
      });

      await tx.studentAdmission.create({
        data: {
          studentId: student.id,
          applicationNumber: app.applicationNumber,
          programId,
          academicYearId: app.academicYearId,
          appliedAt: app.submittedAt ?? app.createdAt,
          status: 'ENROLLED',
          mode: 'MERIT',
          admissionFeeCents: ((app.offers as any[]).find((o) => o.status === 'ACCEPTED')?.admissionFeeCents ?? null) as number | null,
          remarks: dto.remarks ?? null,
          createdBy: userId,
        },
      });

      await tx.studentEnrollment.create({
        data: {
          studentId: student.id,
          academicYearId: app.academicYearId,
          programId,
          sectionId: sectionId ?? undefined,
          batchId: dto.batchId ?? undefined,
          rollNumber: rollNumber ?? undefined,
          semester: 1,
          status: 'ACTIVE',
          enrolledAt: new Date(),
          remarks: dto.remarks ?? null,
          createdBy: userId,
        },
      });

      const guardian = app.guardian as any;
      if (guardian && guardian.name) {
        await tx.guardian.create({
          data: {
            studentId: student.id,
            name: guardian.name,
            kind: guardian.kind ?? 'GUARDIAN',
            role: guardian.role ?? 'PRIMARY',
            phone: guardian.phone ?? null,
            email: guardian.email ?? null,
            occupation: guardian.occupation ?? null,
            createdBy: userId,
            updatedBy: userId,
          },
        });
      }

      for (const doc of (app.documents ?? []) as any[]) {
        await tx.studentDocument.create({
          data: {
            studentId: student.id,
            category: doc.category,
            documentName: doc.documentName,
            storageKey: doc.storageKey,
            originalFilename: doc.originalFilename,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            status: doc.status,
            verifiedAt: doc.verifiedAt,
            verifiedBy: doc.verifiedBy,
            remarks: doc.remarks,
            uploadedBy: doc.uploadedBy,
          },
        });
      }

      for (const q of (app.qualifications ?? []) as any[]) {
        await tx.studentAcademicRecord.create({
          data: {
            studentId: student.id,
            institution: q.institution,
            board: q.board,
            degree: q.degree,
            yearOfPassing: q.yearOfPassing,
            percentage: q.percentage,
            gpa: q.gpa,
            grade: q.grade,
            marksObtained: q.marksObtained,
            marksOutOf: q.marksOutOf,
            rank: q.rank,
            isHighestQualification: q.isHighestQualification,
            verificationStatus: q.verificationStatus,
            remarks: q.remarks,
            createdBy: userId,
          },
        });
      }

      const acceptedOffer = (app.offers as any[]).find((o) => o.status === 'ACCEPTED');
      const payments = (app.payments ?? []) as any[];
      if ((acceptedOffer?.admissionFeeCents ?? 0) > 0 || payments.length > 0) {
        const totalPaid = payments.filter((p) => p.status === 'SUCCEEDED').reduce((s, p) => s + p.amountCents, 0);
        const fee = await tx.studentFee.create({
          data: {
            studentId: student.id,
            headCode: 'ADMISSION_FEE',
            headName: 'Admission Fee',
            amountCents: acceptedOffer?.admissionFeeCents ?? totalPaid,
            paidCents: totalPaid,
            waivedCents: 0,
            status: totalPaid >= (acceptedOffer?.admissionFeeCents ?? totalPaid) ? 'PAID' : 'ISSUED',
            dueDate: (acceptedOffer?.expiresAt ?? null) as Date | null,
            remarks: `Migrated from admission application ${app.applicationNumber}`,
            createdBy: userId,
            updatedBy: userId,
          },
        });
        for (const p of payments) {
          await tx.studentPayment.create({
            data: {
              studentId: student.id,
              studentFeeId: fee.id,
              receiptNumber: p.receiptNumber,
              amountCents: p.amountCents,
              currency: p.currency,
              paymentDate: p.paymentDate,
              method: p.method,
              status: p.status,
              referenceNumber: p.referenceNumber,
              recordedByUserId: p.recordedByUserId ?? userId,
              remarks: p.remarks,
            },
          });
        }
      }

      await tx.studentActivity.create({
        data: {
          studentId: student.id,
          eventType: 'enrollment.enrolled',
          title: 'Enrolled via admissions pipeline',
          description: `Application ${app.applicationNumber}`,
          entityType: 'AdmissionApplication',
          entityId: applicationId,
          actorUserId: userId,
        },
      });

      await tx.admissionApplication.update({
        where: { id: applicationId },
        data: {
          status: 'ENROLLED',
          enrolledStudentId: student.id,
          enrolledAt: new Date(),
          updatedBy: userId,
        },
      });

      await tx.admissionActivity.create({
        data: {
          applicationId,
          eventType: ADMISSION_EVENTS.ENROLLED,
          title: 'Enrolled',
          description: `Student ${student.admissionNumber} created`,
          entityType: 'Student',
          entityId: student.id,
          actorUserId: userId,
        },
      });

      return { studentId: student.id, admissionNumber: student.admissionNumber, applicationId };
    }).then(async (result) => {
      await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_ENROLLED, 'AdmissionApplication', applicationId, {
        after: { ...result },
      });
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId: userId,
        action: AUDIT_ACTIONS.STUDENT_ENROLLED,
        module: 'students',
        entityType: 'Student',
        entityId: result.studentId,
        after: { admissionNumber: result.admissionNumber, via: 'admissions' },
      });
      return result;
    });
  }

  // ── Dynamic form definition ───────────────────────────────────────────────

  async formDefinition(tenantId: string, sessionId: string, programId?: string) {
    const session = await (this.tenantPrisma.client as Client).admissionSession.findFirst({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Admission session not found.');

    let applicationFeeCents = session.applicationFeeCents;
    let admissionFeeCents = session.admissionFeeCents;
    let requiredDocuments = (session.requiredDocuments as string[]) ?? ([...DEFAULT_DOCUMENT_CHECKLIST] as string[]);
    if (programId) {
      const offer = await (this.tenantPrisma.client as Client).admissionProgramOffer.findFirst({
        where: { id: programId, sessionId },
      });
      if (offer) {
        applicationFeeCents = offer.applicationFeeCents;
        admissionFeeCents = offer.admissionFeeCents;
        if (offer.requiredDocuments) requiredDocuments = offer.requiredDocuments as string[];
      }
    }

    const configuredFields = await (this.tenantPrisma.client as Client).admissionFormField.findMany({
      where: { sessionId, isActive: true },
      orderBy: { sequenceOrder: 'asc' },
    });
    const hasConfiguredFields = configuredFields.length > 0;
    const fields = hasConfiguredFields
      ? configuredFields.map((field) => ({
          key: field.code,
          label: field.label,
          type: this.mapFieldType(field.fieldType),
          required: field.required,
          options: (field.options as string[] | null) ?? undefined,
        }))
      : ADMISSION_FORM_FIELDS;

    return {
      sessionId,
      fields,
      configurable: hasConfiguredFields,
      documentChecklist: requiredDocuments,
      applicationFeeCents,
      admissionFeeCents,
      sessionOpen: session.status === 'OPEN',
    };
  }

  /** Maps a configurable AdmissionFieldType to the form-shape type the web form understands. */
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

  // ── Dashboard / reports / exports ─────────────────────────────────────────

  async dashboard(tenantId: string, userId: string, sessionId?: string) {
    const scope = await this.applicationScope(tenantId, userId);
    const sessionWhere = sessionId ? { id: sessionId } : {};
    const where: Record<string, any> = {};
    if (scope) Object.assign(where, scope);
    if (sessionId) where.sessionId = sessionId;

    const [activeSessions, totalEnquiries, statusBuckets, seatRows, recent] = await Promise.all([
      (this.tenantPrisma.client as Client).admissionSession.count({ where: { ...sessionWhere, status: 'OPEN' } }),
      (this.tenantPrisma.client as Client).admissionEnquiry.count({ where: sessionId ? { sessionId } : {} }),
      (this.tenantPrisma.client as Client).admissionApplication.groupBy({ by: ['status'], where, _count: { _all: true } }),
      (this.tenantPrisma.client as Client).admissionProgramOffer.aggregate({
        where: sessionId ? { sessionId } : {},
        _sum: { seats: true, filledSeats: true },
      }),
      (this.tenantPrisma.client as Client).admissionApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          session: { select: { id: true, code: true, name: true, status: true } },
          admissionProgram: { select: { id: true, program: { select: { id: true, name: true } } } },
          campus: { select: { id: true, name: true } },
        },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const row of statusBuckets) byStatus[row.status] = row._count._all;
    const byStage = this.stageCounts(byStatus);

    return {
      activeSessions,
      totalEnquiries,
      applications: {
        total: Object.values(byStatus).reduce((s, n) => s + n, 0),
        submitted: byStatus['SUBMITTED'] ?? 0,
        verified: byStatus['DOCUMENTS_VERIFIED'] ?? 0,
        meritListed: byStatus['MERIT_LISTED'] ?? 0,
        selected: byStatus['SELECTED'] ?? 0,
        offered: byStatus['OFFERED'] ?? 0,
        feePaid: byStatus['FEE_PAID'] ?? 0,
        enrolled: byStatus['ENROLLED'] ?? 0,
        rejected: (byStatus['REJECTED'] ?? 0) + (byStatus['CANCELLED'] ?? 0),
      },
      byStage,
      seats: {
        total: seatRows._sum.seats ?? 0,
        filled: seatRows._sum.filledSeats ?? 0,
      },
      recentApplications: recent,
    };
  }

  private stageCounts(byStatus: Record<string, number>): Record<string, number> {
    const stages: Record<string, number> = {
      enquiry: 0,
      application: 0,
      documents: 0,
      verification: 0,
      merit: 0,
      counselling: 0,
      offer: 0,
      payment: 0,
      enrollment: 0,
      closed: 0,
    };
    const mapping: Record<string, string> = {
      INITIATED: 'application',
      SUBMITTED: 'document',
      UNDER_VERIFICATION: 'verification',
      DOCUMENTS_VERIFIED: 'verification',
      MERIT_LISTED: 'merit',
      COUNSELLING_SCHEDULED: 'counselling',
      COUNSELLED: 'counselling',
      SELECTED: 'offer',
      OFFERED: 'offer',
      OFFER_ACCEPTED: 'offer',
      FEE_PAID: 'payment',
      ENROLLED: 'enrollment',
      WAITLISTED: 'closed',
      REJECTED: 'closed',
      CANCELLED: 'closed',
    };
    for (const [status, count] of Object.entries(byStatus)) {
      const stage = mapping[status];
      if (stage) stages[stage] = (stages[stage] ?? 0) + count;
    }
    return stages;
  }

  async sessionReport(tenantId: string, userId: string, sessionId?: string) {
    const sessions = await (this.tenantPrisma.client as Client).admissionSession.findMany({
      where: sessionId ? { id: sessionId } : {},
      orderBy: { createdAt: 'desc' },
      include: { academicYear: true, programs: { select: { id: true, seats: true, filledSeats: true } } },
    });

    const out: any[] = [];
    for (const session of sessions) {
      const [applications, enrolled] = await Promise.all([
        (this.tenantPrisma.client as Client).admissionApplication.count({ where: { sessionId: session.id } }),
        (this.tenantPrisma.client as Client).admissionApplication.count({ where: { sessionId: session.id, status: 'ENROLLED' } }),
      ]);
      out.push({
        id: session.id,
        code: session.code,
        name: session.name,
        status: session.status,
        academicYear: session.academicYear.code,
        applications,
        enrolled,
        seats: session.programs.reduce((s, p) => s + p.seats, 0),
        filledSeats: session.programs.reduce((s, p) => s + p.filledSeats, 0),
        meritPublishedAt: session.meritPublishedAt,
      });
    }
    return out;
  }

  async pipelineReport(tenantId: string, userId: string, sessionId: string) {
    const session = await (this.tenantPrisma.client as Client).admissionSession.findFirst({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Admission session not found.');
    const scope = await this.applicationScope(tenantId, userId);
    const scopeWhere: Record<string, any> = {};
    if (scope) Object.assign(scopeWhere, scope);
    scopeWhere.sessionId = sessionId;

    const [statusBuckets, programBuckets, enquiries, conversions, seatRows] = await Promise.all([
      (this.tenantPrisma.client as Client).admissionApplication.groupBy({ by: ['status'], where: scopeWhere, _count: { _all: true } }),
      (this.tenantPrisma.client as Client).admissionApplication.groupBy({ by: ['admissionProgramId', 'status'], where: scopeWhere, _count: { _all: true } }),
      (this.tenantPrisma.client as Client).admissionEnquiry.count({ where: { sessionId } }),
      (this.tenantPrisma.client as Client).admissionEnquiry.count({ where: { sessionId, convertedAt: { not: null } } }),
      (this.tenantPrisma.client as Client).admissionProgramOffer.aggregate({ where: { sessionId }, _sum: { seats: true, filledSeats: true } }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const b of statusBuckets) byStatus[b.status] = b._count._all;
    const byStage = this.stageCounts(byStatus);

    const programIds = [...new Set(programBuckets.map((b) => b.admissionProgramId))];
    const programs = await (this.tenantPrisma.client as Client).admissionProgramOffer.findMany({
      where: { id: { in: programIds } },
      include: { program: { select: { id: true, code: true, name: true } } },
    });
    const programMeta = new Map(programs.map((p) => [p.id, p]));
    const perProgram = programIds.map((pid) => {
      const meta = programMeta.get(pid);
      const rows = programBuckets.filter((b) => b.admissionProgramId === pid);
      return {
        programId: pid,
        programName: meta?.program.name ?? meta?.program.code ?? 'Unknown',
        seats: meta?.seats ?? 0,
        filledSeats: meta?.filledSeats ?? 0,
        applications: rows.reduce((s, b) => s + b._count._all, 0),
        enrolled: rows.find((b) => b.status === 'ENROLLED')?._count._all ?? 0,
      };
    });

    return {
      sessionId,
      sessionName: session.name,
      byStage,
      byStatus,
      total: Object.values(byStatus).reduce((s, n) => s + n, 0),
      enquiries,
      conversions,
      seats: seatRows._sum.seats ?? 0,
      filled: seatRows._sum.filledSeats ?? 0,
      perProgram,
    };
  }

  async meritReport(tenantId: string, userId: string, sessionId: string) {
    const session = await (this.tenantPrisma.client as Client).admissionSession.findFirst({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Admission session not found.');
    const scope = await this.applicationScope(tenantId, userId);
    const scopeWhere: Record<string, any> = {};
    if (scope) Object.assign(scopeWhere, scope);
    scopeWhere.sessionId = sessionId;
    scopeWhere.meritRank = { not: null };

    const rows = await (this.tenantPrisma.client as Client).admissionApplication.findMany({
      where: scopeWhere,
      orderBy: { meritRank: 'asc' },
      select: {
        id: true,
        applicationNumber: true,
        fullName: true,
        meritScore: true,
        meritRank: true,
        status: true,
        admissionProgram: { select: { program: { select: { id: true, code: true, name: true } } } },
      },
    });

    return {
      sessionId,
      publishedAt: session.meritPublishedAt,
      entries: rows.map((r) => ({
        applicationId: r.id,
        applicationNumber: r.applicationNumber,
        fullName: r.fullName,
        programName: r.admissionProgram?.program.name ?? '',
        meritScore: r.meritScore,
        meritRank: r.meritRank,
        status: r.status,
      })),
    };
  }

  async exportApplications(tenantId: string, userId: string, query: ListAdmissionApplicationQueryDto) {
    const { data } = await this.listApplications(tenantId, userId, { ...query, skip: 0, take: 10_000 });
    const rows = (data as any[]).map((row) => {
      const out: Record<string, unknown> = {};
      for (const field of ADMISSION_APPLICATION_EXPORT_COLUMNS) {
        if (field === 'campus') out.campus = row.campus?.name ?? '';
        else if (field === 'program') out.program = row.admissionProgram?.program?.name ?? '';
        else if (field === 'academicYear') out.academicYear = row.academicYear?.code ?? '';
        else out[field] = (row[field] ?? '') as unknown;
      }
      return out;
    });
    return { csv: rowsToCsv(rows, ADMISSION_APPLICATION_EXPORT_COLUMNS), count: data.length, filename: 'admission-applications.csv' };
  }

  async exportEnquiries(tenantId: string, query: { search?: string; source?: string; sessionId?: string }) {
    const { data } = await this.listEnquiries(tenantId, { ...query, skip: 0, take: 10_000 });
    const rows = (data as any[]).map((row) => {
      const out: Record<string, unknown> = {};
      for (const field of ADMISSION_ENQUIRY_EXPORT_COLUMNS) {
        if (field === 'program') out.program = row.program?.name ?? '';
        else if (field === 'session') out.session = row.session?.name ?? '';
        else out[field] = (row[field] ?? '') as unknown;
      }
      return out;
    });
    return { csv: rowsToCsv(rows, ADMISSION_ENQUIRY_EXPORT_COLUMNS), count: data.length, filename: 'admission-enquiries.csv' };
  }

  async exportMerit(tenantId: string, userId: string, sessionId: string) {
    const report = await this.meritReport(tenantId, userId, sessionId);
    const rows = report.entries.map((e) => ({ ...e }));
    return {
      csv: rowsToCsv(rows as Record<string, unknown>[], ADMISSION_MERIT_EXPORT_COLUMNS as unknown as readonly string[]),
      count: report.entries.length,
      filename: `merit-list-${sessionId}.csv`,
    };
  }

  // ── Configurable form fields ──────────────────────────────────────────────

  async listFormFields(tenantId: string, userId: string, sessionId: string) {
    await this.assertRef({ model: 'admissionSession', id: sessionId, label: 'Admission session' });
    return (this.tenantPrisma.client as Client).admissionFormField.findMany({
      where: { sessionId },
      orderBy: { sequenceOrder: 'asc' },
    });
  }

  async setFormFields(tenantId: string, userId: string, sessionId: string, dto: SetAdmissionFormFieldsDto) {
    await this.assertRef({ model: 'admissionSession', id: sessionId, label: 'Admission session' });
    const codes = dto.fields.map((f) => f.code.trim()).filter(Boolean);
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException('Field codes must be unique.');
    }
    if (codes.length === 0) throw new BadRequestException('Provide at least one form field.');

    await this.tenantPrisma.client.$transaction([
      (this.tenantPrisma.client as any).admissionFormField.deleteMany({ where: { sessionId } }),
      (this.tenantPrisma.client as any).admissionFormField.createMany({
        data: dto.fields.map((f, i) => ({
          tenantId,
          sessionId,
          code: f.code.trim(),
          label: f.label.trim(),
          fieldType: f.fieldType,
          placeholder: f.placeholder ?? null,
          required: f.required ?? false,
          options: (f.options?.length ? f.options : undefined) as any,
          helpText: f.helpText ?? null,
          sequenceOrder: f.sequenceOrder ?? i,
          isActive: f.isActive ?? true,
          createdBy: userId,
          updatedBy: userId,
        })),
      }),
    ]);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_FORM_FIELDS_UPDATED, 'AdmissionSession', sessionId, {
      after: { fieldCodes: codes },
    });
    return this.listFormFields(tenantId, userId, sessionId);
  }

  // ── Eligibility rules ─────────────────────────────────────────────────────

  async listEligibilityRules(tenantId: string, userId: string, programId?: string) {
    return (this.tenantPrisma.client as Client).admissionEligibilityRule.findMany({
      where: programId ? { programId } : {},
      orderBy: [{ program: { session: { createdAt: 'desc' } } }, { sequenceOrder: 'asc' }],
      include: { program: { select: { id: true, program: { select: { id: true, code: true, name: true } }, session: { select: { id: true, code: true, name: true } } } } },
    });
  }

  async createEligibilityRule(tenantId: string, userId: string, dto: CreateAdmissionEligibilityRuleDto) {
    await this.assertRef({ model: 'admissionProgramOffer', id: dto.programId, label: 'Admission program' });
    const rule = await (this.tenantPrisma.client as any).admissionEligibilityRule.create({
      data: {
        tenantId,
        programId: dto.programId,
        name: dto.name.trim(),
        description: dto.description ?? null,
        ruleType: dto.ruleType,
        config: (dto.config ?? null) as any,
        appliesToCategory: dto.appliesToCategory ?? null,
        sequenceOrder: dto.sequenceOrder ?? 0,
        isActive: dto.isActive ?? true,
        createdBy: userId,
        updatedBy: userId,
      },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_ELIGIBILITY_RULE_CREATED, 'AdmissionEligibilityRule', rule.id, {
      after: { programId: dto.programId, name: rule.name, ruleType: rule.ruleType },
    });
    return rule;
  }

  async updateEligibilityRule(tenantId: string, userId: string, ruleId: string, dto: UpdateAdmissionEligibilityRuleDto) {
    const before = await (this.tenantPrisma.client as Client).admissionEligibilityRule.findFirst({ where: { id: ruleId } });
    if (!before) throw new NotFoundException('Eligibility rule not found.');
    const data: Record<string, any> = { ...dto, updatedBy: userId };
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.config !== undefined) data.config = dto.config as any;
    if (dto.appliesToCategory !== undefined) data.appliesToCategory = dto.appliesToCategory;
    const rule = await (this.tenantPrisma.client as any).admissionEligibilityRule.update({ where: { id: ruleId }, data });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_ELIGIBILITY_RULE_UPDATED, 'AdmissionEligibilityRule', ruleId, {
      before: { name: before.name, ruleType: before.ruleType },
      after: { name: rule.name, ruleType: rule.ruleType, isActive: rule.isActive },
    });
    return rule;
  }

  async deleteEligibilityRule(tenantId: string, userId: string, ruleId: string) {
    const before = await (this.tenantPrisma.client as Client).admissionEligibilityRule.findFirst({ where: { id: ruleId } });
    if (!before) throw new NotFoundException('Eligibility rule not found.');
    await (this.tenantPrisma.client as any).admissionEligibilityRule.delete({ where: { id: ruleId } });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_ELIGIBILITY_RULE_DELETED, 'AdmissionEligibilityRule', ruleId, {
      before: { programId: before.programId, name: before.name, ruleType: before.ruleType },
    });
    return { id: ruleId, deleted: true };
  }

  /** Evaluates every active eligibility rule of the application's program against its profile. */
  async evaluateEligibility(applicationId: string, tenantId: string, userId: string) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    const rules = await (this.tenantPrisma.client as Client).admissionEligibilityRule.findMany({
      where: { programId: app.admissionProgramId, isActive: true },
      orderBy: { sequenceOrder: 'asc' },
    });

    const profile = this.eligibilityProfile(app);
    const results = rules.map((rule) => this.evaluateRule(rule as any, profile));

    const applicable = results.filter((r) => r.outcome !== 'SKIPPED');
    const failed = applicable.filter((r) => r.outcome === 'FAIL');
    const passed = applicable.filter((r) => r.outcome === 'PASS');
    const overall = applicable.length === 0 || (applicable.every((r) => r.outcome === 'PASS') && failed.length === 0)
      ? 'ELIGIBLE'
      : 'NOT_ELIGIBLE';

    await this.logActivity(applicationId, ADMISSION_EVENTS.ELIGIBILITY_EVALUATED, `Eligibility evaluated: ${overall}`, userId);
    await this.audit(
      tenantId,
      userId,
      failed.length > 0 ? AUDIT_ACTIONS.ADMISSION_ELIGIBILITY_FAILED : AUDIT_ACTIONS.ADMISSION_ELIGIBILITY_EVALUATED,
      'AdmissionApplication',
      applicationId,
      { after: { overall, applied: applicable.length, passed: passed.length, failed: failed.length } },
    );

    return {
      applicationId,
      programId: app.admissionProgramId,
      category: app.category,
      overall,
      passed: passed.length,
      failed: failed.length,
      rules: results.map((r) => ({ ...r, rule: { id: r.rule.id, name: r.rule.name, ruleType: r.rule.ruleType, config: r.rule.config } })),
    };
  }

  /** Single-call guard used by the bulk tool — throws with a readable summary when ineligible. */
  private async assertEligible(applicationId: string, tenantId: string, userId: string) {
    const result = await this.evaluateEligibility(applicationId, tenantId, userId);
    if (result.overall !== 'ELIGIBLE') {
      const failures = result.rules.filter((r) => r.outcome === 'FAIL');
      throw new BadRequestException(`Application is not eligible for this program: ${failures.map((f) => `${f.rule.name}: ${f.detail}`).join('; ')}.`);
    }
  }

  /** Structured applicant profile from an application row — the input to every rule. */
  private eligibilityProfile(app: any) {
    const records = (app.qualifications ?? []) as any[];
    const highest = records.find((r) => (r as any).isHighestQualification) ?? records[0];
    const percentage = typeof highest?.percentage === 'number' ? highest.percentage : null;
    const gpa = typeof highest?.gpa === 'number' ? highest.gpa : null;
    let marksPercentage: number | null = null;
    if (highest && typeof highest.marksObtained === 'number' && highest.marksOutOf) {
      marksPercentage = (highest.marksObtained / highest.marksOutOf) * 100;
    }
    let age: number | null = null;
    if (app.dateOfBirth) {
      const dob = new Date(app.dateOfBirth);
      const now = new Date();
      age = Math.floor((now.getTime() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    }
    return {
      category: app.category ?? null,
      gender: app.gender ?? null,
      ageYears: age,
      percentage,
      gpa,
      marksPercentage,
    };
  }

  private evaluateRule(rule: any, profile: any): { rule: any; outcome: 'PASS' | 'FAIL' | 'SKIPPED' | 'MANUAL'; detail: string } {
    if (rule.appliesToCategory && rule.appliesToCategory !== profile.category) {
      return { rule, outcome: 'SKIPPED', detail: `Applies only to category "${rule.appliesToCategory}".` };
    }
    const config = (rule.config ?? {}) as Record<string, any>;
    switch (rule.ruleType) {
      case 'MIN_PERCENTAGE': {
        const min = Number(config.minPercentage ?? 0);
        if (profile.percentage === null) return { rule, outcome: 'FAIL', detail: `No percentage on record (requires ≥ ${min}%).` };
        return profile.percentage >= min
          ? { rule, outcome: 'PASS', detail: `${profile.percentage}% meets the ${min}% minimum.` }
          : { rule, outcome: 'FAIL', detail: `${profile.percentage}% is below the ${min}% minimum.` };
      }
      case 'MIN_GPA': {
        const min = Number(config.minGpa ?? 0);
        if (profile.gpa === null) return { rule, outcome: 'FAIL', detail: `No GPA on record (requires ≥ ${min}).` };
        return profile.gpa >= min
          ? { rule, outcome: 'PASS', detail: `GPA ${profile.gpa} meets the ${min} minimum.` }
          : { rule, outcome: 'FAIL', detail: `GPA ${profile.gpa} is below the ${min} minimum.` };
      }
      case 'MIN_MARKS': {
        const minMarks = Number(config.minMarks ?? 0);
        const marksOutOf = Number(config.marksOutOf ?? 0);
        const target = marksOutOf > 0 ? (minMarks / marksOutOf) * 100 : 0;
        if (profile.marksPercentage === null) return { rule, outcome: 'FAIL', detail: `No marks on record (requires ≥ ${minMarks}/${marksOutOf}).` };
        return profile.marksPercentage >= target
          ? { rule, outcome: 'PASS', detail: `${profile.marksPercentage.toFixed(1)}% meets the ${minMarks}/${marksOutOf} minimum.` }
          : { rule, outcome: 'FAIL', detail: `${profile.marksPercentage.toFixed(1)}% is below the ${minMarks}/${marksOutOf} minimum.` };
      }
      case 'MIN_AGE': {
        const min = Number(config.minAgeYears ?? 0);
        if (profile.ageYears === null) return { rule, outcome: 'FAIL', detail: 'No date of birth on record.' };
        return profile.ageYears >= min
          ? { rule, outcome: 'PASS', detail: `Age ${profile.ageYears} meets the ${min} year minimum.` }
          : { rule, outcome: 'FAIL', detail: `Age ${profile.ageYears} is below the ${min} year minimum.` };
      }
      case 'MAX_AGE': {
        const max = Number(config.maxAgeYears ?? 0);
        if (profile.ageYears === null) return { rule, outcome: 'FAIL', detail: 'No date of birth on record.' };
        return profile.ageYears <= max
          ? { rule, outcome: 'PASS', detail: `Age ${profile.ageYears} is within the ${max} year maximum.` }
          : { rule, outcome: 'FAIL', detail: `Age ${profile.ageYears} exceeds the ${max} year maximum.` };
      }
      case 'CATEGORY_ALLOWED': {
        const allowed = (config.allowedCategories ?? []) as string[];
        if (allowed.length === 0) return { rule, outcome: 'MANUAL', detail: 'No allowed categories configured — manual review required.' };
        const passed = allowed.some((c) => c.toLowerCase() === (profile.category ?? '').toLowerCase());
        return passed
          ? { rule, outcome: 'PASS', detail: `Category "${profile.category}" is permitted.` }
          : { rule, outcome: 'FAIL', detail: `Category "${profile.category}" is not in the allowed list (${allowed.join(', ')}).` };
      }
      case 'CUSTOM':
        return { rule, outcome: 'MANUAL', detail: 'Custom rule — manual review required.' };
      default:
        return { rule, outcome: 'MANUAL', detail: 'Unsupported rule type — manual review required.' };
    }
  }

  // ── Duplicate detection ───────────────────────────────────────────────────

  async detectDuplicates(tenantId: string, userId: string, sessionId?: string) {
    const scope = await this.applicationScope(tenantId, userId);
    const where: Record<string, any> = { ...(scope ?? {}) };
    if (sessionId) where.sessionId = sessionId;

    const rows = await (this.tenantPrisma.client as Client).admissionApplication.findMany({
      where: { ...where, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        applicationNumber: true,
        fullName: true,
        email: true,
        phone: true,
        dateOfBirth: true,
        status: true,
        duplicateOfId: true,
        category: true,
        admissionProgram: { select: { program: { select: { id: true, code: true, name: true } } } },
      },
    });

    const emailIndex = new Map<string, any[]>();
    const phoneIndex = new Map<string, any[]>();
    const identityIndex = new Map<string, any[]>();
    const flagged: any[] = [];

    for (const row of rows) {
      if (row.duplicateOfId) flagged.push(row);
      if (row.email) {
        const key = row.email.trim().toLowerCase();
        if (!emailIndex.has(key)) emailIndex.set(key, []);
        emailIndex.get(key)!.push(row);
      }
      if (row.phone) {
        const key = row.phone.replace(/[^0-9]/g, '');
        if (key.length >= 6) {
          if (!phoneIndex.has(key)) phoneIndex.set(key, []);
          phoneIndex.get(key)!.push(row);
        }
      }
      if (row.fullName && row.dateOfBirth) {
        const key = `${row.fullName.trim().toLowerCase()}|${new Date(row.dateOfBirth).toISOString().slice(0, 10)}`;
        if (!identityIndex.has(key)) identityIndex.set(key, []);
        identityIndex.get(key)!.push(row);
      }
    }

    const groups: any[] = [];
    const seen = new Set<string>();
    const pushGroup = (matchType: string, members: any[]) => {
      if (members.length < 2) return;
      const key = members.map((m) => m.id).sort().join('|');
      if (seen.has(key)) return;
      seen.add(key);
      groups.push({ matchType, members });
    };
    for (const members of emailIndex.values()) pushGroup('EMAIL', members);
    for (const members of phoneIndex.values()) pushGroup('PHONE', members);
    for (const members of identityIndex.values()) pushGroup('NAME_AND_DOB', members);

    return { sessionId: sessionId ?? null, groups, flagged };
  }

  async flagDuplicate(applicationId: string, tenantId: string, userId: string, dto: FlagDuplicateDto) {
    if (dto.duplicateOfId === applicationId) throw new BadRequestException('An application cannot be its own duplicate.');
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    const canonical = await (this.tenantPrisma.client as Client).admissionApplication.findFirst({
      where: { id: dto.duplicateOfId },
    });
    if (!canonical) throw new NotFoundException('Canonical application not found.');

    const updated = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { duplicateOfId: canonical.id, updatedBy: userId },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.DUPLICATE_DETECTED, 'Flagged as duplicate', userId, dto.reason ?? `Duplicate of ${canonical.applicationNumber}`);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_DUPLICATE_FLAGGED, 'AdmissionApplication', applicationId, {
      before: { duplicateOfId: app.duplicateOfId ?? null },
      after: { duplicateOfId: updated.duplicateOfId, reason: dto.reason ?? null },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  async clearDuplicate(applicationId: string, tenantId: string, userId: string) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);
    if (!app.duplicateOfId) return this.getApplication(applicationId, tenantId, userId);
    const updated = await (this.tenantPrisma.client as any).admissionApplication.update({
      where: { id: applicationId },
      data: { duplicateOfId: null, updatedBy: userId },
    });
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_DUPLICATE_CLEARED, 'AdmissionApplication', applicationId, {
      before: { duplicateOfId: app.duplicateOfId },
      after: { duplicateOfId: updated.duplicateOfId },
    });
    return this.getApplication(applicationId, tenantId, userId);
  }

  /** Finds an existing application that looks like a duplicate of the candidate (same session). */
  private async findDuplicateCandidate(candidate: any): Promise<string | null> {
    if (candidate.email) {
      const found = await (this.tenantPrisma.client as Client).admissionApplication.findFirst({
        where: { sessionId: candidate.sessionId, email: { equals: candidate.email as string, mode: 'insensitive' } },
        select: { id: true },
      });
      if (found) return found.id;
    }
    if (candidate.phone) {
      const digits = (candidate.phone as string).replace(/[^0-9]/g, '');
      if (digits.length >= 6) {
        const found = await (this.tenantPrisma.client as Client).admissionApplication.findMany({
          where: { sessionId: candidate.sessionId, phone: { not: null } },
          select: { id: true, phone: true },
          take: 500,
        });
        const match = found.find((r) => (r.phone as string).replace(/[^0-9]/g, '') === digits);
        if (match) return match.id;
      }
    }
    if (candidate.firstName && candidate.lastName && candidate.dateOfBirth) {
      const found = await (this.tenantPrisma.client as Client).admissionApplication.findFirst({
        where: {
          sessionId: candidate.sessionId,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          dateOfBirth: new Date(candidate.dateOfBirth),
        },
        select: { id: true },
      });
      if (found) return found.id;
    }
    return null;
  }

  // ── Bulk operations ───────────────────────────────────────────────────────

  async bulkImport(tenantId: string, userId: string, dto: BulkImportApplicationDto) {
    if (dto.applications.length === 0) throw new BadRequestException('Provide at least one application to import.');
    const created: any[] = [];
    const errors: Array<{ index: number; message: string }> = [];

    for (let i = 0; i < dto.applications.length; i++) {
      try {
        const application = await this.createApplication(tenantId, userId, dto.applications[i] as any);
        created.push({ index: i, applicationId: application.id, applicationNumber: application.applicationNumber });
      } catch (error) {
        errors.push({ index: i, message: error instanceof Error ? error.message : 'Import failed.' });
      }
    }
    if (created.length > 0) {
      await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_BULK_IMPORTED, 'AdmissionApplication', dto.applications[0]!.sessionId, {
        after: { attempted: dto.applications.length, created: created.length, failed: errors.length },
      });
    }
    return { total: dto.applications.length, created: created.length, failed: errors.length, applications: created, errors };
  }

  async bulkVerify(tenantId: string, userId: string, dto: BulkVerifyApplicationsDto) {
    if (dto.applicationIds.length === 0) throw new BadRequestException('Provide at least one application to verify.');
    const verified: string[] = [];
    const failed: Array<{ applicationId: string; message: string }> = [];

    for (const applicationId of dto.applicationIds) {
      try {
        const application = await this.completeVerification(applicationId, tenantId, userId);
        if (application.meritScore === null) {
          await this.scoreApplication(applicationId, tenantId, userId, { auto: true });
        }
        verified.push(applicationId);
      } catch (error) {
        if ((error as any)?.status === 404) {
          failed.push({ applicationId, message: 'not found' });
        } else {
          failed.push({ applicationId, message: error instanceof Error ? error.message : 'Verification failed.' });
        }
      }
    }
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_BULK_VERIFIED, 'AdmissionApplication', verified[0] ?? dto.applicationIds[0]!, {
      after: { attempted: dto.applicationIds.length, verified: verified.length, failed: failed.length, remarks: dto.remarks ?? null },
    });
    return { total: dto.applicationIds.length, verified: verified.length, failed: failed.length, failedItems: failed };
  }

  // ── Applicant communication ───────────────────────────────────────────────

  async listMessages(applicationId: string, tenantId: string, userId: string) {
    await this.assertApplicationInScope(applicationId, tenantId, userId);
    return (this.tenantPrisma.client as Client).admissionMessage.findMany({
      where: { applicationId },
      orderBy: { sentAt: 'desc' },
    });
  }

  async sendMessage(applicationId: string, tenantId: string, userId: string, dto: SendAdmissionMessageDto) {
    const app = await this.assertApplicationInScope(applicationId, tenantId, userId);

    let relatedNotificationId: string | null = null;
    if (dto.channel === 'IN_APP' && app.createdBy) {
      try {
        const notification = await this.notifications.sendSystem(tenantId, {
          recipientUserId: app.createdBy,
          channel: 'IN_APP',
          subject: dto.subject,
          body: dto.body,
        });
        relatedNotificationId = notification.id ?? null;
        await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_NOTIFICATION_SENT, 'AdmissionApplication', applicationId, {
          after: { notificationId: relatedNotificationId, channel: dto.channel, subject: dto.subject },
        });
      } catch (error) {
        this.logger.warn(`Failed to notify applicant contact for ${applicationId}: ${error instanceof Error ? error.message : error}`);
      }
    }

    const message = await (this.tenantPrisma.client as any).admissionMessage.create({
      data: {
        tenantId,
        applicationId,
        subject: dto.subject,
        body: dto.body,
        channel: dto.channel,
        sentBy: userId,
        relatedNotificationId,
      },
    });
    await this.logActivity(applicationId, ADMISSION_EVENTS.COMMUNICATION_SENT, `Message sent via ${dto.channel}: ${dto.subject}`, userId, dto.body, 'AdmissionMessage', message.id);
    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_MESSAGE_SENT, 'AdmissionMessage', message.id, {
      after: { applicationId, channel: dto.channel, subject: dto.subject },
    });
    return message;
  }

  // ── Analytics ─────────────────────────────────────────────────────────────

  async analytics(tenantId: string, userId: string, query: AdmissionAnalyticsQueryDto, sessionId?: string) {
    const scope = await this.applicationScope(tenantId, userId);
    const where: Record<string, any> = { ...(scope ?? {}) };
    if (sessionId) where.sessionId = sessionId;
    const days = query.days ?? 30;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [statusBuckets, programBuckets, timeBuckets, seatRows] = await Promise.all([
      (this.tenantPrisma.client as Client).admissionApplication.groupBy({ by: ['status'], where, _count: { _all: true } }),
      (this.tenantPrisma.client as Client).admissionApplication.groupBy({ by: ['admissionProgramId', 'status'], where, _count: { _all: true } }),
      (this.tenantPrisma.client as Client).admissionApplication.groupBy({
        by: ['createdAt'],
        where: { ...where, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      (this.tenantPrisma.client as Client).admissionProgramOffer.aggregate({
        where: sessionId ? { sessionId } : {},
        _sum: { seats: true, filledSeats: true },
      }),
    ]);

    const byStatus: Record<string, number> = {};
    for (const b of statusBuckets) byStatus[b.status] = b._count._all;
    const total = Object.values(byStatus).reduce((s, n) => s + n, 0);
    const funnel = ['INITIATED', 'SUBMITTED', 'UNDER_VERIFICATION', 'DOCUMENTS_VERIFIED', 'MERIT_LISTED', 'COUNSELLING_SCHEDULED', 'COUNSELLED', 'SELECTED', 'OFFERED', 'OFFER_ACCEPTED', 'FEE_PAID', 'ENROLLED']
      .map((stage) => ({
        stage,
        count: byStatus[stage] ?? 0,
        conversionRate: total > 0 ? (((byStatus[stage] ?? 0) / total) * 100).toFixed(1) + '%' : '0%',
      }));

    const byDay: Record<string, number> = {};
    for (const b of timeBuckets) {
      const key = new Date(b.createdAt).toISOString().slice(0, 10);
      byDay[key] = (byDay[key] ?? 0) + b._count._all;
    }
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      dates.push(d.toISOString().slice(0, 10));
    }
    const timeSeries = dates.map((date) => ({ date, applications: byDay[date] ?? 0 }));

    const programIds = [...new Set(programBuckets.map((b) => b.admissionProgramId))];
    const programs = await (this.tenantPrisma.client as Client).admissionProgramOffer.findMany({
      where: { id: { in: programIds } },
      include: { program: { select: { id: true, code: true, name: true } } },
    });
    const programMeta = new Map(programs.map((p) => [p.id, p]));
    const perProgram = programIds.map((pid) => {
      const meta = programMeta.get(pid);
      const rows = programBuckets.filter((b) => b.admissionProgramId === pid);
      const apps = rows.reduce((s, b) => s + b._count._all, 0);
      const enrolled = rows.find((b) => b.status === 'ENROLLED')?._count._all ?? 0;
      return {
        programId: pid,
        programName: meta?.program.name ?? meta?.program.code ?? 'Unknown',
        seats: meta?.seats ?? 0,
        filledSeats: meta?.filledSeats ?? 0,
        applications: apps,
        enrolled,
        conversionRate: apps > 0 ? ((enrolled / apps) * 100).toFixed(1) + '%' : '0%',
      };
    });

    await this.audit(tenantId, userId, AUDIT_ACTIONS.ADMISSION_ANALYTICS_VIEWED, 'AdmissionApplication', sessionId ?? '__tenant__', {
      after: { days, sessionId: sessionId ?? null },
    });

    return {
      sessionId: sessionId ?? null,
      days,
      total,
      funnel,
      timeSeries,
      seats: { total: seatRows._sum.seats ?? 0, filled: seatRows._sum.filledSeats ?? 0 },
      perProgram,
    };
  }

  // ── Workflow + notification integration ───────────────────────────────────

  /** entityType this module drives through the workflow engine. */
  private static readonly WORKFLOW_ENTITY_TYPE = 'AdmissionApplication';

  /**
   * On submit, lazily provisions the default admissions workflow definition (if the tenant has
   * not configured one) and starts the instance — which auto-advances through the single NONE
   * approve step to APPROVED, mirroring "submitted" in the engine. On cancel, tries to cancel a
   * still-in-progress instance. Never throws into the caller: admission flows must not break
   * because workflow/notification infrastructure is unavailable.
   */
  private async syncAdmissionWorkflow(tenantId: string, userId: string, applicationId: string, action: 'SUBMIT' | 'CANCEL') {
    try {
      if (action === 'CANCEL') {
        const instance = await this.workflowEngine.findInstance(tenantId, AdmissionsService.WORKFLOW_ENTITY_TYPE, applicationId);
        if (instance && instance.status === 'IN_PROGRESS') {
          await this.workflowEngine.cancel(tenantId, instance.id, userId);
        }
        return;
      }
      const existing = await this.workflowDefinitions.getActiveDefinitionForEntityType(tenantId, AdmissionsService.WORKFLOW_ENTITY_TYPE);
      if (!existing) {
        await this.workflowDefinitions.createDefinition(
          tenantId,
          {
            code: 'ADMISSION_APPLICATION_V1',
            name: 'Admission Application',
            description: 'Default pipeline for admission applications — submission auto-approves into the admissions workflow.',
            entityType: AdmissionsService.WORKFLOW_ENTITY_TYPE,
            states: [
              { code: 'SUBMITTED', name: 'Application submitted', category: 'INITIAL' },
              { code: 'APPROVED', name: 'Application approved', category: 'APPROVED' },
            ],
            transitions: [
              {
                code: 'SUBMIT',
                name: 'Submit application',
                fromStateCode: 'SUBMITTED',
                toStateCode: 'APPROVED',
                action: 'SUBMIT',
                approvalMode: 'NONE',
              },
            ],
          },
          userId,
        );
      }
      await this.workflowEngine.startInstance(
        tenantId,
        { entityType: AdmissionsService.WORKFLOW_ENTITY_TYPE, entityId: applicationId, context: { applicationId } },
        userId,
      );
    } catch (error) {
      this.logger.warn(`Admission workflow sync skipped for ${applicationId}: ${error instanceof Error ? error.message : error}`);
    }
  }

  /** Best-effort in-app notification to the staff member who raised the application. */
  private async notifyStageChange(tenantId: string, app: any, subject: string, body?: string) {
    if (!app?.createdBy) return;
    try {
      await this.notifications.sendSystem(tenantId, {
        recipientUserId: app.createdBy,
        channel: 'IN_APP',
        subject,
        body: body ?? `${app.fullName ?? 'Applicant'} — ${subject}.`,
      });
    } catch (error) {
      this.logger.warn(`Failed to notify ${app.createdBy} about ${subject}: ${error instanceof Error ? error.message : error}`);
    }
  }

  // ── Shared helpers ────────────────────────────────────────────────────────

  private async generateApplicationNumber(): Promise<string> {
    return this.generateNumber(ADMISSION_NUMBER_PREFIX);
  }

  private async generateNumber(prefix: string): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `${prefix}-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      const existing = await this.countWithNumber(candidate);
      if (existing === 0) return candidate;
    }
    throw new ConflictException(`Could not generate a unique ${prefix} number; please retry.`);
  }

  private async countWithNumber(number: string): Promise<number> {
    const [applications, offers, payments] = await Promise.all([
      (this.tenantPrisma.client as Client).admissionApplication.count({ where: { applicationNumber: number } }),
      (this.tenantPrisma.client as Client).admissionOffer.count({ where: { offerNumber: number } }),
      (this.tenantPrisma.client as Client).admissionFeePayment.count({ where: { receiptNumber: number } }),
    ]);
    return applications + offers + payments;
  }

  private async assertRef(opts: { model: string; id: string; label: string }) {
    const found = await (this.tenantPrisma.client as any)[opts.model].findFirst({ where: { id: opts.id } });
    if (!found) throw new NotFoundException(`${opts.label} not found.`);
  }

  private async assertSlot(slotId: string) {
    const slot = await (this.tenantPrisma.client as Client).admissionCounsellingSlot.findFirst({ where: { id: slotId } });
    if (!slot) throw new NotFoundException('Counselling slot not found.');
    return slot;
  }

  private async logActivity(
    applicationId: string,
    eventType: string,
    title: string,
    actorUserId: string,
    description?: string,
    entityType?: string,
    entityId?: string,
  ) {
    await (this.tenantPrisma.client as any).admissionActivity.create({
      data: {
        applicationId,
        eventType,
        title,
        description: description ?? null,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        actorUserId,
      },
    });
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
      module: 'admissions',
      entityType,
      entityId,
      before: payload.before,
      after: payload.after,
    });
  }

  /** Exposed for the scope spec to assert stage-guard behaviour without a DB. */
  get statuses(): ReadonlyArray<(typeof APP_STATUSES)[number]> {
    return APP_STATUSES;
  }
}