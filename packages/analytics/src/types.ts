/**
 * Shared, framework-free contracts for the analytics engines behind both dashboards
 * (the SaaS control-plane view and the per-college view).
 *
 * Deliberately the same shape of package as @college-erp/reporting: pure functions and plain
 * types only, no NestJS/Prisma imports, so the API request path and the worker's out-of-band
 * refresh job can compute a metric with byte-identical logic. If MRR or a churn rate were
 * implemented twice, the dashboard and its own snapshot would eventually disagree.
 */

export const ANALYTICS_GRANULARITIES = ['DAILY', 'MONTHLY'] as const;
export type AnalyticsGranularity = (typeof ANALYTICS_GRANULARITIES)[number];

export const ANALYTICS_SCOPES = ['PLATFORM', 'TENANT'] as const;
export type AnalyticsScope = (typeof ANALYTICS_SCOPES)[number];

/**
 * The `scopeKey` used for PLATFORM-scope snapshot rows.
 *
 * The column is non-null by design: Postgres treats NULLs as distinct, so a nullable-only
 * discriminator would leave the `(scope, scopeKey, granularity, periodStart)` unique constraint
 * unenforceable for platform rows and every refresh would insert a duplicate.
 */
export const PLATFORM_SCOPE_KEY = 'platform';

export const ANALYTICS_SCOPE_TYPES = ['GLOBAL', 'CAMPUS', 'DEPARTMENT', 'PROGRAM', 'OWN'] as const;
export type AnalyticsScopeType = (typeof ANALYTICS_SCOPE_TYPES)[number];

/**
 * One resolved RBAC grant, shaped identically to the reporting engine's ReportScopeGrant so the
 * API can hand the same objects to both without translating (and without the risk of the two
 * engines disagreeing about what a DEPARTMENT grant covers).
 */
export interface AnalyticsScopeGrant {
  scopeType: AnalyticsScopeType;
  campusId?: string;
  departmentId?: string;
  programId?: string;
}

/** Billing cycles that can appear on Plan/Subscription. ONE_TIME never contributes recurring
 * revenue - a one-time charge is recognized once, not amortized into MRR. */
