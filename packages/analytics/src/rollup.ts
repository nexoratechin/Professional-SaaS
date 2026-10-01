/**
 * Database-backed rollup computation - the single place a metric's *computation* (not just its
 * arithmetic) lives.
 *
 * Why the queries are in a shared package instead of in the API: the API answers a dashboard read
 * two ways - serve the materialized `AnalyticsSnapshot` row, or recompute live - and the worker
 * recomputes that same row on a schedule. If the query set were written twice, the snapshot and the
 * live recompute would eventually report different numbers for the same period, and there would be
 * no way to tell which one was lying. Here, `computeCollegeRollup`/`computeSaasRollup` take an
 * `AnalyticsPrisma` port and are called identically by both sides, so a snapshot read and a live
 * recompute are the same function over the same rows.
 *
 * Two conventions hold everywhere below.
 *
 * 1. **Flow vs stock.** A flow metric is filtered to the bucket `[period.from, period.to)`; a stock
 *    metric asks "what was true at the end of the bucket" and is filtered `< period.to`. Mixing
 *    them up is how a dashboard ends up reporting the same fee collection total for all 30 days of
 *    a month.
 *
 * 2. **Current-state columns are used to reconstruct the past where possible.** A subscription's
 *    `status` says what it is *now*; without reconstructing history, a churned tenant vanishes
 *    from every historical bucket and churn silently reads as zero in the exact month it happened.
 *    Every such query therefore pairs the live state with the date column that records when the
 *    state was reached (see `liveSubscriptionWhere`). The reconstruction is not perfect - a
 *    subscription that churned and was later re-created as a new row cannot be recovered - but the
 *    honest approximation beats a guaranteed-wrong zero.
 */

import {
  averageOf,
  buildAdmissionFunnel,
  computeAttendanceRatePercent,
  computeFeeCollection,
  computePassRatePercent,
  funnelConversionPercent,
  type AnalyticsScopeFilter,
} from './college';
import { buildSaasSnapshotMetrics, computeMrrByTenant, countBy, isRecurringStatus, ratePercent } from './mrr';
import { previousPeriod, round2 } from './periods';
import {
  PLATFORM_SCOPE_KEY,
  RECURRING_SUBSCRIPTION_STATUSES,
  type AnalyticsPeriod,
  type AnalyticsPrisma,
  type AnalyticsScope,
  type CollegeSnapshotMetrics,
  type SaasSnapshotMetrics,
  type SubscriptionRevenueInput,
  type UsageMetricRow,
} from './types';

/** Tenant states that still represent a live customer. SUSPENDED is deliberately excluded. */
export const ACTIVE_TENANT_STATUSES = ['ACTIVE', 'TRIAL'] as const;

/**
 * Invoice states that represent a real charge. DRAFT has not been sent and VOID has been retracted,
 * so summing either into "billed" would overstate the period's revenue.
 */
const BILLED_INVOICE_STATUSES = ['ISSUED', 'PAID', 'OVERDUE'] as const;

/** Payment states that actually moved money. REFUNDED is a movement, not a collection. */
const COLLECTED_PAYMENT_STATUSES = ['SUCCEEDED'] as const;

/** Hostel bookings that hold a bed right now. REQUESTED has not been granted one. */
const OCCUPYING_HOSTEL_STATUSES = ['ALLOCATED', 'CHECKED_IN'] as const;

/** Library loans that are still out. OVERDUE is included - the copy is emphatically not back. */
const OUT_LIBRARY_LOAN_STATUSES = ['ISSUED', 'OVERDUE'] as const;

/**
 * Placements that count as "the cohort was placed". OPTED_OUT/UNREGISTERED are honest
 * non-placements, NOT_PLACED is an honest failure, and each is reported in the byStatus breakdown.
 */
const PLACED_OUTCOME_STATUSES = ['PLACED'] as const;

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Numeric / group-row helpers
// ---------------------------------------------------------------------------

