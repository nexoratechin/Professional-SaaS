import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS } from '@college-erp/auth';
import type {
  CampusComparisonDto,
  CampusConfigurationDto,
  CampusCountsDto,
  CampusOverviewDto,
  CampusOverviewRowDto,
  CampusSettingsDocument,
  GlobalCampusPoliciesDto,
  GlobalCampusPoliciesResponseDto,
} from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantConfigurationService } from '../tenant-configuration/tenant-configuration.service';
import { CampusAccessService } from './campus-access.service';
import type { UpdateCampusConfigDto } from './dto/update-campus-config.dto';
import type { CampusPoliciesSectionDto } from '../tenant-configuration/dto/update-tenant-configuration.dto';

type CampusConfigRow = {
  id: string;
  tenantId: string;
  campusId: string;
  version: number;
  data: unknown;
  updatedAt: Date;
};

const DEFAULT_POLICIES: GlobalCampusPoliciesDto = {
  campusSettingsEnabled: true,
  campusAnalyticsEnabled: true,
  allowCampusAdminRole: true,
  defaultTimezone: null,
};

const METRIC_LABELS: Record<string, string> = {
  students: 'Students',
  departments: 'Departments',
  programs: 'Programs',
  employees: 'Employees',
  feeCollectedCents: 'Fee collected (₹, in cents)',
};

/**
 * Multi-campus operations: the university-level admin surface (GET /campuses/*) backed by the
 * same tenant-scoped Prisma client every domain module uses, plus the campus-level configuration
 * engine (one CampusConfiguration row per campus, mirroring the tenant configuration engine).
 *
 * Access model (enforced here, in addition to the PermissionsGuard's key check):
 *  - overview / compare      -> campus.analytics.view, scoped to the caller's campus grants
 *  - campus config get/patch -> campus.settings.view / campus.settings.manage, scoped likewise
 *  - global policies get/patch -> campus.policies.manage, GLOBAL grant only
 *
 * The institution-wide policy document rejects these operations when a university admin has
 * switched the corresponding capability off (campusSettingsEnabled / campusAnalyticsEnabled).
 */
