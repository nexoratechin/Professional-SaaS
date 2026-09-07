import { Injectable } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantLookupService } from '../../common/tenant/tenant-lookup.service';
import { AuditService } from '../audit/audit.service';
import { TenantFeaturesService } from '../rbac/tenant-features.service';
import type { CreateTenantDto } from './dto/create-tenant.dto';
import type { SetTenantFeatureOverrideDto } from './dto/set-tenant-feature-override.dto';
import type { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import type { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantProvisioningService } from './tenant-provisioning.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly provisioning: TenantProvisioningService,
    private readonly tenantLookup: TenantLookupService,
    private readonly tenantFeatures: TenantFeaturesService,
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
      action: 'TENANT_CREATED',
      entityType: 'Tenant',
      entityId: tenant.id,
      after: { slug: tenant.slug, name: tenant.name },
    });

    return tenant;
  }

  async listTenants() {
    return this.platformPrisma.client.tenant.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getTenant(id: string) {
    return this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id } });
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
      action: 'TENANT_STATUS_CHANGED',
      entityType: 'Tenant',
      entityId: id,
      before: { status: before.status },
      after: { status: tenant.status },
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
      action: 'TENANT_SETTINGS_UPDATED',
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
      action: 'TENANT_FEATURE_OVERRIDE_SET',
      entityType: 'TenantFeatureFlag',
      entityId: override.id,
      after: { featureKey: dto.featureKey, enabled: dto.enabled },
    });

    return override;
  }
}