/**
 * Coerces a value that came out of a Prisma aggregate to a plain number.
 *
 * `Decimal` columns (UsageEvent.quantity is `Decimal(18,4)`) come back as Prisma.Decimal objects,
 * not numbers, and silently doing arithmetic on them (or letting a Decimal escape into a JSON
 * response) is a runtime failure at the worst possible moment. Accepts numbers, numeric strings,
 * Decimal, and null - everything degrades to a finite number rather than NaN.
 */
export function toFiniteNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const decimalLike = value as { toNumber?: () => number; s?: number };
  if (typeof decimalLike.toNumber === 'function') {
    const parsed = decimalLike.toNumber();
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof decimalLike.s === 'number' && Number.isFinite(decimalLike.s)) return decimalLike.s;
  return 0;
}

/** Reads a `_sum` payload out of an aggregate result (`_sum` is null for an empty table). */
function aggregateSum(result: unknown, field: string): number {
  const row = (result ?? {}) as Row;
  return toFiniteNumber((row['_sum'] as Row | null)?.[field]);
}

function groupCountOf(row: Row): number {
  const count = row['_count'];
  if (typeof count === 'number') return toFiniteNumber(count);
  return toFiniteNumber((count as Row | null)?.['_all']);
}

/** Turns a `groupBy` result into the `{ bucket: count }` histogram shape the calculators take. */
export function groupCountsBy(rows: unknown[], key: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows as Row[]) {
    const bucket = String(row[key] ?? 'UNKNOWN');
    counts[bucket] = (counts[bucket] ?? 0) + groupCountOf(row);
  }
  return counts;
}

/** Same, for a `groupBy` carrying `_sum` of a numeric column. */
export function groupSumsBy(rows: unknown[], key: string, field: string): Record<string, number> {
  const sums: Record<string, number> = {};
  for (const row of rows as Row[]) {
    const bucket = String(row[key] ?? 'UNKNOWN');
    sums[bucket] = (sums[bucket] ?? 0) + aggregateSum(row, field);
  }
  return sums;
}

function usageRowsFromGroups(rows: unknown[]): UsageMetricRow[] {
  return (rows as Row[]).map((row) => ({
    eventType: String(row['eventType'] ?? 'UNKNOWN'),
    quantity: aggregateSum(row, 'quantity'),
    eventCount: groupCountOf(row),
  }));
}

// ---------------------------------------------------------------------------
// SaaS (control plane) rollup
// ---------------------------------------------------------------------------

/**
 * Subscriptions that were live recurring revenue at `asOf`.
 *
 * Three states qualify, each for a different reason, and dropping any of them breaks a specific
 * metric:
 *  - ACTIVE/TRIALING/PAST_DUE with no cancellation: the ordinary case. PAST_DUE still occupies a
 *    slot and still owes money.
 *  - CANCELED but `canceledAt` after `asOf`: the subscription was live at the instant being asked
 *    about. Without this clause every churned tenant disappears from history, so `churnedMrrCents`
 *    and both churn rates are 0 in the very bucket the churn happened.
 *  - EXPIRED whose final paid period still covers `asOf`: same reconstruction. An expired
 *    subscription stopped renewing, but the period it paid for may well have included the instant.
 *
 * SUSPENDED is excluded on purpose: a suspended tenant is not being billed, so counting it would
 * inflate MRR with revenue nobody is collecting.
 */
export function liveSubscriptionWhere(asOf: Date): Row {
  return {
    currentPeriodStart: { lte: asOf },
    OR: [
      { status: { in: [...RECURRING_SUBSCRIPTION_STATUSES] }, canceledAt: null },
      { status: 'CANCELED', canceledAt: { gt: asOf } },
      { status: 'EXPIRED', currentPeriodEnd: { gt: asOf } },
    ],
  };
}

