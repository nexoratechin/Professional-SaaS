import { ForbiddenException } from '@nestjs/common';
import { analyticsScopeFilterFromGrants, type AnalyticsScopeFilter } from '@college-erp/analytics';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AiScopeSnapshotDto } from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { PermissionsService } from '../rbac/permissions.service';
import {
  asReportScopeGrants,
  assertNonEmptyEffectiveScope,
  intersectReportScope,
  scopeContainsRequestedNode,
  scopeIsGlobal,
} from '../reports/reports-scope';
import { resolveAnalyticsScope, type ResolvedAnalyticsScope } from '../analytics/analytics-scope';
import { AI_ANALYTICS_SOURCE_PERMISSIONS, type AiIntentDefinition } from './ai-intent-router';

/**
 * The RBAC slice one assistant answer is allowed to read.
 *
 * The rule is the reporting engine's rule, reused verbatim: the assistant's entry permission
 * (`ai.view`) is **intersected** with the source-domain permission the detected intent reads
 * under — never unioned. A principal who is institution-wide on `ai.view` but department-scoped on
 * `fees.view` must not get institution-wide fee numbers because they phrased it as a question, and
 * intersection is the only operation where that is structurally guaranteed.
 *
 * Two consequences are deliberate rather than incidental:
 *
 *  - **OWN-only intersections are refused.** A personal-scoped grant has no meaning for an
 *    aggregate ("how many students are at risk?"), and the alternative — falling back to
 *    tenant-wide — would hand a personal-scoped user the whole institution. This is the same
 *    refusal `resolveAnalyticsScope` makes, and it exists for the same reason.
 *  - **The analytics-shaped intents reuse `resolveAnalyticsScope` outright** rather than
 *    re-deriving their scope here. The department-comparison and overview answers read the same
 *    mixed-dimension data the analytics dashboard does, and a HOD must see the identical slice in
 *    both places; two implementations of the same scope rule is how they drift apart.
 */
export interface ResolvedAiScope {
  tenantId: string;
  /** The flat id filter every student-dimension query is narrowed with. */
  filter: AnalyticsScopeFilter;
  /**
   * Campuses behind a department/program grant, for `AdmissionApplication` — the one table with a
   * campusId and no program dimension. Same deliberate approximation as analytics: a
   * department-scoped caller reaches admissions through the campus their programs sit in.
   */
  admissionCampusIds?: string[];
  /** Frozen for the answer's `scope` field and for the AiQueryLog row. */
  snapshot: AiScopeSnapshotDto;
  /** True for intents whose scope came from the analytics resolver (mixed-dimension reads). */
  analyticsShaped: boolean;
  /** Only populated for analytics-shaped scopes. */
  analytics?: ResolvedAnalyticsScope;
}

