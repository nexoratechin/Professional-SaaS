import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, computeInvoiceTotals, proratedShareCents } from '@college-erp/auth';
import type { Prisma, SubscriptionStatus } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import { BillingConfigService, InvoicesService, type BillingActor } from '../billing';
import { EntitlementsService } from '../rbac/entitlements.service';
import type { CancelAtPeriodEndDto } from './dto/cancel-at-period-end.dto';
import type { AddSubscriptionItemDto } from './dto/add-subscription-item.dto';
import type { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import type { CreatePlanDto } from './dto/create-plan.dto';
import type { CreateSubscriptionDto } from './dto/create-subscription.dto';
import type { RecordUsageEventDto } from './dto/record-usage-event.dto';
import type { SetPlanModulesDto } from './dto/set-plan-modules.dto';
import type { TransitionSubscriptionStatusDto } from './dto/transition-subscription-status.dto';
import type { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import type { UpdatePlanDto } from './dto/update-plan.dto';
import type { UpdateSubscriptionItemDto } from './dto/update-subscription-item.dto';

/** Which CURRENT statuses a subscription may legally move FROM to reach a given target status
 * via the explicit activate/suspend/cancel endpoints below — mirrors TenantsService's
 * LEGAL_STATUS_SOURCES state machine. PAST_DUE and EXPIRED are deliberately NOT reachable
 * through these endpoints: PAST_DUE is set when an invoice goes overdue, EXPIRED when the
 * current billing period elapses with nothing to renew it — both system-driven by
 * apps/worker's SubscriptionLifecycleProcessor sweep, never an admin action. CANCELED is
 * terminal, same as Tenant's CANCELED. */
const LEGAL_SUBSCRIPTION_STATUS_SOURCES: Record<'ACTIVE' | 'SUSPENDED' | 'CANCELED', SubscriptionStatus[]> = {
  ACTIVE: ['TRIALING', 'PAST_DUE', 'SUSPENDED'],
  SUSPENDED: ['TRIALING', 'ACTIVE', 'PAST_DUE'],
  CANCELED: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'],
};

@Injectable()
export class SaasService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly auditService: AuditService,
    private readonly invoicesService: InvoicesService,
    private readonly billingConfig: BillingConfigService,
  ) {}

  /** `includeInactive` is for the platform admin management view (see/edit deprecated plans);
   * everywhere else that reads plans (e.g. a future tenant self-signup flow) wants active-only. */
  async listPlans(includeInactive = false) {
    return this.platformPrisma.client.plan.findMany({
      where: includeInactive ? {} : { isActive: true },
      include: { planFeatures: { include: { featureFlag: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getPlan(id: string) {
    return this.platformPrisma.client.plan.findUniqueOrThrow({
      where: { id },
      include: { planFeatures: { include: { featureFlag: true } }, planModules: true },
    });
  }

  async createPlan(dto: CreatePlanDto, actorPlatformUserId: string) {
    const plan = await this.platformPrisma.client.plan.create({
      data: {
        code: dto.code,
        name: dto.name,
        description: dto.description,
        priceCents: dto.priceCents,
        currency: dto.currency ?? 'INR',
        billingCycle: dto.billingCycle ?? 'ANNUAL',
        isCustom: dto.isCustom ?? false,
      },
    });

    if (dto.featureKeys?.length) {
      await this.setPlanFeatures(plan.id, dto.featureKeys);
    }

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PLAN_CREATED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'Plan',
      entityId: plan.id,
      after: { code: plan.code, name: plan.name },
    });

    return this.getPlan(plan.id);
  }

  async updatePlan(id: string, dto: UpdatePlanDto, actorPlatformUserId: string) {
    const before = await this.platformPrisma.client.plan.findUniqueOrThrow({ where: { id } });
    const plan = await this.platformPrisma.client.plan.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        priceCents: dto.priceCents,
        isActive: dto.isActive,
      },
    });

    if (dto.featureKeys) {
      await this.setPlanFeatures(id, dto.featureKeys);
      // A plan's feature catalog affects every tenant currently subscribed to it, not just one —
      // see EntitlementsService.recomputeForPlan.
      await this.entitlements.recomputeForPlan(id);
    }

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PLAN_UPDATED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'Plan',
      entityId: id,
      before: { name: before.name, isActive: before.isActive, priceCents: before.priceCents },
      after: { name: plan.name, isActive: plan.isActive, priceCents: plan.priceCents },
    });

    return this.getPlan(id);
  }

  private async setPlanFeatures(planId: string, featureKeys: string[]): Promise<void> {
    const flags = await this.platformPrisma.client.featureFlag.findMany({ where: { key: { in: featureKeys } } });
    if (flags.length !== new Set(featureKeys).size) {
      throw new BadRequestException('One or more feature keys are invalid.');
    }

    await this.platformPrisma.client.planFeatureFlag.deleteMany({ where: { planId } });
    await this.platformPrisma.client.planFeatureFlag.createMany({
      data: flags.map((flag) => ({ planId, featureFlagId: flag.id })),
    });
  }

  async listFeatureFlags() {
    return this.platformPrisma.client.featureFlag.findMany({ orderBy: [{ module: 'asc' }, { key: 'asc' }] });
  }

  async createFeatureFlag(dto: CreateFeatureFlagDto, actorPlatformUserId: string) {
    const flag = await this.platformPrisma.client.featureFlag.create({
      data: { key: dto.key, name: dto.name, module: dto.module },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.FEATURE_FLAG_CREATED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'FeatureFlag',
      entityId: flag.id,
      after: { key: flag.key, module: flag.module },
    });

    return flag;
  }

  async updateFeatureFlag(id: string, dto: UpdateFeatureFlagDto, actorPlatformUserId: string) {
    const before = await this.platformPrisma.client.featureFlag.findUniqueOrThrow({ where: { id } });
    const flag = await this.platformPrisma.client.featureFlag.update({
      where: { id },
      data: { name: dto.name, isActive: dto.isActive },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.FEATURE_FLAG_UPDATED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'FeatureFlag',
      entityId: id,
      before: { name: before.name, isActive: before.isActive },
      after: { name: flag.name, isActive: flag.isActive },
    });

    return flag;
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

    // Plan change affects which modules a tenant sees — recompute (and invalidate the feature
    // cache) immediately so the new entitlement takes effect on the tenant's very next request,
    // no deploy required.
    await this.entitlements.recompute(dto.tenantId);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: dto.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUBSCRIPTION_CREATED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'Subscription',
      entityId: subscription.id,
      after: { planCode: dto.planCode, billingCycle: dto.billingCycle },
    });

    return subscription;
  }

  async listSubscriptionsForTenant(tenantId: string) {
    return this.platformPrisma.client.subscription.findMany({
      where: { tenantId },
      include: { plan: true, items: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** The single changeable subscription for a tenant's self-service billing view. */
  getTenantActiveSubscription(tenantId: string) {
    return this.platformPrisma.client.subscription.findFirst({
      where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
      orderBy: { createdAt: 'desc' },
      include: { plan: true, items: true },
    });
  }

  async getSubscription(id: string) {
    return this.platformPrisma.client.subscription.findUniqueOrThrow({
      where: { id },
      include: { plan: true, items: true },
    });
  }

  // --- Subscription lifecycle -------------------------------------------------------------

  async activateSubscription(id: string, dto: TransitionSubscriptionStatusDto, actorPlatformUserId: string) {
    return this.transitionSubscriptionStatus(id, 'ACTIVE', dto, actorPlatformUserId);
  }

  async suspendSubscription(id: string, dto: TransitionSubscriptionStatusDto, actorPlatformUserId: string) {
    return this.transitionSubscriptionStatus(id, 'SUSPENDED', dto, actorPlatformUserId);
  }

  async cancelSubscription(id: string, dto: TransitionSubscriptionStatusDto, actorPlatformUserId: string) {
    return this.transitionSubscriptionStatus(id, 'CANCELED', dto, actorPlatformUserId);
  }

  /** Immediate plan change (upgrade/downgrade/side-grade) with prorated credit/charge for the
   *  remainder of the current billing period — the current period boundaries are untouched, so
   *  the next renewal sweep simply rolls the new plan's price forward. Works for TRIALING,
   *  ACTIVE and PAST_DUE subscriptions; a net-credit month yields a nil-total adjustment
   *  invoice and the residual credit is documented but not carried over (v1 simplification).
   *  Entitlements are recomputed immediately (modules/features may differ between plans). */
  async changePlan(subscriptionId: string, planCode: string, by: BillingActor) {
    const subscription = await this.platformPrisma.client.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true, items: true },
    });

    if (!['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(subscription.status)) {
      throw new BadRequestException(`Cannot change the plan of a ${subscription.status} subscription.`);
    }

    const target = await this.platformPrisma.client.plan.findUnique({ where: { code: planCode } });
    if (!target || !target.isActive) {
      throw new BadRequestException(`Unknown or inactive plan code: ${planCode}`);
    }
    if (target.id === subscription.planId) {
      throw new BadRequestException('The subscription is already on this plan.');
    }

    const config = await this.billingConfig.get();
    const currentPrice = subscription.plan.priceCents ?? 0;
    const targetPrice = target.priceCents ?? 0;
    const direction = currentPrice === targetPrice ? 'UNCHANGED' : currentPrice < targetPrice ? 'UPGRADE' : 'DOWNGRADE';

    if (config.prorationEnabled) {
      await this.invoicesService.createProrationInvoice(subscription, target, by);
    }

    await this.platformPrisma.client.subscription.update({
      where: { id: subscriptionId },
      data: { planId: target.id, billingCycle: target.billingCycle },
    });

    await this.entitlements.recompute(subscription.tenantId);

    const action =
      direction === 'UPGRADE'
        ? AUDIT_ACTIONS.SUBSCRIPTION_UPGRADED
        : direction === 'DOWNGRADE'
          ? AUDIT_ACTIONS.SUBSCRIPTION_DOWNGRADED
          : AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CHANGED;

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: subscription.tenantId,
      ...(by.type === 'PLATFORM_USER'
        ? { actorType: 'PLATFORM_USER' as const, actorPlatformUserId: by.platformUserId }
        : { actorType: 'USER' as const, actorUserId: by.userId }),
      action,
      module: AUDIT_MODULES.SAAS,
      entityType: 'Subscription',
      entityId: subscriptionId,
      before: { planCode: subscription.plan.code, priceCents: subscription.plan.priceCents },
      after: { planCode: target.code, priceCents: target.priceCents, prorated: config.prorationEnabled },
    });

    return this.getSubscription(subscriptionId);
  }

  /** Non-mutating cost preview for the tenant UI — same proration math as changePlan, no rows
   *  touched, no invoice created. */
  async previewPlanChange(subscriptionId: string, planCode: string) {
    const subscription = await this.platformPrisma.client.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true, items: true },
    });
    const target = await this.platformPrisma.client.plan.findUnique({ where: { code: planCode } });
    if (!target || !target.isActive) {
      throw new BadRequestException(`Unknown or inactive plan code: ${planCode}`);
    }
    const config = await this.billingConfig.get();

    const now = new Date();
    const remainingCreditCents = subscription.plan.priceCents
      ? proratedShareCents(subscription.plan.priceCents, subscription.currentPeriodStart, subscription.currentPeriodEnd, now)
      : 0;
    const proratedChargeCents = target.priceCents
      ? proratedShareCents(target.priceCents, subscription.currentPeriodStart, subscription.currentPeriodEnd, now)
      : 0;
    const netAmountCents = proratedChargeCents - remainingCreditCents;
    const { taxCents, totalCents } = computeInvoiceTotals(netAmountCents, config.taxRateBps);

    return {
      currentPlan: { id: subscription.plan.id, code: subscription.plan.code, name: subscription.plan.name, priceCents: subscription.plan.priceCents },
      targetPlan: { id: target.id, code: target.code, name: target.name, priceCents: target.priceCents },
      direction: subscription.plan.priceCents === target.priceCents ? 'UNCHANGED' : (subscription.plan.priceCents ?? 0) < (target.priceCents ?? 0) ? 'UPGRADE' : 'DOWNGRADE',
      prorationEnabled: config.prorationEnabled,
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      remainingCreditCents,
      proratedChargeCents,
      netAmountCents,
      taxCents,
      totalCents,
    };
  }

  /** Cancel-at-period-end toggle used by both tenants (BILLING_UPDATE) and platform admins:
   *  set true to stop auto-renewal, false to reinstate. The subscription keeps running until
   *  the current period ends; the worker's renewal sweep turns a cancelAtPeriodEnd subscription
   *  into CANCELED (and skips invoicing) once the period elapses. */
  async setCancelAtPeriodEnd(subscriptionId: string, dto: CancelAtPeriodEndDto, by: BillingActor) {
    const before = await this.platformPrisma.client.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    if (!['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(before.status)) {
      throw new BadRequestException(`Cannot schedule cancellation of a ${before.status} subscription.`);
    }

    const subscription = await this.platformPrisma.client.subscription.update({
      where: { id: subscriptionId },
      data: { cancelAtPeriodEnd: dto.cancelAtPeriodEnd },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: subscription.tenantId,
      ...(by.type === 'PLATFORM_USER'
        ? { actorType: 'PLATFORM_USER' as const, actorPlatformUserId: by.platformUserId }
        : { actorType: 'USER' as const, actorUserId: by.userId }),
      action: dto.cancelAtPeriodEnd ? AUDIT_ACTIONS.SUBSCRIPTION_CANCEL_SCHEDULED : AUDIT_ACTIONS.SUBSCRIPTION_REINSTATED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'Subscription',
      entityId: subscriptionId,
      before: { cancelAtPeriodEnd: before.cancelAtPeriodEnd },
      after: { cancelAtPeriodEnd: subscription.cancelAtPeriodEnd },
    });

    return subscription;
  }

  private async transitionSubscriptionStatus(
    id: string,
    targetStatus: 'ACTIVE' | 'SUSPENDED' | 'CANCELED',
    dto: TransitionSubscriptionStatusDto,
    actorPlatformUserId: string,
  ) {
    const before = await this.platformPrisma.client.subscription.findUniqueOrThrow({ where: { id } });
    const allowedFrom = LEGAL_SUBSCRIPTION_STATUS_SOURCES[targetStatus];
    if (!allowedFrom.includes(before.status)) {
      throw new BadRequestException(
        `Cannot move a ${before.status} subscription to ${targetStatus} (allowed from: ${allowedFrom.join(', ')}).`,
      );
    }

    const subscription = await this.platformPrisma.client.subscription.update({
      where: { id },
      data: {
        status: targetStatus,
        canceledAt: targetStatus === 'CANCELED' ? new Date() : before.canceledAt,
      },
    });

    await this.entitlements.recompute(before.tenantId);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: before.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUBSCRIPTION_STATUS_CHANGED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'Subscription',
      entityId: id,
      before: { status: before.status },
      after: { status: subscription.status, reason: dto.reason },
    });

    return subscription;
  }

  // --- Subscription items ------------------------------------------------------------------

  async listSubscriptionItems(subscriptionId: string) {
    return this.platformPrisma.client.subscriptionItem.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async addSubscriptionItem(subscriptionId: string, dto: AddSubscriptionItemDto, actorPlatformUserId: string) {
    const subscription = await this.platformPrisma.client.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });

    const item = await this.platformPrisma.client.subscriptionItem.create({
      data: {
        tenantId: subscription.tenantId,
        subscriptionId,
        itemType: dto.itemType,
        description: dto.description,
        moduleKey: dto.moduleKey,
        quantity: dto.quantity ?? 1,
        unitPriceCents: dto.unitPriceCents,
        currency: dto.currency ?? 'INR',
      },
    });

    await this.entitlements.recompute(subscription.tenantId);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: subscription.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUBSCRIPTION_ITEM_ADDED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'SubscriptionItem',
      entityId: item.id,
      after: { itemType: item.itemType, description: item.description, moduleKey: item.moduleKey },
    });

    return item;
  }

  async updateSubscriptionItem(itemId: string, dto: UpdateSubscriptionItemDto, actorPlatformUserId: string) {
    const before = await this.platformPrisma.client.subscriptionItem.findUniqueOrThrow({ where: { id: itemId } });
    const item = await this.platformPrisma.client.subscriptionItem.update({
      where: { id: itemId },
      data: {
        description: dto.description,
        moduleKey: dto.moduleKey,
        quantity: dto.quantity,
        unitPriceCents: dto.unitPriceCents,
      },
    });

    await this.entitlements.recompute(before.tenantId);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: before.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUBSCRIPTION_ITEM_UPDATED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'SubscriptionItem',
      entityId: itemId,
      before: { description: before.description, quantity: before.quantity, moduleKey: before.moduleKey },
      after: { description: item.description, quantity: item.quantity, moduleKey: item.moduleKey },
    });

    return item;
  }

  async removeSubscriptionItem(itemId: string, actorPlatformUserId: string): Promise<void> {
    const before = await this.platformPrisma.client.subscriptionItem.findUniqueOrThrow({ where: { id: itemId } });
    await this.platformPrisma.client.subscriptionItem.delete({ where: { id: itemId } });

    await this.entitlements.recompute(before.tenantId);

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: before.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.SUBSCRIPTION_ITEM_REMOVED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'SubscriptionItem',
      entityId: itemId,
      before: { itemType: before.itemType, description: before.description },
    });
  }

  // --- Plan modules --------------------------------------------------------------------------

  async listPlanModules(planId: string) {
    return this.platformPrisma.client.planModule.findMany({ where: { planId }, orderBy: { moduleKey: 'asc' } });
  }

  /** Full replace, same delete-and-recreate approach as setPlanFeatures — the catalog for a
   * plan's add-on modules is small and always sent whole from the admin UI/API caller. */
  async setPlanModules(planId: string, dto: SetPlanModulesDto, actorPlatformUserId: string) {
    await this.platformPrisma.client.plan.findUniqueOrThrow({ where: { id: planId } });

    await this.platformPrisma.client.planModule.deleteMany({ where: { planId } });
    if (dto.modules.length) {
      await this.platformPrisma.client.planModule.createMany({
        data: dto.modules.map((module) => ({
          planId,
          moduleKey: module.moduleKey,
          name: module.name,
          type: module.type,
          limitValue: module.type === 'QUANTITY' ? (module.limitValue ?? 0) : null,
        })),
      });
    }

    // Same reasoning as updatePlan's featureKeys branch — a plan-catalog edit affects every
    // tenant currently subscribed to it.
    await this.entitlements.recomputeForPlan(planId);

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PLAN_MODULES_UPDATED,
      module: AUDIT_MODULES.SAAS,
      entityType: 'Plan',
      entityId: planId,
      after: { moduleKeys: dto.modules.map((module) => module.moduleKey) },
    });

    return this.listPlanModules(planId);
  }

  // --- Usage-based quantity recalculation -----------------------------------------------------

  /** Reconciles PER_STUDENT/PER_CAMPUS subscription-item quantities against live counts (the
   * same STUDENT-role-assignment and Campus proxy metrics TenantsService.getUsage already
   * reports), records a UsageEvent snapshot, and returns what changed. A manual, synchronous
   * admin action — not run by the worker sweep, which is scoped to invoice/subscription status
   * transitions only (see apps/worker's SubscriptionLifecycleProcessor). */
  async recalculateUsageBasedQuantities(subscriptionId: string) {
    const subscription = await this.platformPrisma.client.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { items: true },
    });

    const [studentCount, campusCount] = await Promise.all([
      this.platformPrisma.client.userRole.count({
        where: { tenantId: subscription.tenantId, role: { code: 'STUDENT' } },
      }),
      this.platformPrisma.client.campus.count({ where: { tenantId: subscription.tenantId, deletedAt: null } }),
    ]);

    const updatedItemIds: string[] = [];
    for (const item of subscription.items) {
      const target =
        item.itemType === 'PER_STUDENT' ? studentCount : item.itemType === 'PER_CAMPUS' ? campusCount : null;
      if (target !== null && target !== item.quantity) {
        await this.platformPrisma.client.subscriptionItem.update({ where: { id: item.id }, data: { quantity: target } });
        updatedItemIds.push(item.id);
      }
    }

    await this.platformPrisma.client.usageEvent.create({
      data: {
        tenantId: subscription.tenantId,
        eventType: 'SUBSCRIPTION_USAGE_RECALCULATED',
        quantity: updatedItemIds.length,
        metadata: { studentCount, campusCount, updatedItemIds } as Prisma.InputJsonValue,
      },
    });

    return { studentCount, campusCount, updatedItemIds };
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
