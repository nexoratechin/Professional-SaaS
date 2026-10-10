import { Injectable } from '@nestjs/common';
import {
  recomputeTenantEntitlements,
  type Entitlement,
  type EntitlementType,
  type Prisma,
} from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { TenantFeaturesService } from './tenant-features.service';

// The merge/materialization core lives in @college-erp/database so the demo seeder reuses the
// exact same routine (see packages/database/src/provisioning/entitlement-recompute.ts).
// Re-exported here so existing importers (entitlements-merge.spec.ts) keep their import path.
export {
  ENTITLED_SUBSCRIPTION_STATUSES,
  RECOMPUTED_SOURCES,
  mergeCandidates,
  type CandidateRow,
} from '@college-erp/database';

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
    await recomputeTenantEntitlements(this.platformPrisma.client, tenantId);
    await this.tenantFeatures.invalidate(tenantId);
  }

  /** Recompute every tenant currently subscribed to a plan — call this after a Plan's
   * feature/module catalog changes (SaasService.updatePlan/setPlanModules), since a plan-catalog
   * edit affects every tenant on that plan, not just one. */
  async recomputeForPlan(planId: string): Promise<void> {
    const subscriptions = await this.platformPrisma.client.subscription.findMany({
      where: { planId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] } },
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
