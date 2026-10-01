/**
 * Recurring-revenue math: MRR/ARR normalization, movement decomposition, and churn rates.
 *
 * The rules that matter, stated once:
 *
 *  - MRR is a *normalized monthly* figure. A plan billed annually contributes price/12, not
 *    price. Summing invoice totals into "MRR" is the single most common way a SaaS dashboard
 *    ends up reporting 12x the real recurring revenue for annual contracts.
 *  - ONE_TIME charges are excluded from MRR entirely. They are recognized when invoiced, never
 *    amortized into a run-rate.
 *  - Only ACTIVE/TRIALING/PAST_DUE subscriptions are "recurring". PAST_DUE still owes money and
 *    still occupies a slot, so excluding it would overstate growth; SUSPENDED/CANCELED/EXPIRED
 *    contribute nothing.
 *  - Churn is measured against the *start* of the window, never against the end. Dividing by the
 *    end-of-window base makes a catastrophic churn month look like a mild one.
 */

import { round2 } from './periods';
import {
  RECURRING_SUBSCRIPTION_STATUSES,
  type RecurringSubscriptionStatus,
  type SaasSnapshotMetrics,
  type SubscriptionRevenueInput,
  type TopTenantMrrRow,
  type UsageMetricRow,
} from './types';

const MONTHS_PER_YEAR = 12;

export function isRecurringStatus(status: string): status is RecurringSubscriptionStatus {
  return (RECURRING_SUBSCRIPTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Converts a charge expressed in `cycle` into its monthly equivalent.
 *
 * MONTHLY passes through, ANNUAL divides by 12 (rounded to whole cents - a plan whose annual
 * price is not divisible by 12 must not accumulate fractional cents every month, which would
 * drift the total), ONE_TIME yields 0.
 */
export function normalizeToMonthly(amountCents: number, cycle: string): number {
  if (!Number.isFinite(amountCents) || amountCents <= 0) return 0;
  if (cycle === 'MONTHLY') return Math.round(amountCents);
  if (cycle === 'ANNUAL') return Math.round(amountCents / MONTHS_PER_YEAR);
  // ONE_TIME (and any unknown cycle) is not recurring revenue.
  return 0;
}

/**
 * MRR contributed by one subscription: the plan's own price normalized to a month, plus every
 * metered/add-on line normalized the same way. Quantity multiplies unit price because
 * PER_STUDENT/PER_CAMPUS items are priced per unit.
 */
export function computeSubscriptionMrr(subscription: SubscriptionRevenueInput): number {
  if (!isRecurringStatus(subscription.status)) return 0;

  const base = normalizeToMonthly(subscription.planPriceCents ?? 0, subscription.billingCycle);
  const items = subscription.items.reduce((sum, item) => {
    const unitMonthly = normalizeToMonthly(item.unitPriceCents, subscription.billingCycle);
    if (unitMonthly === 0) return sum;
    return sum + unitMonthly * Math.max(item.quantity, 0);
  }, 0);

  return base + items;
}

/**
 * MRR keyed by tenant id - the unit every movement metric below is expressed in.
 *
 * Tenants that contribute no revenue are deliberately left OUT of the map rather than mapped to
 * zero. `computeMrrMovement` classifies a tenant as churned when it is present in the previous map
 * and absent from the current one, so a paying tenant that cancels must disappear from the map to
 * register as churn. Mapping it to 0 instead would book the whole amount as *contraction* and
 * report revenue churn with no logo churn - technically moving, substantively wrong, and precisely
 * the kind of thing that survives review because both numbers moved.
 */
export function computeMrrByTenant(
  subscriptions: readonly SubscriptionRevenueInput[],
): Map<string, number> {
  const byTenant = new Map<string, number>();
  for (const subscription of subscriptions) {
    const mrr = computeSubscriptionMrr(subscription);
    if (mrr <= 0) continue;
    byTenant.set(subscription.tenantId, (byTenant.get(subscription.tenantId) ?? 0) + mrr);
  }
  return byTenant;
}

export function countBy<T extends object, K extends keyof T>(rows: readonly T[], key: K): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    const bucket = String(row[key] ?? 'UNKNOWN');
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  return counts;
}

/**
 * Decomposes the MRR delta between two points in time into the four movements a board actually
 * asks about. Comparing a per-tenant map (rather than a single before/after total) is what makes
 * "expansion" and "contraction" separable from a large new logo and a large cancellation
 * happening in the same month.
 */
export interface MrrMovement {
  newMrrCents: number;
  expansionMrrCents: number;
  contractionMrrCents: number;
  churnedMrrCents: number;
  netNewMrrCents: number;
  newTenantCount: number;
  churnedTenantCount: number;
}

export function computeMrrMovement(previous: ReadonlyMap<string, number>, current: ReadonlyMap<string, number>): MrrMovement {
  let newMrrCents = 0;
  let expansionMrrCents = 0;
  let contractionMrrCents = 0;
  let churnedMrrCents = 0;
  let newTenantCount = 0;
  let churnedTenantCount = 0;

  for (const [tenantId, mrr] of current) {
    const before = previous.get(tenantId);
    if (before === undefined) {
      newMrrCents += mrr;
      newTenantCount += 1;
      continue;
    }
    if (mrr > before) expansionMrrCents += mrr - before;
    else if (mrr < before) contractionMrrCents += before - mrr;
  }

  for (const [tenantId, mrr] of previous) {
    if (current.has(tenantId)) continue;
    churnedMrrCents += mrr;
    churnedTenantCount += 1;
  }

  return {
    newMrrCents,
    expansionMrrCents,
    contractionMrrCents,
    churnedMrrCents,
    netNewMrrCents: newMrrCents + expansionMrrCents - contractionMrrCents - churnedMrrCents,
    newTenantCount,
    churnedTenantCount,
  };
}

/** Rate helpers. `null` denominator yields 0 rather than NaN/Infinity leaking into JSON. */
export function ratePercent(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator <= 0) return 0;
  return round2((numerator / denominator) * 100);
}

