/**
 * Reads a window of materialized rollups, falling back to a live recompute for the buckets the
 * worker has not reached yet.
 *
 * This is the only place that touches `AnalyticsSnapshot` on a read path, and it is shared by the
 * college and the platform dashboards for a reason that is not DRY for its own sake:
 *
 *  - `AnalyticsSnapshot` is deliberately **outside** the auto-derived tenant-scoped model set (its
 *    `tenantId` is nullable so PLATFORM rows can live in the same table), so the tenant-guard
 *    Prisma extension injects nothing for it. Every query must therefore name its scope explicitly,
 *    and `scopeKey` is the isolation boundary. One implementation means one place where that rule
 *    can be broken, and it is the kind of place that gets broken silently in a copy.
 *  - The snapshot-vs-live decision (when to recompute, when to give up) has to be identical on both
 *    sides, or the two dashboards would disagree about how fresh the same number is.
 *
 * `tenantId` always comes from the caller's authenticated context and is never read from the
 * request, which is what makes the TENANT-scope filter below an actual boundary rather than a
 * suggestion.
 */

import { Injectable } from '@nestjs/common';
import {
  periodKey,
  upsertAnalyticsSnapshot,
  type AnalyticsPeriod,
  type AnalyticsPrisma,
  type AnalyticsScope,
} from '@college-erp/analytics';
import type { AnalyticsMetaDto, AnalyticsSourceDto } from '@college-erp/types';
import type { AnalyticsWindow } from './analytics-window';

/**
 * Ceiling on how many buckets a single request may recompute live.
 *
 * One college bucket costs ~20 aggregate queries; a SaaS bucket costs ~10. Recomputing an unbounded
 * window would turn a dashboard GET into a self-inflicted denial of service on the very transactional
 * ledgers this feature exists to protect. Beyond the cap the excess buckets are reported as
 * unavailable rather than silently zero-filled.
 */
export const MAX_LIVE_REFRESH_PERIODS = 14;

export interface WindowRollups {
  /** Bucket key -> metrics blob. Buckets with no value at all are absent from the map. */
  metricsByKey: Map<string, unknown>;
  meta: AnalyticsMetaDto;
}

interface SnapshotRow {
  periodStart: Date;
  metrics: unknown;
  computedAt: Date;
}

/** The two methods this service needs off a Prisma client, declared structurally for the same
 * reason the analytics package declares a port: the generated client's types are far wider than
 * these two calls, and a hand-rolled fake is then enough to test the policy. */
interface AnalyticsSnapshotReader {
  analyticsSnapshot: {
    findMany(args: Record<string, unknown>): Promise<SnapshotRow[]>;
  };
}

export type BucketComputer = (bucket: AnalyticsPeriod) => Promise<unknown>;

