/**
 * The per-college advanced analytics dashboard.
 *
 * Read path, in order:
 *   1. Resolve the caller's RBAC slice (`analytics.view` INTERSECTED with the source data
 *      permissions) - see analytics-scope.ts. Every number below is filtered to that slice.
 *   2. Serve the window from the materialized `AnalyticsSnapshot`, recomputing only the buckets the
 *      worker has not reached (AnalyticsReadService owns that policy).
 *   3. Reduce the window into the grouped payload the UI renders.
 *
 * Step 3 is where the real care is. The dashboard mixes **stock** metrics (how many students exist
 * now) with **flow** metrics (how many fees were collected over the window), and the reduction is
 * NOT the same operation for both:
 *
 *  - Stocks are reported from the NEWEST bucket. Summing "3,000 students" across 30 daily buckets
 *    would report 90,000 students, which is a very confident wrong answer.
 *  - Flows are summed across the window, and every rate is re-derived from the summed
 *    numerators/denominators. Averaging already-rounded percentages is the classic dashboard lie:
 *    100% and 0% over two buckets average to 50%, and the real combined figure is whatever the
 *    counts say it is.
 *  - Averages (`averagePercentage`, `averagePackageCents`) cannot be re-derived from means and are
 *    taken from the newest bucket. A mean of means over buckets with different result counts is not
 *    a mean, and reporting it as one is worse than reporting the latest one honestly.
 */

import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  computeAttendanceRatePercent,
  computeCollegeRollup,
  computeFeeCollection,
  computePassRatePercent,
  ratePercent,
  toFiniteNumber,
  type AdmissionFunnelStage,
  type AnalyticsPeriod,
  type AnalyticsPrisma,
  type CollegeSnapshotMetrics,
} from '@college-erp/analytics';
import type { AuthenticatedUser } from '@college-erp/auth';
import { QUEUE_NAMES, type AnalyticsRefreshTenantJobData, type CollegeAnalyticsOverviewDto } from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import { AnalyticsReadService, MAX_LIVE_REFRESH_PERIODS } from './analytics-read.service';
import type { AnalyticsQueryDto } from './dto/analytics-query.dto';
import {
  buildWindowSeries,
  metricNumber,
  resolveAnalyticsWindow,
  sumHistogram,
  toWindowDto,
  type SeriesSpec,
} from './analytics-window';
import { resolveAnalyticsScope, type ResolvedAnalyticsScope } from './analytics-scope';

/** What the charts plot. Deliberately a fixed list: the UI renders a section per entry. */
const COLLEGE_SERIES: readonly SeriesSpec[] = [
  { metric: 'studentCount', label: 'Students', unit: 'COUNT', value: (m) => metricNumber(m, 'studentCount') },
  { metric: 'newStudents', label: 'New students', unit: 'COUNT', value: (m) => metricNumber(m, 'newStudentCount') },
  { metric: 'admissionApplications', label: 'Applications', unit: 'COUNT', value: (m) => metricNumber(m, 'admissionApplicationCount') },
  { metric: 'attendanceRate', label: 'Attendance %', unit: 'PERCENT', value: (m) => metricNumber(m, 'attendanceRatePercent') },
  { metric: 'feesCollected', label: 'Fees collected', unit: 'CURRENCY_CENTS', value: (m) => metricNumber(m, 'feesCollectedCents') },
  { metric: 'feesOutstanding', label: 'Fees outstanding', unit: 'CURRENCY_CENTS', value: (m) => metricNumber(m, 'feesOutstandingCents') },
  { metric: 'resultsPassPercent', label: 'Pass %', unit: 'PERCENT', value: (m) => metricNumber(m, 'resultsPassPercent') },
  { metric: 'placementRate', label: 'Placement %', unit: 'PERCENT', value: (m) => metricNumber(m, 'placementRatePercent') },
  { metric: 'hostelOccupied', label: 'Hostel beds in use', unit: 'COUNT', value: (m) => metricNumber(m, 'hostelOccupiedCount') },
];

// ---------------------------------------------------------------------------
// JSONB boundary
// ---------------------------------------------------------------------------