/**
 * The status a subscription effectively had at `asOf`, reconstructed from the state-change date.
 *
 * `Subscription.status` is a *current* value with no history table, so asking "what did this
 * subscription look like last month" using the raw column would report today's CANCELED for every
 * historical bucket. The reconstruction is: a subscription canceled after `asOf` was still a paying
 * subscriber at `asOf`, and an EXPIRED subscription whose final paid period covered `asOf` was too.
 * Both are reported as ACTIVE, which is what they were, rather than as the state they are in now.
 *
 * Not recoverable: a tenant who churned and later signed up again as a brand new Subscription row
 * leaves no trace of the old one. That understates churn slightly and is a far better failure than
 * the guaranteed-wrong alternative.
 */
function effectiveStatusAt(row: Row, asOf: Date): string {
  const status = String(row['status']);
  const canceledAt = row['canceledAt'];
  if (status === 'CANCELED' && canceledAt instanceof Date && canceledAt.getTime() > asOf.getTime()) return 'ACTIVE';
  const periodEnd = row['currentPeriodEnd'];
  if (status === 'EXPIRED' && periodEnd instanceof Date && periodEnd.getTime() > asOf.getTime()) return 'ACTIVE';
  return status;
}

/**
 * Loads every subscription that was live at `asOf`, normalized into the shape the MRR math takes.
 * `status` on the returned rows is the *as-of* status, not the current one (see `effectiveStatusAt`).
 */
async function loadSubscriptionInputs(prisma: AnalyticsPrisma, asOf: Date): Promise<SubscriptionRevenueInput[]> {
  const rows = await prisma.subscription.findMany({
    where: liveSubscriptionWhere(asOf),
    select: {
      id: true,
      tenantId: true,
      status: true,
      billingCycle: true,
      currentPeriodStart: true,
      currentPeriodEnd: true,
      canceledAt: true,
      plan: { select: { priceCents: true } },
      items: { select: { itemType: true, quantity: true, unitPriceCents: true } },
    },
  });

  return (rows as Row[]).map((row) => ({
    id: String(row['id']),
    tenantId: String(row['tenantId']),
    status: effectiveStatusAt(row, asOf),
    billingCycle: String(row['billingCycle']),
    planPriceCents: toFiniteNumber((row['plan'] as Row | null)?.['priceCents']),
    items: ((row['items'] as Row[] | null) ?? []).map((item) => ({
      itemType: String(item['itemType']),
      quantity: toFiniteNumber(item['quantity']),
      unitPriceCents: toFiniteNumber(item['unitPriceCents']),
    })),
    currentPeriodStart: (row['currentPeriodStart'] as Date | null) ?? null,
    currentPeriodEnd: (row['currentPeriodEnd'] as Date | null) ?? null,
    canceledAt: (row['canceledAt'] as Date | null) ?? null,
  }));
}

export interface SaasRollupOptions {
  period: AnalyticsPeriod;
  /** Defaults to the bucket immediately before `period`; this is the churn denominator. */
  comparisonPeriod?: AnalyticsPeriod;
  topTenantLimit?: number;
}

/**
 * Assembles the platform rollup for one bucket.
 *
 * The queries are independent, so they run concurrently - the platform dashboard is a fan-out of
 * nine small indexed aggregates, and serializing them would make the read path nine times the
 * slowest query instead of the slowest one.
 */
