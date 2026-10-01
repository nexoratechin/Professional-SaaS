/**
 * College-side aggregation helpers: funnel conversion, attendance/collection/pass rates, and the
 * scope-filter contract the tenant analytics reads through.
 *
 * The RBAC scope filtering is intentionally *not* re-implemented here. It reuses the exact same
 * Campus -> Department -> Program grant semantics the reporting engine enforces, so a
 * department-scoped HOD sees the same slice of students in a dashboard that they see in a report.
 */

import { ratePercent } from './mrr';
import { round2 } from './periods';
import type { AdmissionFunnelStage, AnalyticsScopeGrant } from './types';

/**
 * Admission pipeline stages, in funnel order.
 *
 * These are the real AdmissionApplicationStatus values minus the terminal ones (WAITLISTED,
 * REJECTED, CANCELLED), which are deliberately excluded: they are outcomes, not stages, and
 * counting them as funnel bars would draw a dead end. Hardcoded as a literal (rather than derived
 * from Prisma) so this package stays framework-free; the list is asserted against the enum in
 * packages/database's analytics-rollup test so the two cannot drift apart unnoticed.
 */
export const ADMISSION_FUNNEL_ORDER = [
  'INITIATED',
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'DOCUMENTS_VERIFIED',
  'MERIT_LISTED',
  'COUNSELLING_SCHEDULED',
  'COUNSELLED',
  'SELECTED',
  'OFFERED',
  'OFFER_ACCEPTED',
  'FEE_PAID',
  'ENROLLED',
] as const;

/** Statuses that end an application without it reaching ENROLLED. */
export const ADMISSION_TERMINAL_STATUSES = ['WAITLISTED', 'REJECTED', 'CANCELLED'] as const;

export type AdmissionFunnelStageKey = (typeof ADMISSION_FUNNEL_ORDER)[number];

/**
 * Turns a flat status histogram into the admissions funnel.
 *
 * `AdmissionApplication.status` is a mutually exclusive *current* state - an application sits in
 * exactly one status, it does not accumulate them. So the histogram is already the funnel: 100
 * INITIATED / 90 SUBMITTED / 40 OFFERED / 35 ADMITTED really does describe 100 applications
 * distributed across four current stages, and the honest rendering is a pass-through, NOT a
 * cumulative sum. (A cumulative sum would claim 100 apps reached OFFERED, which the data does not
 * support and which is the standard way funnel charts quietly overstate conversion.)
 *
 * Applications in terminal states outside the listed funnel (REJECTED, WITHDRAWN) counted neither
 * way: they are excluded from the top so a rejection wave cannot deflate the conversion rate, and
 * excluded from the stages so they are not plotted as a stage that never happened. They remain
 * visible in the raw `admissionApplicationCountByStatus` breakdown the API returns alongside.
 *
 * `percentOfTop` is relative to the top of the funnel, so the chart's widest bar is always 100%.
 */
export function buildAdmissionFunnel(
  statusCounts: Record<string, number>,
  order: readonly string[] = ADMISSION_FUNNEL_ORDER,
): AdmissionFunnelStage[] {
  const top = order.reduce((sum, stage) => sum + (statusCounts[stage] ?? 0), 0);

  return order.map((stage) => {
    const count = statusCounts[stage] ?? 0;
    return { stage, count, percentOfTop: ratePercent(count, top) };
  });
}

/**
 * Enrolled as a share of every application still in the pipeline.
 *
 * Divides by the *sum* of the funnel stages, not by the INITIATED count: with an exclusive status
 * model, INITIATED is just one bucket, and "200 applications currently at INITIATED" out of a
 * 350-application pipeline is a fact about the snapshot, not the size of the pipeline. Using it as
 * the denominator would report 40/200 = 20% enrolled when the real rate is 40/350 = 11.43%.
 */
export function funnelConversionPercent(funnel: readonly AdmissionFunnelStage[]): number {
  const last = funnel[funnel.length - 1];
  const total = funnel.reduce((sum, stage) => sum + stage.count, 0);
  if (!last || total === 0) return 0;
  return ratePercent(last.count, total);
}

/**
 * Attendance percentage over a period. LATE counts as attending (the student was physically
 * present) while ABSENT/LEAVE do not; INCOMPLETE-equivalent states are simply absent from the
 * breakdown. Totals are passed in rather than summed from the histogram so the caller can compute
 * them from the same `count` the database used.
 */
export function computeAttendanceRatePercent(
  statusCounts: Record<string, number>,
): { marked: number; present: number; ratePercent: number } {
  const present = (statusCounts['PRESENT'] ?? 0) + (statusCounts['LATE'] ?? 0);
  const marked = Object.values(statusCounts).reduce((sum, count) => sum + count, 0);
  return { marked, present, ratePercent: ratePercent(present, marked) };
}

