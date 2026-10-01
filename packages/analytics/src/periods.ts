/**
 * Period bucketing and period-over-period comparison math.
 *
 * Every aggregate on the dashboards is "some metric, per day/month, over a window". Getting the
 * bucketing subtly wrong is the classic source of dashboards that disagree with themselves
 * between a daily and a monthly view, so the alignment rules live here once, are pure, and are
 * covered by tests rather than being re-derived inline at each call site.
 *
 * All buckets are half-open [from, to) in UTC. Timezone-shifted local days are deliberately NOT
 * modeled: a tenant's local midnight would make a bucket boundary depend on an arbitrary offset,
 * and mixing offset-aware and offset-naive boundaries is precisely what causes off-by-one drift
 * between the snapshot table and a live recompute. Callers pass explicit UTC instants instead.
 */

import type { AnalyticsGranularity, AnalyticsPeriod, MetricSeries } from './types';

const MS_PER_DAY = 86_400_000;

/**
 * Hard ceiling on how many buckets one request may ask for.
 *
 * A window is not just a chart: every bucket is a separate row in `AnalyticsSnapshot`, and a
 * caller asking for 10 years of daily buckets would otherwise turn one dashboard load into ~3,650
 * rows to read (and, on a live recompute, ~3,650 rollups to compute). Two years of daily data is
 * far more than any chart in this product plots, so the bound is generous and enforced in one place
 * rather than duplicated as a magic number in each DTO.
 */
export const MAX_ANALYTICS_PERIODS = 730;

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/** Truncates an instant down to the start of its UTC day. */
export function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

/** Truncates an instant down to the start of its UTC month. */
export function startOfUtcMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

/** Advances an already-aligned bucket start by one whole bucket. */
export function addPeriod(periodStart: Date, granularity: AnalyticsGranularity): Date {
  if (granularity === 'MONTHLY') {
    return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() + 1, 1));
  }
  return new Date(periodStart.getTime() + MS_PER_DAY);
}

/** Steps an already-aligned bucket start back by one whole bucket. */
export function subtractPeriod(periodStart: Date, granularity: AnalyticsGranularity): Date {
  if (granularity === 'MONTHLY') {
    return new Date(Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth() - 1, 1));
  }
  return new Date(periodStart.getTime() - MS_PER_DAY);
}

/** Truncates an instant down to the start of the bucket that contains it. */
export function alignToPeriodStart(value: Date, granularity: AnalyticsGranularity): Date {
  return granularity === 'MONTHLY' ? startOfUtcMonth(value) : startOfUtcDay(value);
}

/** Stable, sortable bucket key used as the snapshot's `period_start` identity. */
export function periodKey(periodStart: Date, granularity: AnalyticsGranularity): string {
  const year = periodStart.getUTCFullYear();
  if (granularity === 'MONTHLY') return `${year}-${pad(periodStart.getUTCMonth() + 1)}`;
  return `${year}-${pad(periodStart.getUTCMonth() + 1)}-${pad(periodStart.getUTCDate())}`;
}

