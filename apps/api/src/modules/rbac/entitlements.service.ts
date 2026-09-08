import { Injectable } from '@nestjs/common';
import type { Entitlement, EntitlementSource, EntitlementType, Prisma } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantFeaturesService } from './tenant-features.service';

/** Subscription statuses that entitle a tenant to their plan's features/modules — mirrors the
 * grace-period contract already established by billing (PAST_DUE still has access while payment
 * is chased; SUSPENDED/CANCELED/EXPIRED do not). */
const ENTITLED_SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'] as const;

/** A source row is deleted and rebuilt on every recompute() EXCEPT TENANT_OVERRIDE, which only
 * ever changes via setOverride/removeOverride below. */
const RECOMPUTED_SOURCES: EntitlementSource[] = ['PLAN', 'PLAN_MODULE', 'SUBSCRIPTION_ITEM'];

/** Precedence when two sources grant the same key within one recompute — later wins for BOOLEAN/
 * mismatched types, sums for QUANTITY (a subscription add-on tops up the plan's base limit
 * rather than replacing it). PLAN < PLAN_MODULE < SUBSCRIPTION_ITEM: the more specific,
 * tenant-particular source should never be silently shadowed by the generic plan-catalog one. */
export type CandidateRow = {
  key: string;
  type: EntitlementType;
  boolValue: boolean;
  limitValue: number | null;
  source: EntitlementSource;
  sourceRef: string;
};

export function mergeCandidates(rows: CandidateRow[]): CandidateRow[] {
  const merged = new Map<string, CandidateRow>();
  for (const row of rows) {
    const existing = merged.get(row.key);
    if (existing && existing.type === 'QUANTITY' && row.type === 'QUANTITY') {
      merged.set(row.key, {
        ...row,
        limitValue: (existing.limitValue ?? 0) + (row.limitValue ?? 0),
      });
    } else {
      merged.set(row.key, row);
    }
  }
  return [...merged.values()];
}