/** Fee collection: what is still outstanding, what has already gone overdue, and the rate. */
export function computeFeeCollection(
  billedCents: number,
  collectedCents: number,
  overdueCents: number,
): { outstandingCents: number; overdueCents: number; collectionRatePercent: number } {
  const outstandingCents = Math.max(billedCents - collectedCents, 0);
  return {
    outstandingCents,
    overdueCents: Math.max(overdueCents, 0),
    collectionRatePercent: ratePercent(collectedCents, billedCents),
  };
}

/** Pass rate excludes INCOMPLETE rows - they are not yet a result, so counting them as failures
 * would understate performance and is the more flattering-to-nobody error to avoid. */
export function computePassRatePercent(
  outcomeCounts: Record<string, number>,
): { passPercent: number; passCount: number; gradedCount: number } {
  const passCount = (outcomeCounts['PASS'] ?? 0) + (outcomeCounts['PASS_WITH_GRACE'] ?? 0);
  const totalCount = Object.values(outcomeCounts).reduce((sum, count) => sum + count, 0);
  const gradedCount = Math.max(totalCount - (outcomeCounts['INCOMPLETE'] ?? 0), 0);
  return {
    passPercent: ratePercent(passCount, gradedCount),
    passCount,
    gradedCount,
  };
}

/** Mean of the finite values only; null (not 0) when there is nothing to average, so the UI can
 * distinguish "no data yet" from "everyone scored zero". */
export function averageOf(values: readonly (number | null | undefined)[]): number | null {
  const finite = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (finite.length === 0) return null;
  return round2(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

// ---------------------------------------------------------------------------
// RBAC scope filtering
// ---------------------------------------------------------------------------

/**
 * Campus/department/program ids a set of effective scope grants resolves to.
 *
 * `campusIds` holds ONLY grants that actually grant the whole campus. A DEPARTMENT or PROGRAM
 * grant is expanded by the reporting scope helper to include its parent campus id so the granted
 * subtree stays reachable, but that campus id is deliberately NOT recorded as campus-wide access:
 * otherwise a HOD scoped to one department would pass the campus check for every other department
 * in the same campus, silently widening their dashboard to the whole institution. Narrow grants
 * are matched on their own id instead, and a record that carries only a campus cannot be
 * attributed to a department, so it fails closed.
 */
export interface AnalyticsScopeFilter {
  isGlobal: boolean;
  /** Campuses the caller may see in full. */
  campusIds: string[];
  departmentIds: string[];
  programIds: string[];
}

/**
 * Resolves effective grants into a flat id filter.
 *
 * A DEPARTMENT grant is expanded to its campus by the caller (apps/api's reports-scope helper
 * already does that resolution and passes the expanded nodes in), so a department grant
 * contributes both its own departmentId and its campusId - otherwise a department-scoped dashboard
 * would drop every student whose record only carries a campus.
 */
export function analyticsScopeFilterFromGrants(grants: readonly AnalyticsScopeGrant[]): AnalyticsScopeFilter {
  const campusIds: string[] = [];
  const departmentIds: string[] = [];
  const programIds: string[] = [];

  for (const grant of grants) {
    if (grant.campusId && grant.scopeType === 'CAMPUS') campusIds.push(grant.campusId);
    if (grant.departmentId) departmentIds.push(grant.departmentId);
    if (grant.programId) programIds.push(grant.programId);
  }

  return {
    isGlobal: grants.some((grant) => grant.scopeType === 'GLOBAL'),
    campusIds: unique(campusIds),
    departmentIds: unique(departmentIds),
    programIds: unique(programIds),
  };
}

export interface ScopedStudentDimension {
  campusId: string | null;
  programId: string | null;
  /** Resolved by the caller from programId -> departmentId, or null when unknown. */
  departmentId?: string | null;
}

/**
 * Applies the scope filter to an entity that carries campus/program. The three checks are OR'd
 * because the hierarchy is nested: a student in a department's program belongs to the department's
 * campus too, and the grant set may name any level of the tree.
 */
export function matchesAnalyticsScope(dimension: ScopedStudentDimension, filter: AnalyticsScopeFilter): boolean {
  if (filter.isGlobal) return true;
  const { campusId, departmentId, programId } = dimension;
  if (programId && filter.programIds.includes(programId)) return true;
  if (departmentId && filter.departmentIds.includes(departmentId)) return true;
  if (campusId && filter.campusIds.includes(campusId)) return true;
  return false;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}
