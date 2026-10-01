/**
 * The SaaS (control-plane) analytics dashboard: MRR/ARR, tenants, subscriptions, churn, revenue,
 * usage and the student/user counts the platform meters.
 *
 * Lives in PlatformOpsModule rather than the tenant AnalyticsModule for the same reason the existing
 * platform dashboard does: these routes authenticate with `PlatformAuthGuard` and read through the
 * **unscoped** client across every tenant, and `TenantResolutionMiddleware` skips `platform/**`
 * entirely - so there is no tenant context to scope anything to. What is shared with the tenant
 * side is `AnalyticsReadService`, which owns the `AnalyticsSnapshot` access convention, and
 * `computeSaasRollup` itself, which is the same function the worker runs.
 *
 * The stock/flow discipline is the same as the college side and for the same reasons: MRR and the
 * tenant counts are read from the newest bucket, revenue and movement are summed over the window,
 * and rates are re-derived from the summed parts rather than averaged.
 */

import { Injectable } from '@nestjs/common';
import {
  PLATFORM_SCOPE_KEY,
  computeSaasRollup,
  round2,
  toFiniteNumber,
  type AnalyticsPrisma,
  type SaasSnapshotMetrics,
  type TopTenantMrrRow,
  type UsageMetricRow,
} from '@college-erp/analytics';
import type { AnalyticsUsageByTenantDto, SaasAnalyticsOverviewDto, SaasUsageAnalyticsDto } from '@college-erp/types';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AnalyticsReadService } from '../analytics/analytics-read.service';
import type { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import { buildWindowSeries, metricNumber, resolveAnalyticsWindow, toWindowDto, type SeriesSpec } from '../analytics/analytics-window';

/** What the platform charts plot. */
const SAAS_SERIES: readonly SeriesSpec[] = [
  { metric: 'mrr', label: 'MRR', unit: 'CURRENCY_CENTS', value: (m) => metricNumber(m, 'mrrCents') },
  { metric: 'netNewMrr', label: 'Net new MRR', unit: 'CURRENCY_CENTS', value: (m) => metricNumber(m, 'netNewMrrCents') },
  { metric: 'mrrChurnPercent', label: 'MRR churn %', unit: 'PERCENT', value: (m) => metricNumber(m, 'mrrChurnPercent') },
  { metric: 'activeTenants', label: 'Active tenants', unit: 'COUNT', value: (m) => metricNumber(m, 'activeTenantCount') },
  { metric: 'activeUsers', label: 'Sign-ins', unit: 'COUNT', value: (m) => metricNumber(m, 'activeUserCount') },
  { metric: 'meteredStudents', label: 'Metered students', unit: 'COUNT', value: (m) => metricNumber(m, 'meteredStudentCount') },
  { metric: 'billed', label: 'Billed', unit: 'CURRENCY_CENTS', value: (m) => metricNumber(m, 'billedCents') },
  { metric: 'collected', label: 'Collected', unit: 'CURRENCY_CENTS', value: (m) => metricNumber(m, 'collectedCents') },
];

/** Tenants listed in the usage drill-down. Keeps the response bounded regardless of platform size. */
const USAGE_TENANT_LIMIT = 25;

function histogram(row: Record<string, unknown>, field: string): Record<string, number> {
  const value = row[field];
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    out[key] = toFiniteNumber(count);
  }
  return out;
}

function topTenants(value: unknown): TopTenantMrrRow[] {  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    if (typeof row['tenantId'] !== 'string') return [];
    return [
      {
        tenantId: row['tenantId'],
        tenantName: typeof row['tenantName'] === 'string' ? row['tenantName'] : row['tenantId'],
        tenantSlug: typeof row['tenantSlug'] === 'string' ? row['tenantSlug'] : row['tenantId'],
        mrrCents: toFiniteNumber(row['mrrCents']),
      },
    ];
  });
}

