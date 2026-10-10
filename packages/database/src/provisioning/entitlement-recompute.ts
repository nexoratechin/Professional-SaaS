/**
 * Reusable tenant-entitlement recompute.
 *
 * Extracted from apps/api's EntitlementsService.recompute() so the exact same materialization
 * routine can be shared by:
 *   - the request-time service (SaasService subscription lifecycle, plan catalog edits), and
 *   - the demo seeder (packages/database/src/seeding/demo), which seeds a subscription directly
 *     and must materialize the plan's entitlements so the demo tenant's modules actually unlock.
 *
 * The caller owns cache invalidation (TenantFeaturesService) — this module only touches the DB.
 */
import type { EntitlementSource, EntitlementType, PrismaClient } from '@prisma/client';

/** Subscription statuses that entitle a tenant to their plan's features/modules — mirrors the
 * grace-period contract already established by billing (PAST_DUE still has access while payment
 * is chased; SUSPENDED/CANCELED/EXPIRED do not). */
export const ENTITLED_SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'] as const;

/** A source row is deleted and rebuilt on every recompute() EXCEPT TENANT_OVERRIDE, which only
 * ever changes via setOverride/removeOverride. */
export const RECOMPUTED_SOURCES: EntitlementSource[] = ['PLAN', 'PLAN_MODULE', 'SUBSCRIPTION_ITEM'];

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
 * Rebuild every PLAN/PLAN_MODULE/SUBSCRIPTION_ITEM-sourced entitlement row for one tenant from
 * their current subscription. Idempotent; safe to call for a tenant with no qualifying
 * subscription (produces zero non-override entitlements).
 */
export async function recomputeTenantEntitlements(client: PrismaClient, tenantId: string): Promise<void> {
  const subscription = await client.subscription.findFirst({
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
  const overrides = await client.entitlement.findMany({
    where: { tenantId, source: 'TENANT_OVERRIDE' },
    select: { key: true },
  });
  const overrideKeys = new Set(overrides.map((o) => o.key));
  const toCreate = mergeCandidates(candidates).filter((row) => !overrideKeys.has(row.key));
  const effectiveUntil = subscription?.currentPeriodEnd ?? null;

  await client.$transaction([
    client.entitlement.deleteMany({
      where: { tenantId, source: { in: RECOMPUTED_SOURCES } },
    }),
    ...(toCreate.length
      ? [
          client.entitlement.createMany({
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
}