@Injectable()
export class AnalyticsReadService {
  /**
   * Loads the window from `AnalyticsSnapshot`, recomputing what is missing.
   *
   * @param scope    TENANT rows carry the tenant id as `scopeKey`; PLATFORM rows carry the fixed
   *                 `PLATFORM_SCOPE_KEY` literal. See `upsertAnalyticsSnapshot` for the write side.
   * @param scopeKey Only meaningful (and only trusted) for TENANT scope.
   * @param compute  Performs the live recompute for one bucket. Passed in rather than called
   *                 directly so the college and SaaS rollups - different functions over different
   *                 tables - share the snapshot/fallback policy without either service needing to
   *                 know about the other.
   */
  async readWindow(
    client: AnalyticsPrisma,
    scope: AnalyticsScope,
    scopeKey: string,
    window: AnalyticsWindow,
    compute: BucketComputer,
    options: { live?: boolean } = {},
  ): Promise<WindowRollups> {
    const rows = await this.loadSnapshots(client, scope, scopeKey, window);
    const snapshotByKey = new Map<string, SnapshotRow>();
    for (const row of rows) {
      snapshotByKey.set(periodKey(row.periodStart, window.granularity), row);
    }

    const liveRequested = options.live === true;
    const missing = window.buckets.filter((bucket) => liveRequested || !snapshotByKey.has(bucket.key));

    /**
     * Newest-first, so the cap spends the live budget on the most recent buckets. The headline card
     * is the newest bucket; filling the oldest 14 of a 30-bucket gap would leave the number the
     * reader actually looks at still missing.
     */
    const recomputable = missing.slice().reverse().slice(0, MAX_LIVE_REFRESH_PERIODS);
    const recomputableKeys = new Set(recomputable.map((bucket) => bucket.key));

    // Sequential on purpose: computeCollegeRollup already fans ~20 queries out concurrently, so
    // running several buckets at once would multiply that past anything a connection pool enjoys.
    const liveByKey = new Map<string, unknown>();
    for (const bucket of recomputable) {
      liveByKey.set(bucket.key, await compute(bucket));
    }

    const metricsByKey = new Map<string, unknown>();
    const liveComputedKeys: string[] = [];
    const unavailableKeys: string[] = [];
    let latestComputedAt: Date | null = null;

    for (const bucket of window.buckets) {
      if (liveByKey.has(bucket.key)) {
        metricsByKey.set(bucket.key, liveByKey.get(bucket.key));
        liveComputedKeys.push(bucket.key);
        continue;
      }
      const row = snapshotByKey.get(bucket.key);
      if (row) {
        metricsByKey.set(bucket.key, row.metrics);
        if (!latestComputedAt || row.computedAt > latestComputedAt) latestComputedAt = row.computedAt;
        continue;
      }
      if (!recomputableKeys.has(bucket.key)) unavailableKeys.push(bucket.key);
    }

    const source: AnalyticsSourceDto = liveComputedKeys.length > 0 ? 'LIVE' : 'SNAPSHOT';
    return {
      metricsByKey,
      meta: {
        source,
        // Still reported when only some buckets were recomputed: the snapshot rows that were used
        // genuinely have a computation time, and collapsing it to a single null would throw away
        // real information about how fresh most of the window is.
        computedAt: latestComputedAt ? latestComputedAt.toISOString() : null,
        generatedAt: new Date().toISOString(),
        liveComputedKeys,
        unavailableKeys,
      },
    };
  }

  /**
   * Reads the raw snapshot rows for the window.
   *
   * The `scope` + `scopeKey` pair IS the filter. For TENANT that means a single clause derived from
   * the JWT's tenant id is sufficient isolation, because TENANT rows are always *written* with
   * `scopeKey === tenantId` (enforced in `upsertAnalyticsSnapshot`).
   */
  private async loadSnapshots(
    client: AnalyticsPrisma,
    scope: AnalyticsScope,
    scopeKey: string,
    window: AnalyticsWindow,
  ): Promise<SnapshotRow[]> {
    if (scope === 'TENANT' && !scopeKey) {
      throw new Error('A TENANT-scope analytics snapshot read requires a tenant id.');
    }
    const reader = client as unknown as AnalyticsSnapshotReader;
    return reader.analyticsSnapshot.findMany({
      where: {
        scope,
        scopeKey,
        granularity: window.granularity,
        periodStart: { gte: window.from, lt: window.to },
      },
      select: { periodStart: true, metrics: true, computedAt: true },
      orderBy: { periodStart: 'asc' },
    });
  }

  /**
   * Recomputes `buckets` and persists them.
   *
   * Backs `POST /analytics/refresh` and the worker's sweep. Deliberately the only place the API
   * writes to this table: a GET must not mutate, and the periodic backfill belongs to the worker.
   *
   * Oldest-first on purpose, so a reader arriving mid-refresh sees a consistent prefix rather than a
   * hole in the middle of the chart.
   */
  async refreshBuckets(
    client: AnalyticsPrisma,
    scope: AnalyticsScope,
    scopeKey: string,
    tenantId: string | undefined,
    buckets: readonly AnalyticsPeriod[],
    compute: BucketComputer,
  ): Promise<number> {
    for (const bucket of buckets) {
      const metrics = await compute(bucket);
      await upsertAnalyticsSnapshot(client, {
        scope,
        scopeKey,
        ...(tenantId ? { tenantId } : {}),
        period: bucket,
        metrics,
      });
    }
    return buckets.length;
  }
}
