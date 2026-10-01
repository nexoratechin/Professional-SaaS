/**
 * Response contracts for the two advanced-analytics dashboards. Plain data only (no
 * class-validator / NestJS decorators) so apps/web can import them from the same package the API
 * compiles against, and so the two sides can never drift on a field name.
 *
 * Both payloads are chart-ready on purpose: the series arrive as `{ metric, unit, points[] }`
 * rather than as raw rows, because there is no charting library in this app and the UI renders
 * bars from these points directly. Metrics are grouped into named sections instead of being
 * flattened, so adding a metric to a section does not require a coordinated rename in the UI.
 */

/** Mirrors the Prisma AnalyticsGranularity enum over the wire. */
export type AnalyticsGranularityDto = 'DAILY' | 'MONTHLY';

export type AnalyticsUnitDto = 'CURRENCY_CENTS' | 'PERCENT' | 'COUNT';

/**
 * Where the numbers came from, so the UI can be honest about freshness instead of implying
 * real-time data. SNAPSHOT = read from a materialized AnalyticsSnapshot row; LIVE = recomputed
 * for this request (a "Refresh" click, or a tenant the sweep has not reached yet).
 */
export type AnalyticsSourceDto = 'SNAPSHOT' | 'LIVE';

export interface AnalyticsWindowDto {
  granularity: AnalyticsGranularityDto;
  /** Inclusive start instant of the first bucket. */
  from: string;
  /** Exclusive end instant of the last bucket. */
  to: string;
  periodCount: number;
  /**
   * True when the last bucket is the still-running one, so every value derived from it is a
   * running total rather than a settled figure. Off by default: a half-finished day makes a
   * revenue or attendance trend look like a collapse.
   */
  includesInProgressPeriod: boolean;
}

export interface AnalyticsMetaDto {
  source: AnalyticsSourceDto;
  /** When the underlying rollup was computed. Null for a LIVE payload. */
  computedAt: string | null;
  generatedAt: string;
  /**
   * Bucket keys that had no materialized snapshot row and were recomputed for this request.
   *
   * Listed rather than hidden because a partially-materialized window is exactly the case where a
   * reader needs to know the numbers are stitched from two sources; the worker's sweep normally
   * fills these within a day.
   */
  liveComputedKeys: string[];
  /**
   * Bucket keys that could be served from neither source. Never silently rendered as zero: the UI
   * draws these as gaps. Only populated when a request asks for more buckets than the API's live
   * fallback budget, which is the one case where that fallback is deliberately capped.
   */
  unavailableKeys: string[];
}

export interface AnalyticsSeriesPointDto {
  /** Bucket key: 'YYYY-MM-DD' for DAILY, 'YYYY-MM' for MONTHLY. */
  key: string;
  label: string;
  /**
   * Null when the bucket could not be sourced from either the snapshot or a live recompute. The UI
   * draws a gap; it must not be coerced to 0, which would read as a real drop to nothing.
   */
  value: number | null;
}

export interface AnalyticsSeriesDto {
  metric: string;
  label: string;
  unit: AnalyticsUnitDto;
  points: AnalyticsSeriesPointDto[];
}

export interface AnalyticsUsageRowDto {
  eventType: string;
  quantity: number;
  eventCount: number;
}

export interface AnalyticsTopTenantDto {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  mrrCents: number;
}

/** One tenant's contribution to the usage rollup. */
export interface AnalyticsUsageByTenantDto {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  quantity: number;
  eventCount: number;
  /** The event type contributing the most quantity for this tenant, for a one-line summary. */
  topEventType: string;
}

/** GET /platform/analytics/usage - the metered-usage drill-down behind the platform dashboard. */
export interface SaasUsageAnalyticsDto {
  window: AnalyticsWindowDto;
  meta: AnalyticsMetaDto;
  byEventType: AnalyticsUsageRowDto[];
  byTenant: AnalyticsUsageByTenantDto[];
  totals: {
    quantity: number;
    eventCount: number;
    /** Distinct tenants that emitted at least one event in the window. */
    activeTenantCount: number;
    eventTypeCount: number;
  };
}

