import { ANALYTICS_GRANULARITIES, MAX_ANALYTICS_PERIODS } from '@college-erp/analytics';
import { Transform } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export { ANALYTICS_GRANULARITIES, MAX_ANALYTICS_PERIODS };

/**
 * Query contract for both dashboards.
 *
 * The window is expressed as a trailing *bucket count* rather than a from/to pair, because every
 * value a user can pick in a UI ("last 7 days", "last 12 months") is a bucket count, and deriving
 * the instants in one place is what keeps a daily chart and a monthly chart of the same span
 * comparable. An explicit from/to is still accepted for API consumers that genuinely have a date
 * range (a finance export, a backfill).
 */
export class AnalyticsQueryDto {
  @IsOptional()
  @IsIn(ANALYTICS_GRANULARITIES)
  granularity?: (typeof ANALYTICS_GRANULARITIES)[number];

  /** Trailing bucket count. Defaults per granularity (30 daily, 12 monthly). */
  @IsOptional()
  @Transform(({ value }) => (value === undefined || value === '' || value === null ? undefined : Number(value)))
  @IsInt()
  @Min(1)
  @Max(MAX_ANALYTICS_PERIODS)
  periods?: number;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  /**
   * Bypass the materialized snapshot and recompute for this request.
   *
   * Offered rather than required because the snapshot is exactly what keeps a dashboard from
   * running 20 aggregates over the transactional ledgers on every page load; a live recompute is
   * the escape hatch for "I just corrected a fee record and need to see it now".
   *
   * Costs ~20 aggregate queries per bucket, so the number of buckets it may cover is bounded (see
   * the service); a caller asking for a live recompute of a two-year daily window is told to
   * narrow the request rather than being allowed to melt the database.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  live?: boolean;

  /**
   * Extend the window through the current, still-running bucket.
   *
   * Off by default. A partially-elapsed day or month would drag every rate in the last chart point
   * toward zero, which is indistinguishable from a real collapse.
   */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  includeCurrent?: boolean;
}