/** Parses a bucket key back into its start instant. Inverse of periodKey(). */
export function periodKeyToStart(key: string, granularity: AnalyticsGranularity): Date {
  const [year, month, day] = key.split('-').map((part) => Number.parseInt(part, 10));
  if (year === undefined || month === undefined) {
    throw new Error(`Invalid analytics period key: ${key}`);
  }
  if (granularity === 'MONTHLY') return new Date(Date.UTC(year, month - 1, 1));
  if (day === undefined) throw new Error(`Daily analytics period key needs a day: ${key}`);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Aligns an arbitrary [from, to) window to whole buckets: the returned periods start at the
 * first bucket boundary at or after `from` and end at the first boundary at or after `to`, so a
 * request for "the last 7 days" always yields exactly 7 whole daily buckets rather than a partial
 * leading day that would drag every rate down.
 */
export function resolvePeriods(
  from: Date,
  to: Date,
  granularity: AnalyticsGranularity,
  maxPeriods = MAX_ANALYTICS_PERIODS,
): AnalyticsPeriod[] {
  if (to.getTime() <= from.getTime()) {
    throw new Error('Analytics period range must end after it starts.');
  }

  let cursor = granularity === 'MONTHLY' ? startOfUtcMonth(from) : startOfUtcDay(from);
  // A `from` mid-bucket would otherwise silently shift the first bucket's data; snap forward.
  if (cursor.getTime() < from.getTime()) {
    cursor = addPeriod(cursor, granularity);
  }

  const periods: AnalyticsPeriod[] = [];
  while (cursor.getTime() < to.getTime() && periods.length < maxPeriods) {
    const next = addPeriod(cursor, granularity);
    periods.push({ granularity, from: cursor, to: next, key: periodKey(cursor, granularity) });
    cursor = next;
  }
  return periods;
}

/**
 * The bucket immediately preceding `period` - always exactly one bucket long and ending where
 * `period` starts, so "this month vs last month" and "today vs yesterday" are the same shape of
 * query and the comparison helpers never have to special-case bucket length.
 */
export function previousPeriod(period: AnalyticsPeriod): AnalyticsPeriod {
  const previousStart =
    period.granularity === 'MONTHLY'
      ? new Date(Date.UTC(period.from.getUTCFullYear(), period.from.getUTCMonth() - 1, 1))
      : new Date(period.from.getTime() - MS_PER_DAY);
  return {
    granularity: period.granularity,
    from: previousStart,
    to: period.from,
    key: periodKey(previousStart, period.granularity),
  };
}

/**
 * The `periods` most recent buckets, ascending, all of them CLOSED.
 *
 * "Closed" is the load-bearing word. A bucket that is still running has only accumulated part of its
 * data, so plotting it makes revenue dip, attendance look like a collapse, and every rate derived
 * from it come out low - a dashboard whose newest point is a three-hour-old day is not "live", it is
 * broken. Callers that genuinely want a running figure ask for the buckets themselves.
 *
 * Shared with apps/api (which resolves the same window from a query DTO) so the worker's materialized
 * rows and the API's bucket list cannot disagree about where a window starts or ends.
 */
export function trailingClosedBuckets(
  periods: number,
  granularity: AnalyticsGranularity,
  now: Date,
  maxPeriods = MAX_ANALYTICS_PERIODS,
): AnalyticsPeriod[] {
  const bounded = Math.min(Math.max(periods, 1), maxPeriods);
  const currentStart = alignToPeriodStart(now, granularity);

  const buckets: AnalyticsPeriod[] = [];
  let end = currentStart;
  for (let index = 0; index < bounded; index += 1) {
    const start = subtractPeriod(end, granularity);
    buckets.unshift({ granularity, from: start, to: end, key: periodKey(start, granularity) });
    end = start;
  }
  return buckets;
}

export interface PeriodComparison {
  current: number;
  previous: number;
  /** current - previous. Negative means a decline. */
  delta: number;
  /** Percentage change vs the previous value. Null when there is no meaningful baseline. */
  percentChange: number | null;
}

/**
 * Guards the divide: growth off a zero base is undefined, not infinite. Returning null keeps the
 * UI honest ("n/a") instead of rendering a fabricated +10000%.
 */
export function percentChange(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return round2(((current - previous) / Math.abs(previous)) * 100);
}

export function comparePeriods(current: number, previous: number): PeriodComparison {
  return {
    current,
    previous,
    delta: current - previous,
    percentChange: percentChange(previous, current),
  };
}

/**
 * Sum of an absolute metric across a period list, keyed by bucket. Absent buckets are filled with
 * zero so a series always has one point per bucket - a gap in a chart reads as "the data is
 * broken", whereas a zero reads as "nothing happened", which is the truth.
 */
export function buildSeries(
  metric: string,
  label: string,
  unit: MetricSeries['unit'],
  periods: AnalyticsPeriod[],
  valuesByKey: ReadonlyMap<string, number>,
): MetricSeries {
  return {
    metric,
    label,
    unit,
    points: periods.map((period) => ({
      key: period.key,
      periodStart: period.from.toISOString(),
      periodEnd: period.to.toISOString(),
      value: valuesByKey.get(period.key) ?? 0,
    })),
  };
}

/** Rounds to 2 decimals without float dust (0.1 + 0.2 territory). */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