export const BILLING_CYCLES = ['MONTHLY', 'ANNUAL', 'ONE_TIME'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Subscription states that represent live recurring revenue. Mirrors SubscriptionStatus. */
export const RECURRING_SUBSCRIPTION_STATUSES = ['ACTIVE', 'TRIALING', 'PAST_DUE'] as const;
export type RecurringSubscriptionStatus = (typeof RECURRING_SUBSCRIPTION_STATUSES)[number];

/**
 * A half-open time bucket [from, to). Exported as Dates here, serialized to ISO strings at the
 * API/DTO boundary. Half-open matters: a day is `00:00:00.000` up to (not including) the next
 * midnight, so consecutive daily buckets tile the timeline without double-counting the boundary
 * instant - which is exactly the bug that shows up as one duplicated student in a daily count.
 */
export interface AnalyticsPeriod {
  granularity: AnalyticsGranularity;
  from: Date;
  to: Date;
  /** Stable, sortable bucket key: 'YYYY-MM-DD' for DAILY, 'YYYY-MM' for MONTHLY. */
  key: string;
}

// ---------------------------------------------------------------------------
// SaaS (control plane) metrics
// ---------------------------------------------------------------------------

/**
 * One tenant's contribution to a period's recurring revenue. `items` are the tenant's
 * SubscriptionItem rows; the plan's own `priceCents` is the BASE component.
 */
export interface SubscriptionRevenueInput {
  id: string;
  tenantId: string;
  status: string;
  billingCycle: string;
  planPriceCents: number | null;
  items: Array<{
    itemType: string;
    quantity: number;
    unitPriceCents: number;
  }>;
  /** When the subscription entered the current period; null for rows that predate tracking. */
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  canceledAt: Date | null;
}

export interface SaasSnapshotMetrics {
  /** Monthly recurring revenue, normalized: annual/quarterly prices divided down, one-time
   * charges excluded. The number every other revenue metric is expressed against. */
  mrrCents: number;
  /** Run-rate annual revenue = mrrCents * 12. Never summed from invoice totals - it is a
   * forward-looking projection, not money already billed. */
  arrCents: number;
  subscriptionsByStatus: Record<string, number>;
  recurringSubscriptionCount: number;
  tenantCountByStatus: Record<string, number>;
  /** Every tenant that existed at the end of the bucket. */
  totalTenantCount: number;
  /** Tenants in a state that still represents a live customer (ACTIVE or TRIAL). */
  activeTenantCount: number;
  /** Tenants onboarded inside the window. Deliberately distinct from the newTenantCount below,
   * which is the new *paying logos* the MRR movement found: a tenant created in March that does
   * not subscribe until June is a new tenant in March and a new logo in June, and conflating the
   * two makes both numbers wrong. */
  createdTenantCount: number;
  newTenantCount: number;
  /** Tenants whose subscription left the recurring set inside the window. */
  churnedTenantCount: number;
  newMrrCents: number;
  expansionMrrCents: number;
  contractionMrrCents: number;
  churnedMrrCents: number;
  netNewMrrCents: number;
  /** Logo churn: churnedTenantCount / tenants at the START of the window. */
  customerChurnPercent: number;
  /** Revenue churn: churnedMrrCents / mrrCents at the START of the window. */
  mrrChurnPercent: number;
  totalUserCount: number;
  activeUserCount: number;
  /** Sum of PER_STUDENT subscription-item quantities - the authoritative per-tenant student
   * count the billing engine itself meters against (see SaasService.recalculateUsageBasedQuantities).
   * Cheaper and more consistent than fanning out a per-tenant Student count, and it agrees with
   * what tenants are actually invoiced for. */
  meteredStudentCount: number;
  billedCents: number;
  collectedCents: number;
  outstandingCents: number;
  usageByEventType: UsageMetricRow[];
  topTenantsByMrr: TopTenantMrrRow[];
}

export interface UsageMetricRow {
  eventType: string;
  quantity: number;
  eventCount: number;
}

export interface TopTenantMrrRow {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  mrrCents: number;
}

// ---------------------------------------------------------------------------
// College (tenant) metrics
// ---------------------------------------------------------------------------

export interface CollegeSnapshotMetrics {
  studentCount: number;
  studentCountByStatus: Record<string, number>;
  newStudentCount: number;
  /**
   * Users who signed in during the window.
   *
   * Null - never 0 - when the caller's RBAC scope is narrower than tenant-wide: `User` carries no
   * campus/department/program dimension, so it cannot be attributed to a HOD's department, and
   * reporting either the institution-wide number or a misleading zero would both be wrong. The UI
   * renders "n/a" off this null.
   */
  activeUserCount: number | null;
  facultyCount: number;

  admissionApplicationCount: number;
  admissionApplicationCountByStatus: Record<string, number>;
  /** Stage-by-stage conversion counts, in funnel order. */
  admissionFunnel: AdmissionFunnelStage[];
  admissionConversionPercent: number;

  attendanceMarkedCount: number;
  attendancePresentCount: number;
  attendanceRatePercent: number;
  attendanceByStatus: Record<string, number>;

  feesBilledCents: number;
  feesCollectedCents: number;
  feesOutstandingCents: number;
  feesOverdueCents: number;
  collectionRatePercent: number;
  feesByStatus: Record<string, number>;

  resultsPublishedCount: number;
  resultsPassCount: number;
  resultsPassPercent: number;
  averagePercentage: number | null;
  /**
   * Raw outcome histogram behind `resultsPassPercent`.
   *
   * Kept (rather than only the derived rate) because the rate cannot be re-derived from
   * `resultsPassCount`/`resultsPublishedCount` alone: the denominator deliberately excludes
   * INCOMPLETE rows, so a window spanning several buckets has to re-sum the outcomes to get an
   * honest combined pass rate instead of averaging several already-rounded percentages.
   */
  resultsByOutcome: Record<string, number>;

  facultyWorkloadHoursPerWeek: number;
  /** Workload hours per active faculty member; 0 when the college has no active faculty. */
  averageFacultyWorkloadHours: number;
  /**
   * Hours per week split by FacultyWorkloadType. The components of
   * `facultyWorkloadHoursPerWeek`; kept so a multi-bucket window can report the split without
   * re-querying.
   */
  facultyWorkloadHoursByType: Record<string, number>;

  placementEligibleCount: number;
  placementPlacedCount: number;
  placementRatePercent: number;
  averagePackageCents: number | null;
  placementByStatus: Record<string, number>;

  hostelOccupiedCount: number;
  libraryActiveLoanCount: number;
  transportActivePassCount: number;
}

export interface AdmissionFunnelStage {
  stage: string;
  count: number;
  /** Share of the top-of-funnel that reached this stage (0-100). */
  percentOfTop: number;
}

// ---------------------------------------------------------------------------
// Trend series (what the charts plot)
// ---------------------------------------------------------------------------

/** One plotted point. `value` is already scaled for display (cents, percent, or a count). */
export interface MetricSeriesPoint {
  /** Bucket key, 'YYYY-MM-DD' or 'YYYY-MM'. */
  key: string;
  periodStart: string;
  periodEnd: string;
  value: number;
}

export interface MetricSeries {
  metric: string;
  label: string;
  unit: 'CURRENCY_CENTS' | 'PERCENT' | 'COUNT';
  points: MetricSeriesPoint[];
}

// ---------------------------------------------------------------------------
// Prisma port
// ---------------------------------------------------------------------------

/**
 * The narrow slice of Prisma the rollup needs. Declared as a structural port (the same approach
 * @college-erp/reporting's ReportPrisma takes) so the engine stays unit-testable with a
 * hand-rolled fake and never imports the generated client.
 *
 * `aggregate`/`groupBy` are required rather than optional: every histogram on the dashboards
 * (student status, attendance status, fee status, usage by event type) is a GROUP BY that must be
 * pushed into PostgreSQL. Pulling tens of thousands of rows into Node to count them in a loop is
 * exactly the "slows the transactional database" failure this feature is meant to avoid.
 */
export interface AnalyticsDelegate {
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  count(args: Record<string, unknown>): Promise<number>;
  aggregate(args: Record<string, unknown>): Promise<unknown>;
  groupBy(args: Record<string, unknown>): Promise<unknown[]>;
}

/** Write side of the snapshot table; the only mutation this package performs. */
export interface AnalyticsSnapshotDelegate {
  upsert(args: Record<string, unknown>): Promise<unknown>;
}

export interface AnalyticsPrisma {
  tenant: AnalyticsDelegate;
  user: AnalyticsDelegate;
  subscription: AnalyticsDelegate;
  subscriptionItem: AnalyticsDelegate;
  invoice: AnalyticsDelegate;
  payment: AnalyticsDelegate;
  usageEvent: AnalyticsDelegate;
  student: AnalyticsDelegate;
  studentAttendance: AnalyticsDelegate;
  studentFee: AnalyticsDelegate;
  studentPayment: AnalyticsDelegate;
  studentResult: AnalyticsDelegate;
  admissionApplication: AnalyticsDelegate;
  employee: AnalyticsDelegate;
  facultyWorkload: AnalyticsDelegate;
  placementOutcome: AnalyticsDelegate;
  studentHostelBooking: AnalyticsDelegate;
  studentLibraryLoan: AnalyticsDelegate;
  studentTransportPass: AnalyticsDelegate;
  analyticsSnapshot: AnalyticsSnapshotDelegate;
}
