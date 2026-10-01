/**
 * Turns the shared `AnalyticsQueryDto` into a concrete, bucket-aligned window, and holds the
 * handful of formatting rules both dashboards need.
 *
 * Kept free of NestJS/Prisma so it is trivially inspectable and reusable by the platform service
 * (which lives in a different module but has the exact same window problem).
 *
 * The one genuinely opinionated decision here is **excluding the in-progress bucket by default**.
 * A dashboard whose newest point is a day that is three hours old is not "up to date", it is
 * broken-looking: revenue dips, attendance looks like a collapse, and every rate computed from that
 * partial bucket is wrong. Callers can opt back in with `includeCurrent=true` when they explicitly
 * want a running figure, and the response then says so via `AnalyticsWindowDto`.
 */

import { BadRequestException } from '@nestjs/common';
import {
  MAX_ANALYTICS_PERIODS,
  resolvePeriods,
  trailingClosedBuckets,
  type AnalyticsGranularity,
  type AnalyticsPeriod,
} from '@college-erp/analytics';
import type { AnalyticsUnitDto, AnalyticsWindowDto } from '@college-erp/types';
import type { AnalyticsQueryDto } from './dto/analytics-query.dto';

/** Trailing bucket counts when the caller does not ask for a specific one. */
const DEFAULT_DAILY_PERIODS = 30;
const DEFAULT_MONTHLY_PERIODS = 12;

export interface AnalyticsWindow {
  granularity: AnalyticsGranularity;
  /** Ascending, gap-free, every bucket whole. */
  buckets: AnalyticsPeriod[];
  from: Date;
  to: Date;
  /** True when the last bucket is the still-running one. */
  includesInProgressPeriod: boolean;
}

export function defaultPeriodsFor(granularity: AnalyticsGranularity): number {
  return granularity === 'MONTHLY' ? DEFAULT_MONTHLY_PERIODS : DEFAULT_DAILY_PERIODS;
}

/**
 * Builds N trailing whole buckets.
 *
 * `end` is the start of the bucket that contains `now`, so every returned bucket is complete.
 * With `includeCurrent`, the window instead ends at the *end* of the current bucket, so the last
 * point is a running total.
 */
export function trailingWindow(
  periods: number,
  granularity: AnalyticsGranularity,
  now: Date,
  includeCurrent: boolean,
): AnalyticsWindow {
  const bounded = Math.min(Math.max(periods, 1), MAX_ANALYTICS_PERIODS);
  // `includeCurrent` needs one extra bucket, because the extra one is the still-running bucket the
  // default path deliberately stops short of.
  const buckets = trailingClosedBuckets(bounded + (includeCurrent ? 1 : 0), granularity, now, bounded + 1);
  const first = buckets[0];
  if (!first) throw new BadRequestException('Analytics window must contain at least one bucket.');
  return { granularity, buckets, from: first.from, to: first.to, includesInProgressPeriod: includeCurrent };
}

export function resolveAnalyticsWindow(query: AnalyticsQueryDto, now: Date = new Date()): AnalyticsWindow {
  const granularity = query.granularity ?? 'DAILY';
  const includeCurrent = query.includeCurrent ?? false;

  if (query.from && query.to) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Analytics from/to must be ISO-8601 timestamps.');
    }
    if (to.getTime() <= from.getTime()) {
      throw new BadRequestException('Analytics "to" must be after "from".');
    }
    const buckets = resolvePeriods(from, to, granularity);
    if (buckets.length === 0) {
      throw new BadRequestException('The requested range does not contain a whole analytics bucket.');
    }
    const first = buckets[0];
    const last = buckets[buckets.length - 1];
    if (!first || !last) throw new BadRequestException('Analytics window must contain at least one bucket.');
    return { granularity, buckets, from: first.from, to: last.to, includesInProgressPeriod: last.to.getTime() > Date.now() };
  }

  if (query.from || query.to) {
    throw new BadRequestException('Analytics "from" and "to" must be supplied together.');
  }

  return trailingWindow(query.periods ?? defaultPeriodsFor(granularity), granularity, now, includeCurrent);
}

export function toWindowDto(window: AnalyticsWindow): AnalyticsWindowDto {
  return {
    granularity: window.granularity,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    periodCount: window.buckets.length,
    includesInProgressPeriod: window.includesInProgressPeriod,
  };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Human label for a bucket key.
 *
 * Formatted from the key's own components rather than from a `Date`, so the label cannot shift with
 * the server's timezone - a daily bucket labelled "Apr 6" on a UTC server and "Apr 5" on a +05:30
 * server is the kind of off-by-one that gets reported as "the data is wrong".
 */
export function bucketLabel(key: string, granularity: AnalyticsGranularity): string {
  const [year, month, day] = key.split('-');
  const monthName = MONTH_LABELS[Number.parseInt(month ?? '', 10) - 1] ?? month ?? '';
  if (granularity === 'MONTHLY') return `${monthName} ${year ?? ''}`.trim();
  return `${monthName} ${day ?? ''}`.trim();
}

export interface SeriesSpec {
  metric: string;
  label: string;
  unit: AnalyticsUnitDto;
  /** Pulls the plotted value out of one bucket's metrics blob. */
  value: (metrics: unknown) => number;
}

/**
 * Projects a window of bucket metrics into the chart-ready series the UI renders.
 *
 * `buckets` is sparse by design: a bucket with neither a snapshot row nor a live recompute becomes a
 * `null` point rather than a `0`. A gap in a chart reads as "no data", which is the truth; a zero
 * reads as "attendance collapsed to nothing", which is a lie the reader will act on.
 */
export function buildWindowSeries(
  buckets: readonly AnalyticsPeriod[],
  granularity: AnalyticsGranularity,
  metricsByKey: ReadonlyMap<string, unknown>,
  specs: readonly SeriesSpec[],
) {
  return specs.map((spec) => ({
    metric: spec.metric,
    label: spec.label,
    unit: spec.unit,
    points: buckets.map((bucket) => {
      const metrics = metricsByKey.get(bucket.key);
      return {
        key: bucket.key,
        label: bucketLabel(bucket.key, granularity),
        value: metrics === undefined ? null : spec.value(metrics),
      };
    }),
  }));
}

/** Sums the numeric fields of every histogram bucket, e.g. attendanceByStatus across a window. */
export function sumHistogram(histograms: readonly Record<string, number>[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const histogram of histograms) {
    for (const [key, value] of Object.entries(histogram)) {
      totals[key] = (totals[key] ?? 0) + (Number.isFinite(value) ? value : 0);
    }
  }
  return totals;
}

/** Reads a numeric field off a metrics blob without letting a missing value become NaN. */
export function metricNumber(metrics: unknown, field: string): number {
  if (!metrics || typeof metrics !== 'object') return 0;
  const value = (metrics as Record<string, unknown>)[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
