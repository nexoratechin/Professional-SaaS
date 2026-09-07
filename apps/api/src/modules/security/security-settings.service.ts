import { BadRequestException, Injectable } from '@nestjs/common';
import { FEATURE_KEYS } from '@college-erp/auth';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantFeaturesService } from '../rbac/tenant-features.service';
import { AuditService } from '../audit/audit.service';
import type { UpdatePlatformSecuritySettingsDto } from './dto/update-platform-security-settings.dto';
import type { UpdateTenantSecuritySettingsDto } from './dto/update-tenant-security-settings.dto';

export interface EffectiveSecuritySettings {
  mfaRequired: boolean;
  passwordHistoryCount: number;
  maxFailedLoginAttempts: number;
  accountLockoutMinutes: number;
  trustedDeviceDays: number;
  notifyOnNewDeviceLogin: boolean;
  blockSuspiciousLogins: boolean;
  mfaGloballyEnabled: boolean;
  suspiciousLoginDetectionEnabled: boolean;
}

/**
 * Owns the platform/tenant security-policy hierarchy: PlatformSecuritySettings (control-plane
 * singleton, global defaults + kill switches) and TenantSecuritySettings (per-tenant overrides).
 * getEffective() is what every login/password/MFA code path actually reads — it merges the two
 * layers so callers never have to know which one supplied a given value. Both settings rows are
 * created lazily with defaults on first access rather than requiring a migration-time seed row
 * per tenant.
 */
@Injectable()
export class SecuritySettingsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantFeatures: TenantFeaturesService,
    private readonly auditService: AuditService,
  ) {}

  async getPlatformSettings() {
    const existing = await this.platformPrisma.client.platformSecuritySettings.findFirst();
    if (existing) {
      return existing;
    }
    return this.platformPrisma.client.platformSecuritySettings.create({ data: {} });
  }

  async updatePlatformSettings(dto: UpdatePlatformSecuritySettingsDto, actorPlatformUserId: string) {
    const current = await this.getPlatformSettings();
    const updated = await this.platformPrisma.client.platformSecuritySettings.update({
      where: { id: current.id },
      data: { ...dto, updatedBy: actorPlatformUserId },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: 'PLATFORM_SECURITY_SETTINGS_UPDATED',
      entityType: 'PlatformSecuritySettings',
      entityId: updated.id,
      before: current,
      after: updated,
    });

    return updated;
  }

  async getTenantSettings(tenantId: string) {
    const existing = await this.platformPrisma.client.tenantSecuritySettings.findUnique({ where: { tenantId } });
    if (existing) {
      return existing;
    }
    return this.platformPrisma.client.tenantSecuritySettings.create({ data: { tenantId } });
  }

  async updateTenantSettings(tenantId: string, dto: UpdateTenantSecuritySettingsDto, actorUserId: string) {
    if (dto.mfaRequired === true) {
      const mfaAvailable = await this.tenantFeatures.isEnabled(tenantId, FEATURE_KEYS.MFA);
      if (!mfaAvailable) {
        throw new BadRequestException("This tenant's plan does not include multi-factor authentication.");
      }
    }

    const current = await this.getTenantSettings(tenantId);
    const updated = await this.platformPrisma.client.tenantSecuritySettings.update({
      where: { tenantId },
      data: { ...dto, updatedBy: actorUserId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: 'TENANT_SECURITY_SETTINGS_UPDATED',
      entityType: 'TenantSecuritySettings',
      entityId: updated.id,
      before: current,
      after: updated,
    });

    return updated;
  }

  /** Resolves the tenant-override-then-platform-default chain into one concrete set of values —
   * the single source every security-sensitive code path (login lockout, MFA enforcement,
   * password history, trusted-device TTL, suspicious-login blocking) should read from. */
  async getEffective(tenantId: string): Promise<EffectiveSecuritySettings> {
    const [tenant, platform, mfaFeatureEnabled] = await Promise.all([
      this.getTenantSettings(tenantId),
      this.getPlatformSettings(),
      this.tenantFeatures.isEnabled(tenantId, FEATURE_KEYS.MFA),
    ]);

    return {
      mfaRequired: tenant.mfaRequired && platform.mfaGloballyEnabled && mfaFeatureEnabled,
      passwordHistoryCount: tenant.passwordHistoryCount ?? platform.defaultPasswordHistoryCount,
      maxFailedLoginAttempts: tenant.maxFailedLoginAttempts ?? platform.defaultMaxFailedLoginAttempts,
      accountLockoutMinutes: tenant.accountLockoutMinutes ?? platform.defaultAccountLockoutMinutes,
      trustedDeviceDays: tenant.trustedDeviceDays ?? platform.defaultTrustedDeviceDays,
      notifyOnNewDeviceLogin: tenant.notifyOnNewDeviceLogin,
      blockSuspiciousLogins: tenant.blockSuspiciousLogins && platform.suspiciousLoginDetectionEnabled,
      mfaGloballyEnabled: platform.mfaGloballyEnabled,
      suspiciousLoginDetectionEnabled: platform.suspiciousLoginDetectionEnabled,
    };
  }

  /** Used by MfaService before allowing enroll — distinct from getEffective().mfaRequired,
   * which asks "is it mandatory"; this asks "is it available at all" (a user can always
   * voluntarily opt in when this is true, regardless of mfaRequired). */
  async isMfaAvailable(tenantId: string): Promise<boolean> {
    const [platform, mfaFeatureEnabled] = await Promise.all([
      this.getPlatformSettings(),
      this.tenantFeatures.isEnabled(tenantId, FEATURE_KEYS.MFA),
    ]);
    return platform.mfaGloballyEnabled && mfaFeatureEnabled;
  }
}