/**
 * The snapshot's `metrics` column is JSONB written by a *different release* of this codebase, so
 * every field is untrusted at read time: a row materialized before a field existed parses to
 * `undefined`, and one written by a future version may carry extra keys. Numbers are coerced and
 * histograms defaulted here, once, so a missing field degrades to "0" instead of poisoning every
 * sum with NaN and rendering "NaN" on a dashboard.
 */
function normalizeCollegeMetrics(raw: unknown): CollegeSnapshotMetrics {
  const row = (raw ?? {}) as Record<string, unknown>;
  return {
    studentCount: toFiniteNumber(row['studentCount']),
    studentCountByStatus: histogram(row, 'studentCountByStatus'),
    newStudentCount: toFiniteNumber(row['newStudentCount']),
    activeUserCount: nullableNumber(row, 'activeUserCount'),
    facultyCount: toFiniteNumber(row['facultyCount']),

    admissionApplicationCount: toFiniteNumber(row['admissionApplicationCount']),
    admissionApplicationCountByStatus: histogram(row, 'admissionApplicationCountByStatus'),
    admissionFunnel: funnel(row['admissionFunnel']),
    admissionConversionPercent: toFiniteNumber(row['admissionConversionPercent']),

    attendanceMarkedCount: toFiniteNumber(row['attendanceMarkedCount']),
    attendancePresentCount: toFiniteNumber(row['attendancePresentCount']),
    attendanceRatePercent: toFiniteNumber(row['attendanceRatePercent']),
    attendanceByStatus: histogram(row, 'attendanceByStatus'),

    feesBilledCents: toFiniteNumber(row['feesBilledCents']),
    feesCollectedCents: toFiniteNumber(row['feesCollectedCents']),
    feesOutstandingCents: toFiniteNumber(row['feesOutstandingCents']),
    feesOverdueCents: toFiniteNumber(row['feesOverdueCents']),
    collectionRatePercent: toFiniteNumber(row['collectionRatePercent']),
    feesByStatus: histogram(row, 'feesByStatus'),

    resultsPublishedCount: toFiniteNumber(row['resultsPublishedCount']),
    resultsPassCount: toFiniteNumber(row['resultsPassCount']),
    resultsPassPercent: toFiniteNumber(row['resultsPassPercent']),
    averagePercentage: nullableNumber(row, 'averagePercentage'),
    resultsByOutcome: histogram(row, 'resultsByOutcome'),

    facultyWorkloadHoursPerWeek: toFiniteNumber(row['facultyWorkloadHoursPerWeek']),
    averageFacultyWorkloadHours: toFiniteNumber(row['averageFacultyWorkloadHours']),
    facultyWorkloadHoursByType: histogram(row, 'facultyWorkloadHoursByType'),

    placementEligibleCount: toFiniteNumber(row['placementEligibleCount']),
    placementPlacedCount: toFiniteNumber(row['placementPlacedCount']),
    placementRatePercent: toFiniteNumber(row['placementRatePercent']),
    averagePackageCents: nullableNumber(row, 'averagePackageCents'),
    placementByStatus: histogram(row, 'placementByStatus'),

    hostelOccupiedCount: toFiniteNumber(row['hostelOccupiedCount']),
    libraryActiveLoanCount: toFiniteNumber(row['libraryActiveLoanCount']),
    transportActivePassCount: toFiniteNumber(row['transportActivePassCount']),
  };
}

function histogram(row: Record<string, unknown>, field: string): Record<string, number> {
  const value = row[field];
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    out[key] = toFiniteNumber(count);
  }
  return out;
}

/**
 * A nullable metric. Null means "not applicable at this scope / nothing published yet" and must
 * survive to the UI as null - the `activeUserCount` and `averagePercentage` contracts both depend on
 * the difference between "no data" and "zero", and a plain `toFiniteNumber` would erase it (it maps
 * null to 0, which is exactly the wrong answer for these two fields).
 */
function nullableNumber(row: Record<string, unknown>, field: string): number | null {
  const value = row[field];
  return value === null || value === undefined ? null : toFiniteNumber(value);
}