export interface SaasMovementInputs {
  subscriptionsByStatus: Record<string, number>;
  recurringSubscriptionCount: number;
  tenantCountByStatus: Record<string, number>;
  previousMrrByTenant: ReadonlyMap<string, number>;
  currentMrrByTenant: ReadonlyMap<string, number>;
  totalUserCount: number;
  activeUserCount: number;
  /** Sum of PER_STUDENT subscription-item quantities across tenants (the metered student count). */
  meteredStudentCount: number;
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  usageByEventType: UsageMetricRow[];
  tenantNames: ReadonlyMap<string, { name: string; slug: string }>;
  topTenantLimit?: number;
  /** Tenants that existed at the end of the bucket. Derived from the histogram when omitted. */
  totalTenantCount?: number;
  /** Tenants in a live state. Derived from the histogram when omitted. */
  activeTenantCount?: number;
  /** Tenants onboarded inside the window. Zero when the caller has no createdAt column to read. */
  createdTenantCount?: number;
}

/**
 * Assembles the full SaaS rollup for one period. Pure: every input is passed in, so the worker
 * (recomputing from the database) and the API (recomputing on demand) call this identically.
 */
export function buildSaasSnapshotMetrics(inputs: SaasMovementInputs): SaasSnapshotMetrics {
  const movement = computeMrrMovement(inputs.previousMrrByTenant, inputs.currentMrrByTenant);
  const mrrCents = [...inputs.currentMrrByTenant.values()].reduce((sum, value) => sum + value, 0);
  const previousMrrCents = [...inputs.previousMrrByTenant.values()].reduce((sum, value) => sum + value, 0);

  const topTenantsByMrr = buildTopTenantsByMrr(inputs.currentMrrByTenant, inputs.tenantNames, inputs.topTenantLimit ?? 10);

  return {
    mrrCents,
    arrCents: mrrCents * MONTHS_PER_YEAR,
    subscriptionsByStatus: inputs.subscriptionsByStatus,
    recurringSubscriptionCount: inputs.recurringSubscriptionCount,
    tenantCountByStatus: inputs.tenantCountByStatus,
    totalTenantCount:
      inputs.totalTenantCount ?? Object.values(inputs.tenantCountByStatus).reduce((sum, value) => sum + value, 0),
    activeTenantCount:
      inputs.activeTenantCount ??
      (inputs.tenantCountByStatus['ACTIVE'] ?? 0) + (inputs.tenantCountByStatus['TRIAL'] ?? 0),
    createdTenantCount: inputs.createdTenantCount ?? 0,
    newTenantCount: movement.newTenantCount,
    churnedTenantCount: movement.churnedTenantCount,
    newMrrCents: movement.newMrrCents,
    expansionMrrCents: movement.expansionMrrCents,
    contractionMrrCents: movement.contractionMrrCents,
    churnedMrrCents: movement.churnedMrrCents,
    netNewMrrCents: movement.netNewMrrCents,
    customerChurnPercent: ratePercent(movement.churnedTenantCount, inputs.previousMrrByTenant.size),
    mrrChurnPercent: ratePercent(movement.churnedMrrCents, previousMrrCents),
    totalUserCount: inputs.totalUserCount,
    activeUserCount: inputs.activeUserCount,
    meteredStudentCount: inputs.meteredStudentCount,
    billedCents: inputs.billedCents,
    collectedCents: inputs.collectedCents,
    outstandingCents: inputs.outstandingCents,
    usageByEventType: inputs.usageByEventType,
    topTenantsByMrr,
  };
}

function buildTopTenantsByMrr(
  mrrByTenant: ReadonlyMap<string, number>,
  tenantNames: ReadonlyMap<string, { name: string; slug: string }>,
  limit: number,
): TopTenantMrrRow[] {
  return [...mrrByTenant.entries()]
    .filter(([, mrrCents]) => mrrCents > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([tenantId, mrrCents]) => {
      const tenant = tenantNames.get(tenantId);
      return {
        tenantId,
        tenantName: tenant?.name ?? tenantId,
        tenantSlug: tenant?.slug ?? tenantId,
        mrrCents,
      };
    });
}