export async function computeSaasRollup(
  prisma: AnalyticsPrisma,
  options: SaasRollupOptions,
): Promise<SaasSnapshotMetrics> {
  const { period } = options;
  const comparison = options.comparisonPeriod ?? previousPeriod(period);
  const asOf = period.to;

  const [tenants, createdTenants, currentSubscriptions, previousSubscriptions, usageGroups, invoiceTotal, paymentTotal, totalUserCount, activeUserCount, meteredStudents] =
    await Promise.all([
      prisma.tenant.findMany({
        where: { createdAt: { lt: asOf } },
        select: { id: true, name: true, slug: true, status: true },
      }),
      prisma.tenant.count({ where: { createdAt: { gte: period.from, lt: period.to } } }),
      loadSubscriptionInputs(prisma, asOf),
      loadSubscriptionInputs(prisma, comparison.to),
      prisma.usageEvent.groupBy({
        by: ['eventType'],
        where: { occurredAt: { gte: period.from, lt: period.to } },
        _sum: { quantity: true },
        _count: { _all: true },
      }),
      prisma.invoice.aggregate({
        where: { periodStart: { gte: period.from, lt: period.to }, status: { in: [...BILLED_INVOICE_STATUSES] } },
        _sum: { totalCents: true },
      }),
      prisma.payment.aggregate({
        where: { paidAt: { gte: period.from, lt: period.to }, status: { in: [...COLLECTED_PAYMENT_STATUSES] } },
        _sum: { amountCents: true },
      }),
      prisma.user.count({ where: { createdAt: { lt: asOf } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: period.from, lt: asOf } } }),
      prisma.subscriptionItem.aggregate({ where: { itemType: 'PER_STUDENT' }, _sum: { quantity: true } }),
    ]);

  const tenantRows = tenants as Row[];
  const tenantCountByStatus = countBy(
    tenantRows.map((row) => ({ status: String(row['status']) })),
    'status',
  );
  const tenantNames = new Map(
    tenantRows.map((row) => [String(row['id']), { name: String(row['name']), slug: String(row['slug']) }]),
  );

  const billedCents = aggregateSum(invoiceTotal, 'totalCents');
  const collectedCents = aggregateSum(paymentTotal, 'amountCents');

  const metrics = buildSaasSnapshotMetrics({
    subscriptionsByStatus: countBy(currentSubscriptions, 'status'),
    recurringSubscriptionCount: currentSubscriptions.filter((subscription) =>
      isRecurringStatus(subscription.status),
    ).length,
    tenantCountByStatus,
    totalTenantCount: tenantRows.length,
    activeTenantCount: tenantRows.filter((row) =>
      (ACTIVE_TENANT_STATUSES as readonly string[]).includes(String(row['status'])),
    ).length,
    createdTenantCount: createdTenants,
    previousMrrByTenant: computeMrrByTenant(previousSubscriptions),
    currentMrrByTenant: computeMrrByTenant(currentSubscriptions),
    totalUserCount,
    activeUserCount,
    meteredStudentCount: toFiniteNumber(aggregateSum(meteredStudents, 'quantity')),
    billedCents,
    collectedCents,
    // Clamped: an over-collected window (prepayments, or a collection whose invoice belongs to a
    // later bucket) must not report negative receivables, which the UI would render as money owed
    // *to* the platform.
    outstandingCents: Math.max(billedCents - collectedCents, 0),
    usageByEventType: usageRowsFromGroups(usageGroups),
    tenantNames,
    topTenantLimit: options.topTenantLimit ?? 10,
  });

  return metrics;
}

// ---------------------------------------------------------------------------
// College (tenant) rollup
// ---------------------------------------------------------------------------

export interface CollegeRollupScope {
  tenantId: string;
  /**
   * RBAC scope. Omit entirely for tenant-wide visibility (the worker's per-tenant sweep does
   * exactly that, which is why the snapshot can serve institution-wide dashboards).
   */
  filter?: AnalyticsScopeFilter;
  /**
   * Campus ids applied to the one table that carries no program dimension.
   *
   * `AdmissionApplication` has `campusId` but no `programId`/`departmentId`, so a department- or
   * program-scoped HOD's admissions funnel can only be resolved through the campuses their grants
   * sit in. That is a deliberate approximation: a HOD sees applications for every program offered
   * at their campus, including programs in departments they do not manage. Omit for tenant-wide.
   */
  admissionCampusIds?: string[];
}

export interface CollegeRollupOptions {
  scope: CollegeRollupScope;
  period: AnalyticsPeriod;
}