function usageRows(value: unknown): UsageMetricRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const row = entry as Record<string, unknown>;
    return [
      {
        eventType: typeof row['eventType'] === 'string' ? row['eventType'] : 'UNKNOWN',
        quantity: toFiniteNumber(row['quantity']),
        eventCount: toFiniteNumber(row['eventCount']),
      },
    ];
  });
}

/**
 * Same defensive boundary as the college side: `metrics` is JSONB written by a possibly different
 * release, so every field is normalized before arithmetic rather than trusted to be present.
 */
function normalizeSaasMetrics(raw: unknown): SaasSnapshotMetrics {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    mrrCents: toFiniteNumber(row['mrrCents']),
    arrCents: toFiniteNumber(row['arrCents']),
    subscriptionsByStatus: histogram(row, 'subscriptionsByStatus'),
    recurringSubscriptionCount: toFiniteNumber(row['recurringSubscriptionCount']),
    tenantCountByStatus: histogram(row, 'tenantCountByStatus'),
    totalTenantCount: toFiniteNumber(row['totalTenantCount']),
    activeTenantCount: toFiniteNumber(row['activeTenantCount']),
    createdTenantCount: toFiniteNumber(row['createdTenantCount']),
    newTenantCount: toFiniteNumber(row['newTenantCount']),
    churnedTenantCount: toFiniteNumber(row['churnedTenantCount']),
    newMrrCents: toFiniteNumber(row['newMrrCents']),
    expansionMrrCents: toFiniteNumber(row['expansionMrrCents']),
    contractionMrrCents: toFiniteNumber(row['contractionMrrCents']),
    churnedMrrCents: toFiniteNumber(row['churnedMrrCents']),
    netNewMrrCents: toFiniteNumber(row['netNewMrrCents']),
    customerChurnPercent: toFiniteNumber(row['customerChurnPercent']),
    mrrChurnPercent: toFiniteNumber(row['mrrChurnPercent']),
    totalUserCount: toFiniteNumber(row['totalUserCount']),
    activeUserCount: toFiniteNumber(row['activeUserCount']),
    meteredStudentCount: toFiniteNumber(row['meteredStudentCount']),
    billedCents: toFiniteNumber(row['billedCents']),
    collectedCents: toFiniteNumber(row['collectedCents']),
    outstandingCents: toFiniteNumber(row['outstandingCents']),
    usageByEventType: usageRows(row['usageByEventType']),
    topTenantsByMrr: topTenants(row['topTenantsByMrr']),
  };
}

