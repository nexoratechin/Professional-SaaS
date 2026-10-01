import { ForbiddenException } from '@nestjs/common';
import { analyticsScopeFilterFromGrants, type AnalyticsScopeFilter, type CollegeRollupScope } from '@college-erp/analytics';
import { PERMISSION_KEYS } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import {
  asReportScopeGrants,
  assertNonEmptyEffectiveScope,
  intersectReportScope,
  scopeIsGlobal,
} from '../reports/reports-scope';

/**
 * Every source permission whose data the college dashboard aggregates.
 *
 * A caller needs `analytics.view` PLUS at least one of these. Requiring only the first would let
 * someone with a perfectly valid `analytics.view` grant read the whole institution's fees and
 * attendance purely because the dashboard aggregates them - the entry permission says "you may look
 * at analytics", not "the data underneath is yours".
 */
export const ANALYTICS_SOURCE_PERMISSIONS = [
  PERMISSION_KEYS.STUDENTS_VIEW,
  PERMISSION_KEYS.ADMISSIONS_VIEW,
  PERMISSION_KEYS.ATTENDANCE_VIEW,
  PERMISSION_KEYS.FEES_VIEW,
  PERMISSION_KEYS.EXAMS_VIEW,
  PERMISSION_KEYS.RESULTS_VIEW,
  PERMISSION_KEYS.HR_VIEW,
  PERMISSION_KEYS.PLACEMENTS_VIEW,
  PERMISSION_KEYS.HOSTEL_VIEW,
  PERMISSION_KEYS.LIBRARY_VIEW,
  PERMISSION_KEYS.TRANSPORT_VIEW,
] as const;

export interface ResolvedAnalyticsScope extends CollegeRollupScope {
  filter: AnalyticsScopeFilter;
  /** Which of ANALYTICS_SOURCE_PERMISSIONS actually backed the intersection; echoed to the UI. */
  sourcePermissions: string[];
}

/**
 * Resolves the RBAC slice the college dashboard is allowed to see.
 *
 * The rule is the one the reporting engine already enforces, applied to the whole dashboard: the
 * `analytics.view` grant and the source-domain grant are *intersected*, not unioned. Intersecting is
 * the security-relevant part - a campus-scoped `analytics.view` grant paired with an
 * institution-wide `students.view` grant must still yield a campus-scoped dashboard, and unioning
 * the two would quietly widen it to the whole tenant. `intersectReportScope` is reused verbatim
 * rather than re-derived so a HOD sees the same slice here that they see in a saved report.
 *
 * Two shape-specific expansions happen afterwards, because the dashboard mixes tables with
 * different dimensions and no single hierarchy describes them all:
 *
 *  - A DEPARTMENT grant is expanded into that department's **program ids**. `Student` hangs off
 *    `Program` and has no `departmentId` column, so without this a HOD's dashboard would match no
 *    students at all.
 *  - The campuses behind every grant are resolved separately for `AdmissionApplication`, the one
 *    table that carries `campusId` and no program dimension. This is a deliberate approximation:
 *    a department-scoped HOD sees applications for every program offered at their campus.
 */
export async function resolveAnalyticsScope(
  tenantPrisma: TenantScopedPrismaService,
  permissions: PermissionsService,
  tenantId: string,
  userId: string,
): Promise<ResolvedAnalyticsScope> {
  const effective = await permissions.getEffectivePermissionsWithScope(tenantId, userId);
  const analyticsGrants = asReportScopeGrants(effective[PERMISSION_KEYS.ANALYTICS_VIEW] ?? []);
  if (analyticsGrants.length === 0) {
    throw new ForbiddenException('Missing required permission: analytics.view');
  }

  const sourceGrants = ANALYTICS_SOURCE_PERMISSIONS.flatMap((permission) =>
    asReportScopeGrants(effective[permission] ?? []),
  );
  if (sourceGrants.length === 0) {
    throw new ForbiddenException(
      'Analytics needs at least one data permission (students, admissions, attendance, fees, exams, results, hr, placements, hostel, library or transport).',
    );
  }

  const merged = await intersectReportScope(tenantPrisma, analyticsGrants, sourceGrants);
  assertNonEmptyEffectiveScope(merged);

  // The reporting helper resolves an OWN/OWN intersection to a single pseudo-scope. Analytics is the
  // one caller for which that is meaningless: a dashboard has no "your own records" view, and
  // falling back to tenant-wide here would hand a personal-scoped user the whole institution's
  // revenue and student counts. Refuse instead of guessing.
  if (merged.every((grant) => grant.scopeType === 'OWN')) {
    throw new ForbiddenException('Personal-scoped (OWN) permissions do not support analytics reporting.');
  }

  const isGlobal = scopeIsGlobal(merged);
  const filter = analyticsScopeFilterFromGrants(merged);

  if (isGlobal) {
    return { tenantId, filter, sourcePermissions: [...ANALYTICS_SOURCE_PERMISSIONS] };
  }

  const [programs, departments] = await Promise.all([
    filter.departmentIds.length
      ? tenantPrisma.client.program.findMany({
          where: { departmentId: { in: filter.departmentIds } },
          select: { id: true, department: { select: { campusId: true } } },
        })
      : [],
    filter.departmentIds.length
      ? tenantPrisma.client.department.findMany({
          where: { id: { in: filter.departmentIds } },
          select: { campusId: true },
        })
      : [],
  ]);

  const programCampuses = programs
    .map((program) => program.department?.campusId)
    .filter((campusId): campusId is string => Boolean(campusId));

  // A Department with no campus cannot anchor an AdmissionApplication filter, so it contributes
  // nothing here. Failing closed is the right side to err on: dropping the constraint would show the
  // HOD every application in the tenant.
  const departmentCampuses = departments
    .map((department) => department.campusId)
    .filter((campusId): campusId is string => Boolean(campusId));

  return {
    tenantId,
    filter: {
      ...filter,
      // Populated here (and only here) so the rollup's Student predicate can express a department
      // grant at all. `analyticsScopeFilterFromGrants` deliberately leaves programIds alone.
      programIds: [...new Set([...filter.programIds, ...programs.map((program) => program.id)])],
    },
    // A department/program grant must reach AdmissionApplication through its campus, since that
    // table has no program or department column to filter on.
    admissionCampusIds: [...new Set([...filter.campusIds, ...departmentCampuses, ...programCampuses])],
    sourcePermissions: ANALYTICS_SOURCE_PERMISSIONS.filter(
      (permission) => (effective[permission] ?? []).length > 0,
    ),
  };
}