/** A predicate that can never match a real uuid, used to fail closed on an empty scope. */
const IMPOSSIBLE_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The `Student` predicate every student-dimension table is reached through.
 *
 * Children are filtered with a relation predicate (`where: { student: { is: <this> } }`) rather
 * than by materializing the visible student ids into an `IN (...)` list. The list would be tens of
 * thousands of uuids for a real college, which exceeds practical parameter limits, blows up every
 * query plan, and turns one dashboard refresh into a multi-second sequential scan.
 *
 * Note there is no `departmentId` here: `Student` hangs off `Program`, so a DEPARTMENT grant has
 * already been expanded into that department's program ids by the caller. That is also why a
 * student with no program at all is invisible to a department-scoped caller - the same fail-closed
 * behavior `matchesAnalyticsScope` applies in the reporting engine.
 */
export function studentWhere(scope: CollegeRollupScope, asOf: Date): Row {
  const base: Row = { tenantId: scope.tenantId, createdAt: { lt: asOf }, deletedAt: null };
  const filter = scope.filter;
  if (!filter || filter.isGlobal) return base;

  const alternatives: Row[] = [];
  if (filter.campusIds.length > 0) alternatives.push({ campusId: { in: filter.campusIds } });
  if (filter.programIds.length > 0) alternatives.push({ programId: { in: filter.programIds } });
  if (alternatives.length === 0) return { ...base, id: IMPOSSIBLE_ID };
  return { ...base, OR: alternatives };
}

/** Campus predicate for campus-only tables. Mirrors studentWhere's fail-closed behavior. */
function admissionWhere(scope: CollegeRollupScope, asOf: Date): Row {
  const base: Row = { tenantId: scope.tenantId, createdAt: { lt: asOf } };
  if (!scope.filter || scope.filter.isGlobal) return base;
  if (!scope.admissionCampusIds || scope.admissionCampusIds.length === 0) {
    return { ...base, id: IMPOSSIBLE_ID };
  }
  return { ...base, campusId: { in: scope.admissionCampusIds } };
}

/**
 * Employee predicate for faculty counts.
 *
 * `Employee` has a real `departmentId` and `campusId`, so a department grant applies directly. It
 * has no program dimension, so a PROGRAM-only grant sees no faculty - stated rather than papered
 * over by widening to the campus, which would hand a single-program coordinator the whole
 * institution's headcount.
 */
function employeeWhere(scope: CollegeRollupScope): Row {
  const base: Row = {
    tenantId: scope.tenantId,
    employeeType: 'FACULTY',
    employmentStatus: 'ACTIVE',
    deletedAt: null,
  };
  const filter = scope.filter;
  if (!filter || filter.isGlobal) return base;

  const alternatives: Row[] = [];
  if (filter.departmentIds.length > 0) alternatives.push({ departmentId: { in: filter.departmentIds } });
  if (filter.campusIds.length > 0) alternatives.push({ campusId: { in: filter.campusIds } });
  if (alternatives.length === 0) return { ...base, id: IMPOSSIBLE_ID };
  return { ...base, OR: alternatives };
}

/**
 * Assembles the college rollup for one bucket.
 *
 * Every query carries an explicit `tenantId` from the caller's scope rather than relying on the
 * tenant-guard Prisma extension. The snapshot rollup is also used by the worker's tenant sweep,
 * which builds an unscoped client per tenant, and one code path that works for both callers is
 * worth more here than the extension's implicit filter.
 */