@Injectable()
export class PlatformAnalyticsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly read: AnalyticsReadService,
  ) {}

  async overview(query: AnalyticsQueryDto): Promise<SaasAnalyticsOverviewDto> {
    const window = resolveAnalyticsWindow(query);
    const { metricsByKey, meta } = await this.read.readWindow(
      this.client(),
      'PLATFORM',
      PLATFORM_SCOPE_KEY,
      window,
      (bucket) => computeSaasRollup(this.client(), { period: bucket }),
      { live: query.live === true },
    );

    const history = window.buckets
      .map((bucket) => metricsByKey.get(bucket.key))
      .filter((raw): raw is unknown => raw !== undefined)
      .map(normalizeSaasMetrics);

    const latest: SaasSnapshotMetrics = history[history.length - 1] ?? normalizeSaasMetrics(null);

    const billedCents = sum(history, (metrics) => metrics.billedCents);
    const collectedCents = sum(history, (metrics) => metrics.collectedCents);

    return {
      window: toWindowDto(window),
      meta,
      // Stocks, as of the newest bucket. Summing MRR across 30 daily buckets would report 30x the
      // recurring revenue.
      mrrCents: latest.mrrCents,
      arrCents: latest.arrCents,
      customerChurnPercent: latest.customerChurnPercent,
      mrrChurnPercent: latest.mrrChurnPercent,
      // Movement is per-bucket, so over a window it sums: this is the window's new/expansion/
      // contraction/churn split, not a single bucket's.
      newMrrCents: sum(history, (metrics) => metrics.newMrrCents),
      expansionMrrCents: sum(history, (metrics) => metrics.expansionMrrCents),
      contractionMrrCents: sum(history, (metrics) => metrics.contractionMrrCents),
      churnedMrrCents: sum(history, (metrics) => metrics.churnedMrrCents),
      netNewMrrCents: sum(history, (metrics) => metrics.netNewMrrCents),
      totalTenants: latest.totalTenantCount,
      activeTenants: latest.activeTenantCount,
      // Tenants onboarded in the window - distinct from newTenantCount (new *paying* logos the MRR
      // movement found), because a tenant can exist for months before it subscribes.
      createdTenants: sum(history, (metrics) => metrics.createdTenantCount),
      newTenantCount: sum(history, (metrics) => metrics.newTenantCount),
      churnedTenantCount: sum(history, (metrics) => metrics.churnedTenantCount),
      tenantCountByStatus: latest.tenantCountByStatus,
      subscriptionsByStatus: latest.subscriptionsByStatus,
      recurringSubscriptionCount: latest.recurringSubscriptionCount,
      totalUserCount: latest.totalUserCount,
      /**
       * Sign-ins in the newest bucket. `User.lastLoginAt` is one column, so a per-bucket count
       * double-counts anyone who signed in on several days; summing 30 daily buckets would report
       * user-*days*. The `activeUsers` series carries the per-bucket trend.
       */
      activeUserCount: latest.activeUserCount,
      // Sum of PER_STUDENT subscription-item quantities - the same number the billing engine meters
      // and invoices against, so the platform view cannot drift from what tenants were charged.
      meteredStudentCount: latest.meteredStudentCount,
      billedCents,
      collectedCents,
      // Re-derived over the whole window: summing per-bucket residuals would count a single
      // receivable twice when it was billed in one bucket and collected in the next.
      outstandingCents: Math.max(billedCents - collectedCents, 0),
      usageByEventType: mergeUsage(history),
      topTenantsByMrr: latest.topTenantsByMrr,
      series: buildWindowSeries(window.buckets, window.granularity, metricsByKey, SAAS_SERIES),
    };
  }

  /**
   * Metered-usage drill-down.
   *
   * Deliberately a live GROUP BY rather than a snapshot read: `UsageEvent` has a
   * `(tenant_id, event_type, occurred_at)` index and the rollup's `usageByEventType` only keeps
   * event-type totals, with no per-tenant dimension. The query is two aggregates and the platform
   * row count in `usage_events` is orders of magnitude below any tenant's transactional ledger, so
   * materializing this would cost a table to answer a question the database answers in one pass.
   */
  async usage(query: AnalyticsQueryDto): Promise<SaasUsageAnalyticsDto> {
    const window = resolveAnalyticsWindow(query);
    const where = { occurredAt: { gte: window.from, lt: window.to } };

    // Ranked at the TENANT level, not the (tenant, eventType) level: grouping by the pair and
    // collapsing in Node would mean the database had to return one row per tenant per event type
    // before the top-N cut could be applied, which is unbounded. Grouping by tenant alone makes
    // `take` mean what it says.
    const [byEventType, rankedTenants, distinctTenants] = await Promise.all([
      this.platformPrisma.client.usageEvent.groupBy({
        by: ['eventType'],
        where,
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      this.platformPrisma.client.usageEvent.groupBy({
        by: ['tenantId'],
        where,
        _sum: { quantity: true },
        _count: { _all: true },
        orderBy: { _sum: { quantity: 'desc' } },
        take: USAGE_TENANT_LIMIT,
      }),
      this.countDistinctTenants(window),
    ]);

    const eventRows: UsageMetricRow[] = byEventType.map((row) => ({
      eventType: row.eventType,
      quantity: toFiniteNumber(row._sum.quantity),
      eventCount: row._count._all,
    }));

    // Second pass, bounded by `take` x eventType count: the biggest contributor for each listed
    // tenant, which is what the summary line shows.
    const topIds = rankedTenants.map((row) => row.tenantId);
    const topEventTypeByTenant = new Map<string, string>();
    if (topIds.length > 0) {
      const breakdown = await this.platformPrisma.client.usageEvent.groupBy({
        by: ['tenantId', 'eventType'],
        where: { ...where, tenantId: { in: topIds } },
        _sum: { quantity: true },
      });
      const best = new Map<string, { eventType: string; quantity: number }>();
      for (const row of breakdown) {
        const quantity = toFiniteNumber(row._sum.quantity);
        const current = best.get(row.tenantId);
        if (!current || quantity > current.quantity) {
          best.set(row.tenantId, { eventType: row.eventType, quantity });
        }
      }
      for (const [tenantId, entry] of best) topEventTypeByTenant.set(tenantId, entry.eventType);
    }

    const tenants = await this.platformPrisma.client.tenant.findMany({
      where: { id: { in: topIds } },
      select: { id: true, name: true, slug: true },
    });
    const tenantById = new Map(tenants.map((tenant) => [tenant.id, tenant]));

    const byTenantRows: AnalyticsUsageByTenantDto[] = rankedTenants.map((row) => {
      const tenant = tenantById.get(row.tenantId);
      return {
        tenantId: row.tenantId,
        tenantName: tenant?.name ?? row.tenantId,
        tenantSlug: tenant?.slug ?? row.tenantId,
        quantity: round2(toFiniteNumber(row._sum.quantity)),
        eventCount: row._count._all,
        topEventType: topEventTypeByTenant.get(row.tenantId) ?? 'NONE',
      };
    });

    return {
      window: toWindowDto(window),
      // Never sourced from the snapshot, so it is LIVE by construction and has no computedAt.
      meta: {
        source: 'LIVE',
        computedAt: null,
        generatedAt: new Date().toISOString(),
        liveComputedKeys: [],
        unavailableKeys: [],
      },
      byEventType: eventRows.map((row) => ({ ...row, quantity: round2(row.quantity) })),
      byTenant: byTenantRows,
      totals: {
        quantity: round2(eventRows.reduce((total, row) => total + row.quantity, 0)),
        eventCount: eventRows.reduce((total, row) => total + row.eventCount, 0),
        // The full distinct count, NOT `byTenant.length`: that list is already truncated to the
        // display limit and using it would understate platform adoption.
        activeTenantCount: distinctTenants,
        eventTypeCount: eventRows.length,
      },
    };
  }

  /**
   * `COUNT(DISTINCT tenant_id)` over the window.
   *
   * A one-off raw aggregate because Prisma's `groupBy` cannot express "how many groups" - the only
   * alternative is a `distinct` findMany that materializes one row per tenant into Node, and this is
   * the one number on the page that has to be the true total. Served by the `occurred_at` index.
   */
  private async countDistinctTenants(window: { from: Date; to: Date }): Promise<number> {
    const rows = await this.platformPrisma.client.$queryRaw<Array<{ count: bigint | number }>>`
      SELECT COUNT(DISTINCT tenant_id) AS count
      FROM usage_events
      WHERE occurred_at >= ${window.from} AND occurred_at < ${window.to}
    `;
    return toFiniteNumber(rows[0]?.count);
  }

  private client(): AnalyticsPrisma {
    return this.platformPrisma.client as unknown as AnalyticsPrisma;
  }
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}

/**
 * Sums the per-bucket usage histograms.
 *
 * `quantity` is a Decimal(18,4) column accumulated across dozens of buckets, so it is rounded to 2
 * decimals at the end rather than at every step - rounding per bucket would drift the total away from
 * the value a direct SQL SUM would produce.
 */
function mergeUsage(history: readonly SaasSnapshotMetrics[]): UsageMetricRow[] {
  const merged = new Map<string, UsageMetricRow>();
  for (const metrics of history) {
    for (const row of metrics.usageByEventType) {
      const existing = merged.get(row.eventType);
      if (existing) {
        existing.quantity += row.quantity;
        existing.eventCount += row.eventCount;
      } else {
        merged.set(row.eventType, { ...row });
      }
    }
  }
  return [...merged.values()]
    .map((row) => ({ ...row, quantity: round2(row.quantity) }))
    .sort((left, right) => right.quantity - left.quantity);
}
