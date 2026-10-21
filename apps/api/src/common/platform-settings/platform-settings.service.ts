import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { AuditService } from '../../modules/audit/audit.service';
import { PlatformPrismaService } from '../prisma/platform-prisma.service';

/** The singleton row's fixed id — a table with exactly one meaningful record. */
const SINGLETON_ID = 'singleton';

export interface MaintenanceModeState {
  enabled: boolean;
  message: string | null;
  endsAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
}

export interface UpdateMaintenanceModeInput {
  enabled: boolean;
  message?: string | null;
  endsAt?: string | null;
}

/**
 * Control-plane settings that are not tied to a tenant.
 *
 * Today this is the platform maintenance window: one switch that refuses tenant-realm sign-ins
 * across the whole estate. It deliberately lives in `common/` (not `modules/platform-ops`) because
 * AuthService — the code path that must honor the switch — is not a platform-ops consumer.
 */
@Injectable()
export class PlatformSettingsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
  ) {}

  async getMaintenanceMode(): Promise<MaintenanceModeState> {
    const row = await this.platformPrisma.client.platformMaintenanceMode.findUnique({
      where: { id: SINGLETON_ID },
    });
    if (!row) {
      return { enabled: false, message: null, endsAt: null, updatedBy: null, updatedAt: null };
    }
    return {
      enabled: row.enabled,
      message: row.message,
      endsAt: row.endsAt,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  async hasActiveMaintenanceWindow(): Promise<boolean> {
    return (await this.getMaintenanceMode()).enabled;
  }

  async updateMaintenanceMode(
    input: UpdateMaintenanceModeInput,
    actorPlatformUserId: string,
  ): Promise<MaintenanceModeState> {
    const before = await this.getMaintenanceMode();
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;

    const row = await this.platformPrisma.client.platformMaintenanceMode.upsert({
      where: { id: SINGLETON_ID },
      update: {
        enabled: input.enabled,
        message: input.message ?? null,
        endsAt,
        updatedBy: actorPlatformUserId,
      },
      create: {
        id: SINGLETON_ID,
        enabled: input.enabled,
        message: input.message ?? null,
        endsAt,
        updatedBy: actorPlatformUserId,
      },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PLATFORM_MAINTENANCE_MODE_UPDATED,
      module: AUDIT_MODULES.PLATFORM,
      entityType: 'PlatformMaintenanceMode',
      entityId: SINGLETON_ID,
      before: { enabled: before.enabled, message: before.message, endsAt: before.endsAt },
      after: { enabled: row.enabled, message: row.message, endsAt: row.endsAt },
    });

    return {
      enabled: row.enabled,
      message: row.message,
      endsAt: row.endsAt,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Called by tenant login (and only tenant login). The platform realm is intentionally exempt:
   * if maintenance also locked operators out, nobody could turn it back off.
   */
  async assertTenantLoginAllowed(): Promise<void> {
    const mode = await this.getMaintenanceMode();
    if (!mode.enabled) return;

    const base = mode.message?.trim() || 'The service is temporarily unavailable for scheduled maintenance.';
    const until = mode.endsAt ? ` We expect to be back by ${mode.endsAt.toLocaleString('en-GB', { timeZone: 'UTC' })} UTC.` : '';
    throw new ServiceUnavailableException(`${base}${until}`);
  }
}
