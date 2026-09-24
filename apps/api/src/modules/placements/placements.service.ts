/**
 * Placements core service — module lookups plus the recruiting-partner master: companies
 * (soft-deletable catalog) and their contacts (the people the placement cell coordinates with).
 * Catalog rows are tenant-wide operational data: once the caller holds the placement permission,
 * companies/contacts are readable across the tenant; student-anchored row scope is enforced in
 * the application/eligibility/report services via placementStudentWhere (see placements-scope.ts).
 *
 * Conventions mirror the HR/students modules: every read/write goes through the tenant-scoped
 * Prisma client (tenant guard auto-injects tenantId) and each mutation records an audit entry
 * under AUDIT_MODULES.PLACEMENTS.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_ACTIONS, type AuthenticatedUser } from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { recordPlacementAudit } from './placements-shared';
import * as Dto from './dto/placements.dto';

@Injectable()
export class PlacementsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
  ) {}

  private async mapP2002(err: unknown, message: string): Promise<never> {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw err;
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  async lookups() {
    const [
      campuses,
      departments,
      programs,
      batches,
      academicYears,
      companies,
      contacts,
      users,
    ] = await Promise.all([
      this.tenantPrisma.client.campus.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      this.tenantPrisma.client.department.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      this.tenantPrisma.client.program.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, code: true, departmentId: true },
        orderBy: { name: 'asc' },
      }),
      this.tenantPrisma.client.batch.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
      this.tenantPrisma.client.academicYear.findMany({ where: { deletedAt: null }, orderBy: { startDate: 'desc' } }),
      this.tenantPrisma.client.placementCompany.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, code: true, name: true, companyType: true },
        orderBy: { name: 'asc' },
      }),
      this.tenantPrisma.client.placementContact.findMany({
        where: { deletedAt: null, isActive: true },
        select: { id: true, fullName: true, companyId: true },
        orderBy: { fullName: 'asc' },
        take: 500,
      }),
      this.tenantPrisma.client.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, email: true, fullName: true },
        orderBy: { fullName: 'asc' },
        take: 500,
      }),
    ]);

    return {
      campuses,
      departments,
      programs,
      batches,
      academicYears,
      companies,
      contacts,
      users,
      enums: {
        companyTypes: [...Dto.COMPANY_TYPES],
        driveModes: [...Dto.DRIVE_MODES],
        driveStatuses: [...Dto.DRIVE_STATUSES],
        positionTypes: [...Dto.POSITION_TYPES],
        eligibilityStatuses: [...Dto.ELIGIBILITY_STATUSES],
        applicationStatuses: [...Dto.APPLICATION_STATUSES],
        roundTypes: [...Dto.ROUND_TYPES],
        roundStatuses: [...Dto.ROUND_STATUSES],
        roundResultStatuses: [...Dto.ROUND_RESULT_STATUSES],
        offerStatuses: [...Dto.OFFER_STATUSES],
        joiningStatuses: [...Dto.JOINING_STATUSES],
        outcomeStatuses: [...Dto.OUTCOME_STATUSES],
      },
    };
  }

  // ── Companies ─────────────────────────────────────────────────────────────

  async listCompanies(query: Dto.QueryCompaniesDto) {
    const where: Record<string, unknown> = {};
    if (!query.includeArchived) where.deletedAt = null;
    if (query.companyType) where.companyType = query.companyType;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { industry: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementCompany.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 20,
        include: { _count: { select: { contacts: true, drives: true } } },
      }),
      this.tenantPrisma.client.placementCompany.count({ where }),
    ]);
    return { data, total };
  }

  async getCompany(id: string) {
    const company = await this.tenantPrisma.client.placementCompany.findFirst({
      where: { id },
      include: {
        contacts: {
          where: { deletedAt: null },
          orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
        },
        drives: {
          where: { deletedAt: null },
          orderBy: { driveDate: 'desc' },
          include: { _count: { select: { positions: true, applications: true } } },
        },
      },
    });
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }

  async createCompany(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateCompanyDto) {
    const data: Prisma.PlacementCompanyUncheckedCreateInput = {
      tenantId,
      code: dto.code.trim(),
      name: dto.name.trim(),
      companyType: (dto.companyType ?? 'OTHER') as Prisma.PlacementCompanyUncheckedCreateInput['companyType'],
      industry: dto.industry,
      website: dto.website,
      description: dto.description,
      headquartersCity: dto.headquartersCity,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2,
      city: dto.city,
      state: dto.state,
      country: dto.country ?? 'India',
      isActive: dto.isActive ?? true,
      createdBy: user.id,
    };
    const created = await this.tenantPrisma.client.placementCompany
      .create({ data })
      .catch((e) => this.mapP2002(e, 'A company with this code already exists.'));
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_COMPANY_CREATED,
      'PlacementCompany',
      created.id,
      { code: created.code, name: created.name },
    );
    return created;
  }

  async updateCompany(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateCompanyDto) {
    await this.companyOrThrow(id);
    const data: Prisma.PlacementCompanyUncheckedUpdateInput = {
      ...(dto.code ? { code: dto.code.trim() } : {}),
      ...(dto.name ? { name: dto.name.trim() } : {}),
      companyType: dto.companyType as Prisma.PlacementCompanyUncheckedUpdateInput['companyType'],
      industry: dto.industry,
      website: dto.website,
      description: dto.description,
      headquartersCity: dto.headquartersCity,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2,
      city: dto.city,
      state: dto.state,
      country: dto.country,
      isActive: dto.isActive,
      updatedBy: user.id,
    };
    // Drop undefined keys so PATCH semantics don't null out omitted fields.
    (Object.keys(data) as Array<keyof typeof data>).forEach((key) => {
      if (data[key] === undefined) delete data[key];
    });
    const updated = await this.tenantPrisma.client.placementCompany
      .update({ where: { id }, data })
      .catch((e) => this.mapP2002(e, 'A company with this code already exists.'));
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_COMPANY_UPDATED,
      'PlacementCompany',
      id,
      dto,
    );
    return updated;
  }

  async archiveCompany(tenantId: string, user: AuthenticatedUser, id: string, restore = false) {
    await this.companyOrThrow(id);
    if (!restore && !(await this.companySafeToArchive(id))) {
      throw new BadRequestException('Company has drives or contacts and cannot be archived.');
    }
    const updated = await this.tenantPrisma.client.placementCompany.update({
      where: { id },
      data: { deletedAt: restore ? null : new Date(), isActive: restore ? true : false, updatedBy: user.id },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      restore ? AUDIT_ACTIONS.PLACEMENT_COMPANY_RESTORED : AUDIT_ACTIONS.PLACEMENT_COMPANY_ARCHIVED,
      'PlacementCompany',
      id,
    );
    return updated;
  }

  private async companyOrThrow(id: string) {
    const found = await this.tenantPrisma.client.placementCompany.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Company not found.');
    return found;
  }

  private async companySafeToArchive(id: string) {
    const [drives, contacts] = await Promise.all([
      this.tenantPrisma.client.placementDrive.count({ where: { companyId: id, deletedAt: null } }),
      this.tenantPrisma.client.placementContact.count({ where: { companyId: id, deletedAt: null } }),
    ]);
    return drives === 0 && contacts === 0;
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  async listContacts(query: Dto.QueryContactsDto) {
    const where: Record<string, unknown> = {};
    if (!query.includeArchived) where.deletedAt = null;
    if (query.companyId) where.companyId = query.companyId;
    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
        { designation: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.placementContact.findMany({
        where,
        orderBy: [{ isPrimary: 'desc' }, { fullName: 'asc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 20,
        include: { company: { select: { id: true, code: true, name: true } } },
      }),
      this.tenantPrisma.client.placementContact.count({ where }),
    ]);
    return { data, total };
  }

  async getContact(id: string) {
    const contact = await this.tenantPrisma.client.placementContact.findFirst({
      where: { id },
      include: { company: { select: { id: true, code: true, name: true } } },
    });
    if (!contact) throw new NotFoundException('Contact not found.');
    return contact;
  }

  async createContact(tenantId: string, user: AuthenticatedUser, dto: Dto.CreateContactDto) {
    const company = await this.companyOrThrow(dto.companyId);
    if (company.deletedAt) throw new BadRequestException('Cannot add a contact to an archived company.');

    if (dto.isPrimary) {
      const primary = await this.tenantPrisma.client.placementContact.findFirst({
        where: { companyId: dto.companyId, isPrimary: true, deletedAt: null },
        select: { id: true },
      });
      if (primary) throw new ConflictException('The company already has a primary contact.');
    }

    const created = await this.tenantPrisma.client.placementContact.create({
      data: {
        tenantId,
        companyId: dto.companyId,
        fullName: dto.fullName.trim(),
        designation: dto.designation,
        email: dto.email,
        phone: dto.phone,
        isPrimary: dto.isPrimary ?? false,
        isActive: dto.isActive ?? true,
        createdBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_CONTACT_CREATED,
      'PlacementContact',
      created.id,
      { companyId: dto.companyId, fullName: created.fullName },
    );
    return created;
  }

  async updateContact(tenantId: string, user: AuthenticatedUser, id: string, dto: Dto.UpdateContactDto) {
    const contact = await this.contactOrThrow(id);
    if (dto.isPrimary) {
      const primary = await this.tenantPrisma.client.placementContact.findFirst({
        where: { companyId: contact.companyId, isPrimary: true, deletedAt: null, NOT: { id } },
        select: { id: true },
      });
      if (primary) throw new ConflictException('The company already has a primary contact.');
    }

    const updated = await this.tenantPrisma.client.placementContact.update({
      where: { id },
      data: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        designation: dto.designation,
        email: dto.email,
        phone: dto.phone,
        isPrimary: dto.isPrimary,
        isActive: dto.isActive,
        updatedBy: user.id,
      },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_CONTACT_UPDATED,
      'PlacementContact',
      id,
      dto,
    );
    return updated;
  }

  async removeContact(tenantId: string, user: AuthenticatedUser, id: string) {
    await this.contactOrThrow(id);
    await this.tenantPrisma.client.placementContact.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: user.id },
    });
    await recordPlacementAudit(
      this.auditService,
      { tenantId, actorUserId: user.id },
      AUDIT_ACTIONS.PLACEMENT_CONTACT_DELETED,
      'PlacementContact',
      id,
    );
  }

  private async contactOrThrow(id: string) {
    const found = await this.tenantPrisma.client.placementContact.findFirst({ where: { id } });
    if (!found) throw new NotFoundException('Contact not found.');
    return found;
  }
}