/**
 * The single materialized source of truth entitlement resolution reads from — see Entitlement's
 * doc comment in schema.prisma. Deliberately built on PlatformPrismaService with an explicit
 * tenantId on every method (never TenantScopedPrismaService) so it can be safely injected and
 * called from BOTH the platform realm (SaasService — no resolved tenant HTTP context exists
 * there) and the tenant realm alike, the same DI-scope lesson already applied to
 * WorkflowDefinitionsService.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly tenantFeatures: TenantFeaturesService,
  ) {}

  /** Rebuild every PLAN/PLAN_MODULE/SUBSCRIPTION_ITEM-sourced row for one tenant from their
   * current subscription, then invalidate the tenant's feature cache so the change is visible on
   * the very next request — no separate TenantFeaturesService.invalidate() call needed at any
   * call site. Idempotent; safe to call for a tenant with no qualifying subscription (produces
   * zero non-override entitlements). Call this any time a tenant's subscription status/items
   * change — see SaasService's subscription lifecycle/item-CRUD methods. */
  async recompute(tenantId: string): Promise<void> {
    const subscription = await this.platformPrisma.client.subscription.findFirst({
      where: { tenantId, status: { in: [...ENTITLED_SUBSCRIPTION_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: { include: { planFeatures: { include: { featureFlag: true } }, planModules: true } },
        items: true,
      },
    });

    const candidates: CandidateRow[] = [];
    if (subscription) {
      for (const planFeature of subscription.plan.planFeatures) {
        candidates.push({
          key: planFeature.featureFlag.key,
          type: 'BOOLEAN',
          boolValue: true,
          limitValue: null,
          source: 'PLAN',
          sourceRef: subscription.plan.id,
        });
      }
      for (const planModule of subscription.plan.planModules) {
        candidates.push({
          key: planModule.moduleKey,
          type: planModule.type,
          boolValue: planModule.type === 'BOOLEAN',
          limitValue: planModule.limitValue,
          source: 'PLAN_MODULE',
          sourceRef: planModule.id,
        });
      }
      for (const item of subscription.items) {
        if (!item.moduleKey) continue;
        candidates.push({
          key: item.moduleKey,
          type: 'BOOLEAN',
          boolValue: true,
          limitValue: null,
          source: 'SUBSCRIPTION_ITEM',
          sourceRef: item.id,
        });
      }
    }

    // A TENANT_OVERRIDE always wins and is never touched by recompute (see RECOMPUTED_SOURCES) —
    // so any recomputed candidate for a key an override already occupies must be dropped here,
    // otherwise createMany below would collide with it on the [tenantId, key] unique constraint.
    const overrides = await this.platformPrisma.client.entitlement.findMany({
      where: { tenantId, source: 'TENANT_OVERRIDE' },
      select: { key: true },
    });
    const overrideKeys = new Set(overrides.map((o) => o.key));
    const toCreate = mergeCandidates(candidates).filter((row) => !overrideKeys.has(row.key));
    const effectiveUntil = subscription?.currentPeriodEnd ?? null;

    await this.platformPrisma.client.$transaction([
      this.platformPrisma.client.entitlement.deleteMany({
        where: { tenantId, source: { in: RECOMPUTED_SOURCES } },
      }),
      ...(toCreate.length
        ? [
            this.platformPrisma.client.entitlement.createMany({
              data: toCreate.map((row) => ({
                tenantId,
                key: row.key,
                type: row.type,
                boolValue: row.boolValue,
                limitValue: row.limitValue,
                source: row.source,
                sourceRef: row.sourceRef,
                effectiveUntil,
              })),
            }),
          ]
        : []),
    ]);

    await this.tenantFeatures.invalidate(tenantId);
  }

  /** Recompute every tenant currently subscribed to a plan — call this after a Plan's
   * feature/module catalog changes (SaasService.updatePlan/setPlanModules), since a plan-catalog
   * edit affects every tenant on that plan, not just one. */
  async recomputeForPlan(planId: string): Promise<void> {
    const subscriptions = await this.platformPrisma.client.subscription.findMany({
      where: { planId, status: { in: [...ENTITLED_SUBSCRIPTION_STATUSES] } },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    for (const { tenantId } of subscriptions) {
      await this.recompute(tenantId);
    }
  }

  private async findCurrent(tenantId: string, key: string): Promise<Entitlement | null> {
    return this.platformPrisma.client.entitlement.findFirst({
      where: {
        tenantId,
        key,
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
      },
    });
  }

  async isEntitled(tenantId: string, key: string): Promise<boolean> {
    const row = await this.findCurrent(tenantId, key);
    return row?.boolValue === true;
  }

  async getLimit(tenantId: string, key: string): Promise<number | null> {
    const row = await this.findCurrent(tenantId, key);
    return row?.limitValue ?? null;
  }

  /** Every currently-effective entitlement for a tenant (recomputed + override rows alike) —
   * for the admin/tenant self-service "what am I entitled to" view. */
  async listForTenant(tenantId: string): Promise<Entitlement[]> {
    return this.platformPrisma.client.entitlement.findMany({
      where: { tenantId, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }] },
      orderBy: { key: 'asc' },
    });
  }

  /** A platform admin's manual, one-off grant for a specific tenant — survives recompute()
   * (never deleted by it, see RECOMPUTED_SOURCES above) and never expires on its own
   * (effectiveUntil stays null) since it isn't tied to a billing period. */
  async setOverride(
    tenantId: string,
    params: { key: string; type: EntitlementType; boolValue?: boolean; limitValue?: number; reason?: string },
  ): Promise<Entitlement> {
    const data: Prisma.EntitlementUncheckedCreateInput = {
      tenantId,
      key: params.key,
      type: params.type,
      boolValue: params.boolValue ?? false,
      limitValue: params.limitValue ?? null,
      source: 'TENANT_OVERRIDE',
      sourceRef: null,
      effectiveUntil: null,
      reason: params.reason,
    };

    const result = await this.platformPrisma.client.entitlement.upsert({
      where: { tenantId_key: { tenantId, key: params.key } },
      update: {
        type: data.type,
        boolValue: data.boolValue,
        limitValue: data.limitValue,
        source: 'TENANT_OVERRIDE',
        sourceRef: null,
        effectiveUntil: null,
        reason: data.reason,
      },
      create: data,
    });

    await this.tenantFeatures.invalidate(tenantId);
    return result;
  }

  async removeOverride(tenantId: string, key: string): Promise<void> {
    await this.platformPrisma.client.entitlement.deleteMany({
      where: { tenantId, key, source: 'TENANT_OVERRIDE' },
    });
    await this.tenantFeatures.invalidate(tenantId);
  }
}
