import { Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import type { UpdateBillingConfigDto } from './dto/update-billing-config.dto';

const CONFIG_ID = 'default';

/**
 * SaaS-wide billing knobs, enforced identically by apps/api (invoice generation, plan-change
 * proration) and apps/worker (renewal, grace suspension, payment retry). A single 'default'
 * row, lazily upserted on first read so billing works before any seeding ever runs.
 */
@Injectable()
export class BillingConfigService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get() {
    return this.platformPrisma.client.billingConfig.upsert({
      where: { id: CONFIG_ID },
      create: { id: CONFIG_ID },
      update: {},
    });
  }

  async update(dto: UpdateBillingConfigDto, actorPlatformUserId: string) {
    const before = await this.get();
    const updated = await this.platformPrisma.client.billingConfig.update({
      where: { id: CONFIG_ID },
      data: {
        taxName: dto.taxName,
        taxRateBps: dto.taxRateBps,
        invoicePrefix: dto.invoicePrefix,
        gracePeriodDays: dto.gracePeriodDays,
        renewalDueDays: dto.renewalDueDays,
        retryIntervalDays: dto.retryIntervalDays,
        prorationEnabled: dto.prorationEnabled,
        updatedByPlatformUserId: actorPlatformUserId,
      },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.BILLING_CONFIG_UPDATED,
      module: AUDIT_MODULES.BILLING,
      entityType: 'BillingConfig',
      entityId: CONFIG_ID,
      before: {
        taxName: before.taxName,
        taxRateBps: before.taxRateBps,
        invoicePrefix: before.invoicePrefix,
        gracePeriodDays: before.gracePeriodDays,
        renewalDueDays: before.renewalDueDays,
        retryIntervalDays: before.retryIntervalDays,
        prorationEnabled: before.prorationEnabled,
      },
      after: {
        taxName: updated.taxName,
        taxRateBps: updated.taxRateBps,
        invoicePrefix: updated.invoicePrefix,
        gracePeriodDays: updated.gracePeriodDays,
        renewalDueDays: updated.renewalDueDays,
        retryIntervalDays: updated.retryIntervalDays,
        prorationEnabled: updated.prorationEnabled,
      },
    });

    return updated;
  }
}