function funnel(value: unknown): AdmissionFunnelStage[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const stage = entry as Record<string, unknown>;
    if (typeof stage['stage'] !== 'string') return [];
    return [
      {
        stage: stage['stage'],
        count: toFiniteNumber(stage['count']),
        percentOfTop: toFiniteNumber(stage['percentOfTop']),
      },
    ];
  });
}

@Injectable()
export class CollegeAnalyticsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly permissions: PermissionsService,
    private readonly read: AnalyticsReadService,
    @InjectQueue(QUEUE_NAMES.ANALYTICS_REFRESH) private readonly analyticsQueue: Queue,
  ) {}

  async overview(user: AuthenticatedUser, query: AnalyticsQueryDto): Promise<CollegeAnalyticsOverviewDto> {
    const window = resolveAnalyticsWindow(query);
    const scope = await resolveAnalyticsScope(this.tenantPrisma, this.permissions, user.tenantId, user.id);

    const { metricsByKey, meta } = await this.read.readWindow(
      this.client(),
      'TENANT',
      // From the authenticated JWT. Never from the request - see AnalyticsReadService's header.
      user.tenantId,
      window,
      (bucket) => this.computeBucket(scope, bucket),
      { live: query.live === true },
    );

    // Ascending, oldest first: `history[history.length - 1]` is therefore the newest bucket, which is
    // what every stock metric and average is read from.
    const history = window.buckets
      .map((bucket) => metricsByKey.get(bucket.key))
      .filter((raw): raw is unknown => raw !== undefined)
      .map(normalizeCollegeMetrics);

    // A brand-new tenant has no materialized history and the dashboard must still render zeros.
    // "No data yet" and "you may not see this" have to stay distinguishable, so this is never an
    // error - `meta` is what tells the reader the window was empty.
    const latest: CollegeSnapshotMetrics = history[history.length - 1] ?? normalizeCollegeMetrics(null);

    const attendanceStatuses = sumHistogram(history.map((metrics) => metrics.attendanceByStatus));
    const attendance = computeAttendanceRatePercent(attendanceStatuses);

    const billedCents = sum(history, (metrics) => metrics.feesBilledCents);
    const collectedCents = sum(history, (metrics) => metrics.feesCollectedCents);
    // Outstanding is re-derived across the WHOLE window, not summed per bucket: a fee billed in one
    // bucket and collected in the next would be counted as outstanding twice. `overdueCents` is a
    // stock (as of the newest bucket) and is passed through as computed.
    const fees = computeFeeCollection(billedCents, collectedCents, latest.feesOverdueCents);

    // Re-summed outcome histogram, because the pass-rate denominator deliberately excludes INCOMPLETE
    // rows and cannot be recovered from the rounded per-bucket percentage.
    const pass = computePassRatePercent(sumHistogram(history.map((metrics) => metrics.resultsByOutcome)));

    const placementByStatus = sumHistogram(history.map((metrics) => metrics.placementByStatus));
    const placementEligible = Object.values(placementByStatus).reduce((total, count) => total + count, 0);
    const placementPlaced = placementByStatus['PLACED'] ?? 0;

    return {
      window: toWindowDto(window),
      meta,
      scope: {
        isGlobal: scope.filter.isGlobal,
        campusIds: scope.filter.campusIds,
        departmentIds: scope.filter.departmentIds,
        programIds: scope.filter.programIds,
      },
      students: {
        // Stock -> newest bucket. Summing a headcount over 30 daily buckets would report 30x the
        // student body.
        total: latest.studentCount,
        byStatus: latest.studentCountByStatus,
        // Flow -> window total: genuinely "how many students joined during the window".
        newInPeriod: sum(history, (metrics) => metrics.newStudentCount),
        /**
         * Sign-ins in the NEWEST bucket, not distinct users across the window.
         *
         * `User.lastLoginAt` is a single column, so a per-bucket count counts one user once per day
         * they signed in; summing 30 daily buckets would report user-*days*, not monthly actives.
         * A true distinct count needs either a dedicated window query on the read path (a second
         * source of truth next to the snapshot) or a MONTHLY view - so the honest answer is the
         * latest bucket, and the UI captions it with the bucket it came from. The `activeUsers`
         * series still gives the per-bucket trend.
         */
        activeUserCount: latest.activeUserCount,
        facultyCount: latest.facultyCount,
      },
      admissions: {
        // Stock: applications existing as of the newest bucket. Each application sits in exactly
        // one status, so this is a distribution, not a cumulative funnel.
        total: latest.admissionApplicationCount,
        byStatus: latest.admissionApplicationCountByStatus,
        funnel: latest.admissionFunnel,
        conversionPercent: latest.admissionConversionPercent,
      },
      attendance: {
        marked: attendance.marked,
        present: attendance.present,
        ratePercent: attendance.ratePercent,
        byStatus: attendanceStatuses,
      },
      fees: {
        billedCents,
        collectedCents,
        outstandingCents: fees.outstandingCents,
        // Stock: what is overdue as of the newest bucket, not a window total.
        overdueCents: fees.overdueCents,
        collectionRatePercent: fees.collectionRatePercent,
        byStatus: sumHistogram(history.map((metrics) => metrics.feesByStatus)),
      },
      results: {
        published: sum(history, (metrics) => metrics.resultsPublishedCount),
        passCount: pass.passCount,
        passPercent: pass.passPercent,
        averagePercentage: latest.averagePercentage,
      },
      faculty: {
        // Workload rows carry no date filter at all - this is a "right now" figure.
        totalHoursPerWeek: latest.facultyWorkloadHoursPerWeek,
        averageHours: latest.averageFacultyWorkloadHours,
        byWorkloadType: latest.facultyWorkloadHoursByType,
      },
      placement: {
        eligible: placementEligible,
        placed: placementPlaced,
        ratePercent: ratePercent(placementPlaced, placementEligible),
        averagePackageCents: latest.averagePackageCents,
        byStatus: placementByStatus,
      },
      amenities: {
        hostelOccupiedCount: latest.hostelOccupiedCount,
        libraryActiveLoanCount: latest.libraryActiveLoanCount,
        transportActivePassCount: latest.transportActivePassCount,
      },
      series: buildWindowSeries(window.buckets, window.granularity, metricsByKey, COLLEGE_SERIES),
    };
  }

  /**
   * Queues a durable recompute of this tenant's trailing buckets.
   *
   * Enqueued rather than computed inline on purpose: a refresh is ~20 aggregate queries per bucket,
   * and running that on the request thread would hold a response open for as long as the work takes.
   * The worker calls the same `computeCollegeRollup` this service's live fallback uses, so the row it
   * writes and the row a later live recompute would produce are identical.
   */
  async requestRefresh(user: AuthenticatedUser, query: AnalyticsQueryDto) {
    const window = resolveAnalyticsWindow(query);
    // Resolve the scope anyway: a caller whose grants do not overlap must be refused now, not from a
    // job that fails later with no one watching.
    await resolveAnalyticsScope(this.tenantPrisma, this.permissions, user.tenantId, user.id);

    const jobData: AnalyticsRefreshTenantJobData = {
      tenantId: user.tenantId,
      granularity: window.granularity,
      // Bounded for the same reason MAX_LIVE_REFRESH_PERIODS exists: a refresh must not double as a
      // request to recompute an unbounded history.
      periods: Math.min(window.buckets.length, MAX_LIVE_REFRESH_PERIODS),
    };
    const job = await this.analyticsQueue.add('analytics-refresh-tenant', jobData, {
      removeOnComplete: 100,
      removeOnFail: 500,
    });
    return { queued: true, jobId: job.id ?? null, ...jobData };
  }

  private async computeBucket(
    scope: ResolvedAnalyticsScope,
    period: AnalyticsPeriod,
  ): Promise<CollegeSnapshotMetrics> {
    return computeCollegeRollup(this.client(), { scope, period });
  }

  /** One place where the generated client meets the analytics package's structural port. */
  private client(): AnalyticsPrisma {
    return this.tenantPrisma.client as unknown as AnalyticsPrisma;
  }
}

function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