export async function resolveAiScope(
  tenantPrisma: TenantScopedPrismaService,
  permissions: PermissionsService,
  tenantId: string,
  userId: string,
  definition: AiIntentDefinition,
): Promise<ResolvedAiScope> {
  const effective = await permissions.getEffectivePermissionsWithScope(tenantId, userId);

  const entryGrants = asReportScopeGrants(effective[PERMISSION_KEYS.AI_VIEW] ?? []);
  if (entryGrants.length === 0) {
    throw new ForbiddenException('Missing required permission: ai.view');
  }

  if (definition.requiresReportsView && !(effective[PERMISSION_KEYS.REPORTS_VIEW] ?? []).length) {
    // Report generation executes the reporting engine. A caller who cannot run a report directly
    // must not be able to make the assistant run one on their behalf — otherwise `ai.create` would
    // be a strictly more powerful way to reach report data than `reports.view` is.
    throw new ForbiddenException('Missing required permission: reports.view');
  }

  if (isAnalyticsShaped(definition)) {
    const analytics = await resolveAnalyticsScope(tenantPrisma, permissions, tenantId, userId);
    // The analytics resolver intersects `analytics.view` with the analytics source permissions.
    // That is a *different* entry permission from `ai.view`, so the assistant's own entry grant is
    // intersected on top of it — otherwise holding only `analytics.view` would let someone use the
    // assistant without any `ai.*` grant at all.
    const merged = await intersectReportScope(tenantPrisma, entryGrants, analytics.filter.isGlobal
      ? [{ scopeType: 'GLOBAL' }]
      : filterToGrants(analytics.filter));
    assertNonEmptyEffectiveScope(merged);
    if (merged.every((grant) => grant.scopeType === 'OWN')) {
      throw new ForbiddenException('Personal-scoped (OWN) permissions do not support AI analytics answers.');
    }

    const snapshot: AiScopeSnapshotDto = {
      entryGrants,
      sourceGrants: [{ scopeType: 'GLOBAL' }],
      effectiveGrants: merged,
      isGlobal: scopeIsGlobal(merged),
    };

    if (snapshot.isGlobal) {
      // `ai.view` GLOBAL + analytics GLOBAL: institution-wide. The analytics filter is already
      // global in this case (it could not be narrower than GLOBAL and still intersect a GLOBAL
      // entry grant), so its ids are not needed.
      return {
        tenantId,
        filter: { isGlobal: true, campusIds: [], departmentIds: [], programIds: [] },
        snapshot,
        analyticsShaped: true,
        analytics: { ...analytics, filter: { isGlobal: true, campusIds: [], departmentIds: [], programIds: [] } },
      };
    }

    // Not global: re-derive from the narrowed filter so the answer's scope really is the
    // intersection, not the wider analytics one.
    const narrowed = analyticsScopeFilterFromGrants(merged);
    return {
      tenantId,
      filter: narrowed,
      admissionCampusIds: analytics.admissionCampusIds,
      snapshot,
      analyticsShaped: true,
      analytics: { ...analytics, filter: narrowed },
    };
  }

  const sourceGrants = asReportScopeGrants(effective[definition.sourcePermission] ?? []);
  if (sourceGrants.length === 0) {
    throw new ForbiddenException(
      `The AI assistant capability "${definition.intent}" requires the ${definition.sourcePermission} permission.`,
    );
  }

  const merged = await intersectReportScope(tenantPrisma, entryGrants, sourceGrants);
  assertNonEmptyEffectiveScope(merged);
  if (merged.every((grant) => grant.scopeType === 'OWN')) {
    throw new ForbiddenException('Personal-scoped (OWN) permissions do not support AI data answers.');
  }

  const isGlobal = scopeIsGlobal(merged);
  const filter = analyticsScopeFilterFromGrants(merged);

  const resolved: ResolvedAiScope = {
    tenantId,
    filter,
    snapshot: { entryGrants, sourceGrants, effectiveGrants: merged, isGlobal },
    analyticsShaped: false,
  };

  if (isGlobal) {
    return resolved;
  }

  // DEPARTMENT grants must become program ids because `Student` hangs off `Program` and has no
  // departmentId — without this a HOD's "students with low attendance" would match nothing. The
  // campuses behind those programs additionally anchor the admission-scoped intents, which have no
  // program column to filter on.
  if (filter.departmentIds.length === 0) {
    return resolved;
  }

  const [programs, departments] = await Promise.all([
    tenantPrisma.client.program.findMany({
      where: { departmentId: { in: filter.departmentIds } },
      select: { id: true, department: { select: { campusId: true } } },
    }),
    tenantPrisma.client.department.findMany({
      where: { id: { in: filter.departmentIds } },
      select: { campusId: true },
    }),
  ]);

  const programCampuses = programs
    .map((program) => program.department?.campusId)
    .filter((campusId): campusId is string => Boolean(campusId));
  const departmentCampuses = departments
    .map((department) => department.campusId)
    .filter((campusId): campusId is string => Boolean(campusId));

  return {
    ...resolved,
    filter: {
      ...filter,
      programIds: [...new Set([...filter.programIds, ...programs.map((program) => program.id)])],
    },
    admissionCampusIds: [...new Set([...filter.campusIds, ...departmentCampuses, ...programCampuses])],
  };
}

/**
 * Intents whose answer aggregates several domains at once, and therefore need the analytics
 * scope contract ("`ai.view` + at least one data permission") rather than a single source
 * permission.
 */
export function isAnalyticsShaped(definition: AiIntentDefinition): boolean {
  return (
    definition.intent === 'ANALYTICS_OVERVIEW' ||
    definition.intent === 'DEPARTMENT_PERFORMANCE' ||
    definition.sourcePermission === PERMISSION_KEYS.ANALYTICS_VIEW
  );
}

export { AI_ANALYTICS_SOURCE_PERMISSIONS };

/** Inverse of `analyticsScopeFilterFromGrants`, for re-intersecting a resolved filter. */
function filterToGrants(filter: AnalyticsScopeFilter) {
  const grants: Array<{
    scopeType: 'GLOBAL' | 'CAMPUS' | 'DEPARTMENT' | 'PROGRAM';
    campusId?: string;
    departmentId?: string;
    programId?: string;
  }> = [];
  if (filter.isGlobal) return [{ scopeType: 'GLOBAL' as const }];
  for (const campusId of filter.campusIds) grants.push({ scopeType: 'CAMPUS', campusId });
  for (const departmentId of filter.departmentIds) grants.push({ scopeType: 'DEPARTMENT', departmentId });
  for (const programId of filter.programIds) grants.push({ scopeType: 'PROGRAM', programId });
  return grants;
}

/**
 * Resolves a caller-supplied org-unit id against their effective scope.
 *
 * Called for every explicit `campusId`/`departmentId`/`programId` on an assistant request. The
 * check is not decorative: without it, a caller could name a department they cannot see and the
 * narrowed query would return its rows anyway — because "you asked for department X" would then be
 * treated as an authorization. `scopeContainsRequestedNode` is the reporting engine's own helper,
 * so a caller passes here exactly when they would pass in a saved report.
 */
export async function assertRequestedNodeInScope(
  tenantPrisma: TenantScopedPrismaService,
  scope: ResolvedAiScope,
  requested: { campusId?: string; departmentId?: string; programId?: string },
): Promise<void> {
  const ids = [requested.campusId, requested.departmentId, requested.programId].filter(Boolean);
  if (ids.length === 0) return;
  const allowed = await scopeContainsRequestedNode(tenantPrisma, scope.snapshot.effectiveGrants, requested);
  if (!allowed) {
    throw new ForbiddenException('The requested campus/department/program is outside your data scope.');
  }
}