@Injectable()
export class CampusAdminService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly campusAccess: CampusAccessService,
    private readonly tenantConfiguration: TenantConfigurationService,
    private readonly auditService: AuditService,
  ) {}

  // ── Overview ───────────────────────────────────────────────────────────

  async overview(tenantId: string, userId: string): Promise<CampusOverviewDto> {
    await this.assertAnalyticsEnabled(tenantId);

    const accessible = await this.campusAccess.resolveAccessibleCampusIds(
      tenantId,
      userId,
      PERMISSION_KEYS.CAMPUS_ANALYTICS_VIEW,
    );
    const where = accessible === null ? { deletedAt: null } : { deletedAt: null, id: { in: [...accessible] } };

    const [campuses, counts, configs, policies] = await Promise.all([
      this.tenantPrisma.client.campus.findMany({ where, orderBy: { name: 'asc' } }),
      accessible === null || accessible.size > 0 ? this.collectCounts(accessible === null ? [] : [...accessible], true) : new Map<string, CampusCountsDto>(),
      this.tenantPrisma.client.campusConfiguration.findMany({
        where: accessible === null ? {} : { campusId: { in: [...accessible] } },
        select: { campusId: true, version: true, data: true },
      }),
      this.resolvePolicies(tenantId),
    ]);

    const countsByCampus = counts;
    const configByCampus = new Map(configs.map((config) => [config.campusId, config]));

    const rows: CampusOverviewRowDto[] = campuses.map((campus) => {
      const config = configByCampus.get(campus.id);
      const css = (config?.data ?? {}) as Record<string, unknown>;
      return {
        id: campus.id,
        code: campus.code,
        name: campus.name,
        city: campus.city,
        state: campus.state,
        country: campus.country,
        isActive: campus.isActive,
        createdAt: campus.createdAt.toISOString(),
        configVersion: config?.version ?? 0,
        timezone: (css.timezone as string | null) ?? policies.defaultTimezone,
        counts: countsByCampus.get(campus.id) ?? {
          departments: 0,
          programs: 0,
          students: 0,
          employees: 0,
          feeCollectedCents: 0,
        },
      };
    });

    return { campuses: rows };
  }

  // ── Comparison ─────────────────────────────────────────────────────────

  async compare(tenantId: string, userId: string, campusIds: string[]): Promise<CampusComparisonDto> {
    const uniqueIds = [...new Set(campusIds)].filter(Boolean);
    if (uniqueIds.length === 0) {
      throw new BadRequestException('Select at least one campus to compare.');
    }

    await this.assertAnalyticsEnabled(tenantId);

    const accessible = await this.campusAccess.resolveAccessibleCampusIds(
      tenantId,
      userId,
      PERMISSION_KEYS.CAMPUS_ANALYTICS_VIEW,
    );
    for (const campusId of uniqueIds) {
      if (accessible !== null && !accessible.has(campusId)) {
        throw new ForbiddenException(`Campus ${campusId} is outside your access scope.`);
      }
    }

    const [campuses, counts] = await Promise.all([
      this.tenantPrisma.client.campus.findMany({
        where: { deletedAt: null, id: { in: uniqueIds } },
        orderBy: { name: 'asc' },
      }),
      this.collectCounts(uniqueIds, false),
    ]);

    const byId = new Map(campuses.map((campus) => [campus.id, campus]));
    const ordered = uniqueIds
      .map((id) => byId.get(id))
      .filter((campus): campus is NonNullable<typeof campus> => Boolean(campus));

    const metrics = (['students', 'departments', 'programs', 'employees', 'feeCollectedCents'] as const).map(
      (metric) => ({
        metric,
        label: METRIC_LABELS[metric] ?? metric,
        values: ordered.map((campus) => ({
          campusId: campus.id,
          value: counts.get(campus.id)?.[metric] ?? 0,
        })),
      }),
    );

    return {
      campuses: ordered.map((campus) => ({
        id: campus.id,
        code: campus.code,
        name: campus.name,
        city: campus.city,
      })),
      metrics,
    };
  }

  // ── Per-campus configuration ───────────────────────────────────────────

  async getConfig(tenantId: string, userId: string, campusId: string): Promise<CampusConfigurationDto> {
    await this.campusAccess.assertCampusAccessible(tenantId, userId, PERMISSION_KEYS.CAMPUS_SETTINGS_VIEW, campusId);
    const row = await this.findOrCreateConfig(tenantId, campusId);
    return this.toConfigResponse(row);
  }

  async updateConfig(
    tenantId: string,
    userId: string,
    campusId: string,
    dto: UpdateCampusConfigDto,
  ): Promise<CampusConfigurationDto> {
    await this.assertSettingsEnabled(tenantId);
    await this.campusAccess.assertCampusAccessible(tenantId, userId, PERMISSION_KEYS.CAMPUS_SETTINGS_MANAGE, campusId);

    const before = await this.findOrCreateConfig(tenantId, campusId);
    const current = (before.data ?? {}) as Record<string, unknown>;
    const next: Record<string, unknown> = { ...current };

    for (const section of Object.keys(dto) as Array<keyof UpdateCampusConfigDto>) {
      const value = dto[section] as unknown;
      if (value === undefined) continue;
      if (value !== null && typeof value === 'object') {
        next[section] = { ...((current[section] as Record<string, unknown>) ?? {}), ...(value as Record<string, unknown>) };
      } else {
        // Scalars (timezone) replace wholesale; null explicitly clears the override.
        next[section] = value;
      }
    }

    const updated = await this.tenantPrisma.client.campusConfiguration.update({
      where: { id: before.id },
      data: { data: next as object, version: before.version + 1, updatedBy: userId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.CAMPUS_CONFIGURATION_UPDATED,
      module: AUDIT_MODULES.CAMPUS,
      entityType: 'CampusConfiguration',
      entityId: before.id,
      before: { version: before.version, campusId, sections: Object.keys(dto) },
      after: { version: updated.version, campusId, sections: Object.keys(dto) },
    });

    return this.toConfigResponse(updated);
  }

  // ── Global policies ────────────────────────────────────────────────────

  async getPolicies(tenantId: string): Promise<GlobalCampusPoliciesResponseDto> {
    const config = await this.tenantConfiguration.get(tenantId);
    return {
      version: config.version,
      policies: this.mergePolicies(config.config.policies as GlobalCampusPoliciesDto | null | undefined),
      updatedAt: config.updatedAt,
    };
  }

  async updatePolicies(
    tenantId: string,
    userId: string,
    dto: CampusPoliciesSectionDto,
  ): Promise<GlobalCampusPoliciesResponseDto> {
    const before = await this.tenantConfiguration.get(tenantId);
    const updated = await this.tenantConfiguration.update(tenantId, { policies: dto }, userId);

    // The tenant configuration engine records its own generic TENANT_CONFIGURATION_UPDATED
    // entry; this entry adds the specific, searchable action for the campus policy document.
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.CAMPUS_POLICIES_UPDATED,
      module: AUDIT_MODULES.CAMPUS,
      entityType: 'TenantConfiguration',
      entityId: before.id,
      before: { version: before.version, keys: Object.keys(dto) },
      after: { version: updated.version, keys: Object.keys(dto) },
    });

    return {
      version: updated.version,
      policies: this.mergePolicies(updated.config.policies as GlobalCampusPoliciesDto | null | undefined),
      updatedAt: updated.updatedAt,
    };
  }

  // ── Shared helpers ─────────────────────────────────────────────────────

  private async resolvePolicies(tenantId: string): Promise<GlobalCampusPoliciesDto> {
    const config = await this.tenantConfiguration.get(tenantId);
    return this.mergePolicies(config.config.policies as GlobalCampusPoliciesDto | null | undefined);
  }

  private mergePolicies(policies: GlobalCampusPoliciesDto | null | undefined): GlobalCampusPoliciesDto {
    return { ...DEFAULT_POLICIES, ...(policies ?? {}) };
  }

  private async assertAnalyticsEnabled(tenantId: string): Promise<void> {
    const policies = await this.resolvePolicies(tenantId);
    if (!policies.campusAnalyticsEnabled) {
      throw new ForbiddenException('Campus analytics are disabled by the institution-wide campus policy.');
    }
  }

  private async assertSettingsEnabled(tenantId: string): Promise<void> {
    const policies = await this.resolvePolicies(tenantId);
    if (!policies.campusSettingsEnabled) {
      throw new ForbiddenException('Campus settings edits are disabled by the institution-wide campus policy.');
    }
  }

  /** One configuration row per campus, created lazily (seeded from the global campus defaults). */
  private async findOrCreateConfig(tenantId: string, campusId: string): Promise<CampusConfigRow> {
    const existing = await this.tenantPrisma.client.campusConfiguration.findFirst({ where: { campusId } });
    if (existing) return existing;

    const policies = await this.resolvePolicies(tenantId);
    return this.tenantPrisma.client.campusConfiguration.create({
      data: { tenantId, campusId, data: { timezone: policies.defaultTimezone ?? null } },
    });
  }

  private toConfigResponse(row: CampusConfigRow): CampusConfigurationDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      campusId: row.campusId,
      version: row.version,
      config: this.normalizeDocument(row.data),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private normalizeDocument(data: unknown): CampusSettingsDocument {
    const document = (data ?? {}) as Record<string, unknown>;
    return {
      timezone: (document.timezone as string | null) ?? null,
      branding: (document.branding as CampusSettingsDocument['branding']) ?? null,
      academicCalendar: (document.academicCalendar as CampusSettingsDocument['academicCalendar']) ?? null,
      attendance: (document.attendance as CampusSettingsDocument['attendance']) ?? null,
      fees: (document.fees as CampusSettingsDocument['fees']) ?? null,
      numbering: (document.numbering as CampusSettingsDocument['numbering']) ?? null,
      templates: (document.templates as CampusSettingsDocument['templates']) ?? null,
    };
  }

  /**
   * Aggregate counts per campus, read from the tenant's own operational tables (never a denormalized
   * snapshot, so the overview/compare always reflects current DB state). `allCampuses` true signals
   * GLOBAL access: the `campusIds` list is empty and counts must span the whole tenant; when false,
   * `campusIds` is the explicit allow-list.
   */
  private async collectCounts(campusIds: string[], allCampuses: boolean): Promise<Map<string, CampusCountsDto>> {
    const campusWhere = allCampuses ? {} : { in: campusIds };
    const map = new Map<string, CampusCountsDto>();

    const [departmentRows, studentRows, employeeRows, programRows, paymentRows] = await Promise.all([
      this.tenantPrisma.client.department.groupBy({
        by: ['campusId'],
        where: { deletedAt: null, campusId: campusWhere },
        _count: { _all: true },
      }),
      this.tenantPrisma.client.student.groupBy({
        by: ['campusId'],
        where: { deletedAt: null, campusId: campusWhere },
        _count: { _all: true },
      }),
      this.tenantPrisma.client.employee.groupBy({
        by: ['campusId'],
        where: { deletedAt: null, campusId: campusWhere },
        _count: { _all: true },
      }),
      this.tenantPrisma.client.program.findMany({
        where: { deletedAt: null, department: { campusId: campusWhere } },
        select: { department: { select: { campusId: true } } },
      }),
      this.tenantPrisma.client.studentPayment.findMany({
        where: { status: 'SUCCEEDED', student: { campusId: campusWhere } },
        select: { amountCents: true, student: { select: { campusId: true } } },
      }),
    ]);

    const bucket = (campusId: string | null): CampusCountsDto => {
      if (!campusId) return { departments: 0, programs: 0, students: 0, employees: 0, feeCollectedCents: 0 };
      const existing = map.get(campusId);
      if (existing) return existing;
      const fresh: CampusCountsDto = { departments: 0, programs: 0, students: 0, employees: 0, feeCollectedCents: 0 };
      map.set(campusId, fresh);
      return fresh;
    };

    for (const row of departmentRows) bucket(row.campusId).departments = row._count._all;
    for (const row of studentRows) bucket(row.campusId).students = row._count._all;
    for (const row of employeeRows) bucket(row.campusId).employees = row._count._all;
    for (const row of programRows) {
      const campusId = row.department?.campusId;
      if (campusId) bucket(campusId).programs += 1;
    }
    for (const row of paymentRows) {
      const campusId = row.student.campusId;
      if (campusId) bucket(campusId).feeCollectedCents += row.amountCents;
    }

    return map;
  }
}