/** GET /platform/analytics/overview - the SaaS control-plane dashboard. */
export interface SaasAnalyticsOverviewDto {
  window: AnalyticsWindowDto;
  meta: AnalyticsMetaDto;

  /** Normalized monthly recurring revenue across every active subscription. */
  mrrCents: number;
  /** Run-rate annual revenue (mrrCents * 12). */
  arrCents: number;

  customerChurnPercent: number;
  mrrChurnPercent: number;
  newMrrCents: number;
  expansionMrrCents: number;
  contractionMrrCents: number;
  churnedMrrCents: number;
  netNewMrrCents: number;

  totalTenants: number;
  activeTenants: number;
  /**
   * Tenants onboarded inside the window. Distinct from `newTenantCount`, which counts new *paying
   * logos* the MRR movement found: a tenant created in March that only subscribes in June is a new
   * tenant in March and a new logo in June.
   */
  createdTenants: number;
  newTenantCount: number;
  churnedTenantCount: number;
  tenantCountByStatus: Record<string, number>;
  subscriptionsByStatus: Record<string, number>;
  recurringSubscriptionCount: number;

  totalUserCount: number;
  activeUserCount: number;
  /** Sum of PER_STUDENT metered quantities - the student count the billing engine bills against. */
  meteredStudentCount: number;

  billedCents: number;
  collectedCents: number;
  outstandingCents: number;

  usageByEventType: AnalyticsUsageRowDto[];
  topTenantsByMrr: AnalyticsTopTenantDto[];

  series: AnalyticsSeriesDto[];
}

export interface AnalyticsScopeDto {
  /** True when the caller holds a GLOBAL grant (institution-wide visibility). */
  isGlobal: boolean;
  campusIds: string[];
  departmentIds: string[];
  programIds: string[];
}

export interface AnalyticsFunnelStageDto {
  stage: string;
  count: number;
  percentOfTop: number;
}

export interface CollegeStudentsDto {
  total: number;
  byStatus: Record<string, number>;
  newInPeriod: number;
  /**
   * Users who signed in during the window, or null when the caller's scope is narrower than
   * tenant-wide - `User` has no campus/department/program dimension, so it cannot be scoped to a
   * HOD's department. Never 0 in that case: "n/a" is the honest answer, an institution-wide
   * number would leak, and a zero would be a lie.
   */
  activeUserCount: number | null;
  facultyCount: number;
}

export interface CollegeAdmissionsDto {
  total: number;
  byStatus: Record<string, number>;
  funnel: AnalyticsFunnelStageDto[];
  conversionPercent: number;
}

export interface CollegeAttendanceDto {
  marked: number;
  present: number;
  ratePercent: number;
  byStatus: Record<string, number>;
}

export interface CollegeFeesDto {
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  overdueCents: number;
  collectionRatePercent: number;
  byStatus: Record<string, number>;
}

export interface CollegeResultsDto {
  published: number;
  passCount: number;
  passPercent: number;
  /** Null rather than 0 when nothing has been published yet. */
  averagePercentage: number | null;
}

export interface CollegeFacultyDto {
  totalHoursPerWeek: number;
  /** 0 when the college has no active faculty. */
  averageHours: number;
  byWorkloadType: Record<string, number>;
}

export interface CollegePlacementDto {
  eligible: number;
  placed: number;
  ratePercent: number;
  averagePackageCents: number | null;
  byStatus: Record<string, number>;
}

export interface CollegeAmenitiesDto {
  hostelOccupiedCount: number;
  libraryActiveLoanCount: number;
  transportActivePassCount: number;
}

/** GET /analytics/overview - the per-college dashboard. */
export interface CollegeAnalyticsOverviewDto {
  window: AnalyticsWindowDto;
  meta: AnalyticsMetaDto;
  /** The RBAC scope the numbers were filtered to, echoed back so the UI can explain its slice. */
  scope: AnalyticsScopeDto;

  students: CollegeStudentsDto;
  admissions: CollegeAdmissionsDto;
  attendance: CollegeAttendanceDto;
  fees: CollegeFeesDto;
  results: CollegeResultsDto;
  faculty: CollegeFacultyDto;
  placement: CollegePlacementDto;
  amenities: CollegeAmenitiesDto;

  series: AnalyticsSeriesDto[];
}