export async function computeCollegeRollup(
  prisma: AnalyticsPrisma,
  options: CollegeRollupOptions,
): Promise<CollegeSnapshotMetrics> {
  const { scope, period } = options;
  const { tenantId } = scope;
  const asOf = period.to;
  const from = period.from;

  const students = studentWhere(scope, asOf);
  const employee = employeeWhere(scope);
  const admissions = admissionWhere(scope, asOf);

  // The student-window predicate shared by every flow metric.
  const windowedStudent = { tenantId, student: { is: students } };
  // "New in this window" narrows the stock predicate's `createdAt` to the bucket itself. The
  // `deletedAt`/`campus`/`program` terms are inherited from the spread rather than re-listed.
  const newStudents = { ...students, createdAt: { gte: from, lt: asOf } };

  const [
    studentCount,
    newStudentCount,
    studentStatusGroups,
    facultyCount,
    admissionCount,
    admissionStatusGroups,
    attendanceGroups,
    feeBilled,
    feeStatusGroups,
    paymentsTotal,
    overdueFees,
    resultsPublished,
    resultOutcomeGroups,
    resultAverage,
    workloadGroups,
    placementRows,
    hostelOccupied,
    libraryOutstanding,
    transportActive,
    activeUsers,
  ] = await Promise.all([
    prisma.student.count({ where: students }),
    prisma.student.count({ where: newStudents }),
    prisma.student.groupBy({ by: ['status'], where: students, _count: { _all: true } }),
    prisma.employee.count({ where: employee }),
    prisma.admissionApplication.count({ where: admissions }),
    prisma.admissionApplication.groupBy({ by: ['status'], where: admissions, _count: { _all: true } }),
    prisma.studentAttendance.groupBy({
      by: ['status'],
      where: { ...windowedStudent, date: { gte: from, lt: asOf } },
      _count: { _all: true },
    }),
    prisma.studentFee.aggregate({
      where: { ...windowedStudent, createdAt: { gte: from, lt: asOf } },
      _sum: { amountCents: true },
    }),
    prisma.studentFee.groupBy({
      by: ['status'],
      where: { ...windowedStudent, createdAt: { gte: from, lt: asOf } },
      _count: { _all: true },
    }),
    prisma.studentPayment.aggregate({
      where: { tenantId, student: { is: students }, paymentDate: { gte: from, lt: asOf }, status: 'SUCCEEDED' },
      _sum: { amountCents: true },
    }),
    prisma.studentFee.aggregate({
      where: { ...windowedStudent, dueDate: { lt: asOf }, status: 'OVERDUE' },
      _sum: { amountCents: true, paidCents: true, waivedCents: true },
    }),
    prisma.studentResult.count({
      where: { ...windowedStudent, publishedAt: { gte: from, lt: asOf } },
    }),
    prisma.studentResult.groupBy({
      by: ['outcome'],
      where: { ...windowedStudent, publishedAt: { gte: from, lt: asOf } },
      _count: { _all: true },
    }),
    prisma.studentResult.aggregate({
      where: { ...windowedStudent, publishedAt: { gte: from, lt: asOf } },
      _avg: { percentage: true },
    }),
    prisma.facultyWorkload.groupBy({
      by: ['workloadType'],
      where: { tenantId, isActive: true, employee: { is: employee } },
      _sum: { hoursPerWeek: true },
    }),
    prisma.placementOutcome.findMany({
      where: { tenantId, student: { is: students }, createdAt: { gte: from, lt: asOf } },
      select: { studentId: true, outcomeStatus: true, finalPackageCents: true, createdAt: true },
    }),
    prisma.studentHostelBooking.count({
      where: { tenantId, status: { in: [...OCCUPYING_HOSTEL_STATUSES] }, student: { is: students } },
    }),
    prisma.studentLibraryLoan.count({
      where: { tenantId, status: { in: [...OUT_LIBRARY_LOAN_STATUSES] }, student: { is: students } },
    }),
    prisma.studentTransportPass.count({
      where: { tenantId, status: 'ACTIVE', student: { is: students } },
    }),
    // Null whenever the caller's scope is narrower than tenant-wide - see the field's contract.
    scope.filter && !scope.filter.isGlobal
      ? Promise.resolve(null)
      : prisma.user.count({ where: { tenantId, lastLoginAt: { gte: from, lt: asOf } } }),
  ]);

  const admissionStatuses = groupCountsBy(admissionStatusGroups, 'status');
  const attendanceStatuses = groupCountsBy(attendanceGroups, 'status');
  const funnel = buildAdmissionFunnel(admissionStatuses);
  const attendance = computeAttendanceRatePercent(attendanceStatuses);
  const resultOutcomes = groupCountsBy(resultOutcomeGroups, 'outcome');
  const pass = computePassRatePercent(resultOutcomes);

  const billedCents = aggregateSum(feeBilled, 'amountCents');
  const collectedCents = aggregateSum(paymentsTotal, 'amountCents');
  const fees = computeFeeCollection(billedCents, collectedCents, overdueOutstandingCents(overdueFees));

  const placement = summarizePlacement(placementRows);

  const workloadByType = groupSumsBy(workloadGroups, 'workloadType', 'hoursPerWeek');
  const totalHours = Object.values(workloadByType).reduce((sum, hours) => sum + hours, 0);

  return {
    studentCount,
    studentCountByStatus: groupCountsBy(studentStatusGroups, 'status'),
    newStudentCount,
    activeUserCount: activeUsers,
    facultyCount,

    admissionApplicationCount: admissionCount,
    admissionApplicationCountByStatus: admissionStatuses,
    admissionFunnel: funnel,
    admissionConversionPercent: funnelConversionPercent(funnel),

    attendanceMarkedCount: attendance.marked,
    attendancePresentCount: attendance.present,
    attendanceRatePercent: attendance.ratePercent,
    attendanceByStatus: attendanceStatuses,

    feesBilledCents: billedCents,
    feesCollectedCents: collectedCents,
    feesOutstandingCents: fees.outstandingCents,
    feesOverdueCents: fees.overdueCents,
    collectionRatePercent: fees.collectionRatePercent,
    feesByStatus: groupCountsBy(feeStatusGroups, 'status'),

    resultsPublishedCount: resultsPublished,
    resultsPassCount: pass.passCount,
    resultsPassPercent: pass.passPercent,
    averagePercentage: aggregateAverage(resultAverage, 'percentage'),
    resultsByOutcome: resultOutcomes,

    facultyWorkloadHoursPerWeek: round2(totalHours),
    averageFacultyWorkloadHours: facultyCount > 0 ? round2(totalHours / facultyCount) : 0,
    facultyWorkloadHoursByType: workloadByType,

    placementEligibleCount: placement.eligible,
    placementPlacedCount: placement.placed,
    placementRatePercent: placement.ratePercent,
    averagePackageCents: placement.averagePackageCents,
    placementByStatus: placement.byStatus,

    hostelOccupiedCount: hostelOccupied,
    libraryActiveLoanCount: libraryOutstanding,
    transportActivePassCount: transportActive,
  };
}

