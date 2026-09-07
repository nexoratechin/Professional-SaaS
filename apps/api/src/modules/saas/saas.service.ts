import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantFeaturesService } from '../rbac/tenant-features.service';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto';
import type { RecordUsageEventDto } from './dto/record-usage-event.dto';

@Injectable()
export class SaasService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantFeatures: TenantFeaturesService,
    private readonly auditService: AuditService,
  ) {}

  async listPlans() {
    return this.platformPrisma.client.plan.findMany({
      where: { isActive: true },
      include: { planFeatures: { include: { featureFlag: true } } },
    });
  }

  async createSubscription(dto: CreateSubscriptionDto, actorPlatformUserId: string) {
    const plan = await this.platformPrisma.client.plan.findUnique({ where: { code: dto.planCode } });
    if (!plan) {
      throw new NotFoundException(`Unknown plan code: ${dto.planCode}`);
    }

    const subscription = await this.platformPrisma.client.subscription.create({
      data: {
        tenantId: dto.tenantId,
        planId: plan.id,
        status: 'ACTIVE',
        billingCycle: dto.billingCycle,
        currentPeriodStart: new Date(dto.currentPeriodStart),
        currentPeriodEnd: new Date(dto.currentPeriodEnd),
      },
    });

    // Plan change affects which modules a tenant sees — invalidate immediately so the new
    // entitlement takes effect on the tenant's very next request, no deploy required.
    await this.tenantFeatures.invalidate(dto.tenantId);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: dto.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: 'SUBSCRIPTION_CREATED',
      entityType: 'Subscription',
      entityId: subscription.id,
      after: { planCode: dto.planCode, billingCycle: dto.billingCycle },
    });

    return subscription;
  }

  async listSubscriptionsForTenant(tenantId: string) {
    return this.platformPrisma.client.subscription.findMany({
      where: { tenantId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async recordUsageEvent(dto: RecordUsageEventDto) {
    return this.platformPrisma.client.usageEvent.create({
      data: {
        tenantId: dto.tenantId,
        eventType: dto.eventType,
        quantity: dto.quantity,
        metadata: dto.metadata as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
