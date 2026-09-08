import { BadRequestException, Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { Prisma, TenantStatus } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantLookupService } from '../../common/tenant/tenant-lookup.service';
import { AuditService } from '../audit/audit.service';
import { EntitlementsGatewayService } from '../rbac/entitlements-gateway.service';
import { EntitlementsService } from '../rbac/entitlements.service';
import { TenantFeaturesService } from '../rbac/tenant-features.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { ListTenantsDto } from './dto/list-tenants.dto';
import type { SetEntitlementOverrideDto } from './dto/set-entitlement-override.dto';
import type { SetTenantFeatureOverrideDto } from './dto/set-tenant-feature-override.dto';
import type { TransitionTenantStatusDto } from './dto/transition-tenant-status.dto';
import type { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import type { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantProvisioningService } from './tenant-provisioning.service';

/** Which CURRENT statuses a tenant may legally move FROM to reach a given target status via the
 * explicit activate/suspend/deactivate endpoints below. CANCELED is terminal — deliberately not
 * a source for any transition, and not a target any of these three legal-transition lists point
 * back INTO once reached (the generic PATCH /tenants/:id/status endpoint still allows forcing
 * any status directly, for support/testing edge cases — this state machine only constrains the
 * three semantic lifecycle actions). */
const LEGAL_STATUS_SOURCES: Record<'ACTIVE' | 'SUSPENDED' | 'CANCELED', TenantStatus[]> = {
  ACTIVE: ['TRIAL', 'SUSPENDED'],
  SUSPENDED: ['TRIAL', 'ACTIVE'],
  CANCELED: ['TRIAL', 'ACTIVE', 'SUSPENDED'],
};

@Injectable()
export class TenantsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly tenantLookup: TenantLookupService,
    private readonly tenantFeatures: TenantFeaturesService,
    private readonly entitlements: EntitlementsService,
    private readonly entitlementGateway: EntitlementsGatewayService,
    private readonly auditService: AuditService,
  ) {}

  async createTenant(dto: CreateTenantDto, actorPlatformUserId: string) {
    const tenant = await this.platformPrisma.client.tenant.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        billingEmail: dto.billingEmail,
        timezone: dto.timezone ?? 'Asia/Kolkata',
        createdBy: actorPlatformUserId,
      },
    });

    await this.provisioning.provisionDefaultAdmin({
      tenantId: tenant.id,
      email: dto.adminEmail,
      fullName: dto.adminFullName,
      password: dto.adminPassword,
      createdBy: actorPlatformUserId,
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: tenant.id,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.TENANT_CREATED,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'Tenant',
      entityId: tenant.id,
      after: { slug: tenant.slug, name: tenant.name },
    });

    return tenant;
  }

  /** Tenant search/listing for the platform admin area — filters by slug/name substring and/or
   * status, paginated. Returns { data, total } so the caller can render real pagination; the
   * controller puts `total` on an X-Total-Count header rather than the body, keeping the body a
   * plain array for consistency with every other list endpoint in this codebase. */
  async listTenants(query: ListTenantsDto = {}) {
    const where: Prisma.TenantWhereInput = {
      status: query.status,
      ...(query.q
        ? { OR: [{ slug: { contains: query.q, mode: 'insensitive' } }, { name: { contains: query.q, mode: 'insensitive' } }] }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.platformPrisma.client.tenant.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.platformPrisma.client.tenant.count({ where }),
    ]);

    return { data, total };
  }

  async getTenant(id: string) {
    return this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id } });
  }

  /** Tenant usage — active/total users, a proxy student count (no Student entity exists yet; see
   * below), storage consumption (summed from Document.sizeBytes — already tracked, no separate
   * MinIO bucket scan needed), org-unit counts, and the most recent raw UsageEvent rows. Always
   * explicit-tenantId, read via the unscoped PlatformPrismaService — this is the platform admin
   * looking INTO a tenant with explicit context, never an implicit "current tenant". */
  async getUsage(tenantId: string) {
    await this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } });

    const [totalUsers, activeUsers, studentRoleHolders, documentAgg, campusCount, departmentCount, recentUsageEvents] =
      await Promise.all([
        this.platformPrisma.client.user.count({ where: { tenantId } }),
        this.platformPrisma.client.user.count({ where: { tenantId, status: 'ACTIVE' } }),
        this.platformPrisma.client.userRole.count({ where: { tenantId, role: { code: 'STUDENT' } } }),
        this.platformPrisma.client.document.aggregate({
          where: { tenantId, deletedAt: null },
          _sum: { sizeBytes: true },
          _count: true,
        }),
        this.platformPrisma.client.campus.count({ where: { tenantId, deletedAt: null } }),
        this.platformPrisma.client.department.count({ where: { tenantId, deletedAt: null } }),
        this.platformPrisma.client.usageEvent.findMany({
          where: { tenantId },
          orderBy: { occurredAt: 'desc' },
          take: 20,
        }),
      ]);

    return {
      totalUsers,
      activeUsers,
      // Proxy metric: count of distinct STUDENT-role assignments, not a real Student entity —
      // the Students module hasn't been built yet (see this task's summary). Revisit once it is.
      studentCount: studentRoleHolders,
      storageUsedBytes: documentAgg._sum.sizeBytes ?? 0,
      documentCount: documentAgg._count,
      campusCount,
      departmentCount,
      recentUsageEvents,
    };
  }

  async updateStatus(id: string, dto: UpdateTenantStatusDto, actorPlatformUserId: string) {
    const before = await this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id } });
    const tenant = await this.platformPrisma.client.tenant.update({
      where: { id },
      data: { status: dto.status, updatedBy: actorPlatformUserId },
    });
    await this.tenantLookup.invalidate(tenant.slug);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: id,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.TENANT_STATUS_CHANGED,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'Tenant',
      entityId: id,
      before: { status: before.status },
      after: { status: tenant.status },
    });

    return tenant;
  }

  /** Explicit, validated lifecycle actions — unlike the generic updateStatus() above (kept for
   * support/testing edge cases, forces any status unconditionally), these enforce the legal
   * transition graph in LEGAL_STATUS_SOURCES so e.g. a CANCELED (terminal) tenant can never be
   * silently "activated" back to life through the wrong endpoint. */
  async activate(id: string, dto: TransitionTenantStatusDto, actorPlatformUserId: string) {
    return this.transitionStatus(id, 'ACTIVE', dto, actorPlatformUserId);
  }

  async suspend(id: string, dto: TransitionTenantStatusDto, actorPlatformUserId: string) {
    return this.transitionStatus(id, 'SUSPENDED', dto, actorPlatformUserId);
  }

  async deactivate(id: string, dto: TransitionTenantStatusDto, actorPlatformUserId: string) {
    return this.transitionStatus(id, 'CANCELED', dto, actorPlatformUserId);
  }

  private async transitionStatus(
    id: string,
    targetStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELED',
    dto: TransitionTenantStatusDto,
    actorPlatformUserId: string,
  ) {
    const before = await this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id } });
    const allowedFrom = LEGAL_STATUS_SOURCES[targetStatus];
    if (!allowedFrom.includes(before.status)) {
      throw new BadRequestException(
        `Cannot move a ${before.status} tenant to ${targetStatus} (allowed from: ${allowedFrom.join(', ')}).`,
      );
    }

    const tenant = await this.platformPrisma.client.tenant.update({
      where: { id },
      data: { status: targetStatus, updatedBy: actorPlatformUserId },
    });
    await this.tenantLookup.invalidate(tenant.slug);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: id,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.TENANT_STATUS_CHANGED,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'Tenant',
      entityId: id,
      before: { status: before.status },
      after: { status: tenant.status, reason: dto.reason },
    });

    return tenant;
  }

  async getSelfServiceSettings(tenantId: string) {
    return this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  }

  async updateSelfServiceSettings(tenantId: string, dto: UpdateTenantSettingsDto, actorUserId: string) {
    const before = await this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const tenant = await this.platformPrisma.client.tenant.update({
      where: { id: tenantId },
      data: { ...dto, updatedBy: actorUserId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.TENANT_SETTINGS_UPDATED,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'Tenant',
      entityId: tenantId,
      before: { name: before.name, timezone: before.timezone },
      after: { name: tenant.name, timezone: tenant.timezone },
    });

    return tenant;
  }

  async getEffectiveFeatures(tenantId: string) {
    return this.tenantFeatures.getEffectiveFeatures(tenantId);
  }

  /** Effective entitlements (module flags + granular keys) via the centralized gateway. */
  async getEffectiveEntitlements(tenantId: string) {
    return this.entitlementGateway.listEffectiveEntitlements(tenantId);
  }

  async setFeatureOverride(tenantId: string, dto: SetTenantFeatureOverrideDto, actorPlatformUserId: string) {
    const flag = await this.platformPrisma.client.featureFlag.findUniqueOrThrow({ where: { key: dto.featureKey } });

    const override = await this.platformPrisma.client.tenantFeatureFlag.upsert({
      where: { tenantId_featureFlagId: { tenantId, featureFlagId: flag.id } },
      update: { enabled: dto.enabled, reason: dto.reason, createdByPlatformUserId: actorPlatformUserId },
      create: {
        tenantId,
        featureFlagId: flag.id,
        enabled: dto.enabled,
        reason: dto.reason,
        createdByPlatformUserId: actorPlatformUserId,
      },
    });

    await this.tenantFeatures.invalidate(tenantId);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.TENANT_FEATURE_OVERRIDE_SET,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'TenantFeatureFlag',
      entityId: override.id,
      after: { featureKey: dto.featureKey, enabled: dto.enabled },
    });

    return override;
  }

  /** Every currently-effective entitlement for a tenant — the QUANTITY/PlanModule-aware
   * superset of getEffectiveFeatures, for the platform admin's tenant-detail view. */
  async listEntitlements(tenantId: string) {
    return this.entitlements.listForTenant(tenantId);
  }

  async setEntitlementOverride(tenantId: string, dto: SetEntitlementOverrideDto, actorPlatformUserId: string) {
    const entitlement = await this.entitlements.setOverride(tenantId, {
      key: dto.key,
      type: dto.type,
      boolValue: dto.boolValue,
      limitValue: dto.limitValue,
      reason: dto.reason,
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.ENTITLEMENT_OVERRIDE_SET,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'Entitlement',
      entityId: entitlement.id,
      after: { key: dto.key, type: dto.type, boolValue: dto.boolValue, limitValue: dto.limitValue },
    });

    return entitlement;
  }

  async removeEntitlementOverride(tenantId: string, key: string, actorPlatformUserId: string): Promise<void> {
    await this.entitlements.removeOverride(tenantId, key);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.ENTITLEMENT_OVERRIDE_SET,
      module: AUDIT_MODULES.TENANTS,
      entityType: 'Entitlement',
      entityId: key,
      after: { key, removed: true },
    });
  }
}