/**
 * Outstanding balance on overdue fee lines: amount minus what is already paid or waived.
 *
 * Computed here rather than in SQL because the outstanding amount is a per-row *difference* of
 * three columns; a single `_sum` over the filter cannot express it, and fanning the rows out to
 * Node to recompute would undo the point of the aggregate.
 */
function overdueOutstandingCents(aggregate: unknown): number {
  const sum = ((aggregate ?? {}) as Row)['_sum'] as Row | null;
  const outstanding =
    toFiniteNumber(sum?.['amountCents']) - toFiniteNumber(sum?.['paidCents']) - toFiniteNumber(sum?.['waivedCents']);
  return Math.max(outstanding, 0);
}

/**
 * `_avg` over an empty table is null. That must stay null ("no data yet") rather than collapsing
 * to 0, which the UI would render as "every student scored zero". A real average is rounded to two
 * decimals so it is formatted identically to every other rate on the dashboard.
 */
function aggregateAverage(result: unknown, field: string): number | null {
  const average = ((result ?? {}) as Row)['_avg'] as Row | null;
  const value = average?.[field];
  if (value === null || value === undefined) return null;
  const parsed = toFiniteNumber(value);
  return Number.isFinite(parsed) ? round2(parsed) : null;
}

/** Milliseconds since epoch for a value Prisma returned as a Date (0 for anything else). */
function millis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  return toFiniteNumber(value);
}

