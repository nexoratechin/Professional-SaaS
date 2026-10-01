import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  PLATFORM_SCOPE_KEY,
  computeCollegeRollup,
  computeSaasRollup,
  trailingClosedBuckets,
  upsertAnalyticsSnapshot,
  type AnalyticsGranularity,
  type AnalyticsPeriod,
  type AnalyticsPrisma,
} from '@college-erp/analytics';
import { ENTITLEMENT_KEYS } from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type AnalyticsRefreshSweepJobData, type AnalyticsRefreshTenantJobData } from '@college-erp/types';
import { EntitlementGate } from '../../entitlement/entitlement-gate';

/**
 * How deep the periodic sweep re-rolls.
 *
 * Not "recompute everything" and not "recompute only the newest bucket". The newest bucket alone
 * would freeze in any late write - a payment keyed to last month's invoice, a corrected fee line -
 * so the figures would drift away from the transactional ledgers that actually bill people. Rolling
 * the whole 30-day history every hour would mean ~600 aggregates per tenant per hour, which is
 * precisely the load this materialized snapshot exists to avoid.
 *
 * Three closed daily buckets absorbs anything that lands within a three-day correction window, which
 * is what finance and admissions corrections actually look like. Deep backfill is a separate,
 * explicit request (`POST /analytics/refresh` with a `periods` value), not something a cron job
 * should do unprompted.
 */
const SWEEP_DAILY_BUCKETS = 3;
const SWEEP_MONTHLY_BUCKETS = 1;

/** Job name the API enqueues for a single tenant's manual refresh. */
const TENANT_JOB = 'analytics-refresh-tenant';

/**
 * Materializes the `AnalyticsSnapshot` rows both dashboards read.
 *
 * Two job shapes on one queue:
 *  - `sweep` (recurring, registered by AnalyticsRefreshSchedulerService): the PLATFORM rollup plus
 *    every entitled tenant's, at the sweep depth above.
 *  - `analytics-refresh-tenant` (enqueued by the API's `POST /analytics/refresh`): one tenant, at an
 *    explicit bucket count, for a user who wants a deep backfill.
 *
 * Both call the exact `compute*Rollup` functions apps/api's live fallback calls, so a materialized
 * row and a live recompute are the same function over the same rows and cannot drift apart.
 *
 * Tenants are walked SEQUENTIALLY on purpose: each bucket is already a ~20-query concurrent fan-out,
 * and fanning that out across fifty tenants at once would exhaust the connection pool and starve the
 * transactional traffic this job exists to stay out of the way of.
 */
@Processor(QUEUE_NAMES.ANALYTICS_REFRESH)
export class AnalyticsRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(AnalyticsRefreshProcessor.name);

  constructor(private readonly entitlements: EntitlementGate) {
    super();
  }

  async process(job: Job<AnalyticsRefreshSweepJobData | AnalyticsRefreshTenantJobData>): Promise<void> {
    if (job.name === TENANT_JOB) {
      await this.refreshTenant(job.data as AnalyticsRefreshTenantJobData);
      return;
    }
    await this.sweep(new Date());
  }

  /** The recurring pass: platform first (a failure there is the most visible), then each tenant. */
  private async sweep(now: Date): Promise<void> {
    const daily = trailingClosedBuckets(SWEEP_DAILY_BUCKETS, 'DAILY', now);
    const monthly = trailingClosedBuckets(SWEEP_MONTHLY_BUCKETS, 'MONTHLY', now);

    const platformClient = platformPrismaClient as unknown as AnalyticsPrisma;
    let platformBuckets = 0;
    for (const period of [...daily, ...monthly]) {
      await this.rollup(platformClient, 'PLATFORM', PLATFORM_SCOPE_KEY, undefined, period, async () =>
        computeSaasRollup(platformClient, { period }),
      );
      platformBuckets += 1;
    }

    // Only tenants that can actually open the dashboard. Rolling a college's student counts for a
    // plan that stripped the analytics module is ~20 wasted aggregates per bucket per hour, and the
    // rows would never be read.
    const tenants = await platformPrismaClient.tenant.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    let refreshedTenants = 0;
    let skippedTenants = 0;
    let failedTenants = 0;
    for (const { id: tenantId } of tenants) {
      if (!(await this.entitlements.canUse(tenantId, ENTITLEMENT_KEYS.ANALYTICS_ADVANCED))) {
        skippedTenants += 1;
        continue;
      }
      // The tenant-scoped client is a second isolation layer on top of the explicit `tenantId` in
      // every rollup predicate, and it costs nothing: $extends on the shared pool.
      const client = createTenantScopedClient(tenantId) as unknown as AnalyticsPrisma;
      try {
        for (const period of [...daily, ...monthly]) {
          await this.rollup(client, 'TENANT', tenantId, tenantId, period, async () =>
            // No `filter`: the snapshot is institution-wide. A caller narrower than tenant-wide is
            // served the live recompute instead (see CollegeAnalyticsService), because one row per
            // (tenant, period) cannot represent every RBAC slice at once.
            computeCollegeRollup(client, { scope: { tenantId }, period }),
          );
        }
        refreshedTenants += 1;
      } catch (error) {
        // One tenant's failure must not abort the sweep for the rest: a corrupt tenant row should cost
        // that tenant's charts, not every other college's.
        failedTenants += 1;
        this.logger.error(
          `Analytics refresh failed for tenant ${tenantId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(
      `Analytics sweep: ${platformBuckets} platform bucket(s), ${refreshedTenants} tenant(s) refreshed, ` +
        `${skippedTenants} not entitled, ${failedTenants} failed.`,
    );
  }

  /** The API-requested deep refresh for one tenant. */
  private async refreshTenant(data: AnalyticsRefreshTenantJobData): Promise<void> {
    if (!data?.tenantId) {
      this.logger.error('Analytics refresh job arrived without a tenantId; skipping.');
      return;
    }
    const granularity: AnalyticsGranularity = data.granularity === 'MONTHLY' ? 'MONTHLY' : 'DAILY';
    const periods = Math.min(Math.max(data.periods ?? SWEEP_DAILY_BUCKETS, 1), 120);
    const buckets = trailingClosedBuckets(periods, granularity, new Date());

    const client = createTenantScopedClient(data.tenantId) as unknown as AnalyticsPrisma;
    for (const period of buckets) {
      await this.rollup(client, 'TENANT', data.tenantId, data.tenantId, period, async () =>
        computeCollegeRollup(client, { scope: { tenantId: data.tenantId }, period }),
      );
    }
    this.logger.log(
      `Analytics refresh for tenant ${data.tenantId}: ${buckets.length} ${granularity} bucket(s) recomputed.`,
    );
  }

  /**
   * Computes one bucket and upserts it, translating a failure into a log line.
   *
   * The write is the same `upsertAnalyticsSnapshot` the API uses, so the `scope`/`scopeKey`/`tenantId`
   * invariant (TENANT rows are always written with `scopeKey === tenantId`) is enforced in one place
   * for both writers rather than being duplicated here.
   */
  private async rollup(
    client: AnalyticsPrisma,
    scope: 'PLATFORM' | 'TENANT',
    scopeKey: string,
    tenantId: string | undefined,
    period: AnalyticsPeriod,
    compute: () => Promise<unknown>,
  ): Promise<void> {
    try {
      const metrics = await compute();
      await upsertAnalyticsSnapshot(client, {
        scope,
        scopeKey,
        ...(tenantId ? { tenantId } : {}),
        period,
        metrics,
      });
    } catch (error) {
      this.logger.error(
        `Analytics rollup failed for ${scope}/${scopeKey} ${period.key}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