/**
 * Placement summary for the window.
 *
 * `PlacementOutcome` is unique per (tenant, academic year, student), so a student with outcomes
 * recorded in two different years can legitimately have two rows in a long window. The latest
 * `createdAt` wins, so the window reports each student's current outcome rather than double-counting
 * them into the denominator and quietly deflating the placement rate.
 */
function summarizePlacement(rows: unknown[]): {
  eligible: number;
  placed: number;
  ratePercent: number;
  averagePackageCents: number | null;
  byStatus: Record<string, number>;
} {
  const latest = new Map<string, Row>();
  for (const row of rows as Row[]) {
    const studentId = String(row['studentId'] ?? '');
    const existing = latest.get(studentId);
    if (!existing || millis(row['createdAt']) > millis(existing['createdAt'])) {
      latest.set(studentId, row);
    }
  }

  const byStatus: Record<string, number> = {};
  const packages: number[] = [];
  for (const row of latest.values()) {
    const status = String(row['outcomeStatus'] ?? 'UNKNOWN');
    byStatus[status] = (byStatus[status] ?? 0) + 1;
    if ((PLACED_OUTCOME_STATUSES as readonly string[]).includes(status)) {
      const packageCents = row['finalPackageCents'];
      if (packageCents !== null && packageCents !== undefined) packages.push(toFiniteNumber(packageCents));
    }
  }

  const placed = byStatus['PLACED'] ?? 0;
  return {
    eligible: latest.size,
    placed,
    ratePercent: ratePercent(placed, latest.size),
    averagePackageCents: averageOf(packages),
    byStatus,
  };
}

// ---------------------------------------------------------------------------
// Snapshot persistence
// ---------------------------------------------------------------------------

export interface SnapshotWrite {
  scope: AnalyticsScope;
  /** tenantId for TENANT scope, PLATFORM_SCOPE_KEY for PLATFORM scope. */
  scopeKey: string;
  /** Only set for TENANT scope; the FK and the tenantId index both key off this. */
  tenantId?: string;
  period: AnalyticsPeriod;
  metrics: unknown;
}

/**
 * The single read/write convention for `AnalyticsSnapshot`.
 *
 * `AnalyticsSnapshot` deliberately sits OUT of the auto-derived tenant-scoped model set (its
 * `tenantId` is nullable, because PLATFORM rows belong to no tenant). That means the tenant-guard
 * extension will not inject a filter for it, so every query against this table must name its scope
 * explicitly. This function is where that rule is written down once for writes; the matching read
 * rule lives in the API service, which always derives `scopeKey` from the authenticated context
 * rather than from request input.
 *
 * TENANT rows are always written with `scopeKey === tenantId`, which is what makes
 * `where: { scope: 'TENANT', scopeKey: tenantIdFromJwt }` a sufficient isolation boundary.
 */
export async function upsertAnalyticsSnapshot(prisma: AnalyticsPrisma, write: SnapshotWrite): Promise<void> {
  const isTenant = write.scope === 'TENANT';
  const tenantId = isTenant ? write.tenantId : undefined;
  if (isTenant && !tenantId) {
    throw new Error('A TENANT-scope analytics snapshot requires a tenantId.');
  }
  if (!isTenant && write.scopeKey !== PLATFORM_SCOPE_KEY) {
    throw new Error(`A PLATFORM-scope analytics snapshot must use scopeKey "${PLATFORM_SCOPE_KEY}".`);
  }

  await prisma.analyticsSnapshot.upsert({
    where: {
      scope_scopeKey_granularity_periodStart: {
        scope: write.scope,
        scopeKey: write.scopeKey,
        granularity: write.period.granularity,
        periodStart: write.period.from,
      },
    },
    create: {
      scope: write.scope,
      scopeKey: write.scopeKey,
      tenantId: tenantId ?? null,
      granularity: write.period.granularity,
      periodStart: write.period.from,
      periodEnd: write.period.to,
      metrics: write.metrics ?? {},
      computedAt: new Date(),
    },
    update: {
      periodEnd: write.period.to,
      metrics: write.metrics ?? {},
      computedAt: new Date(),
    },
  });
}
