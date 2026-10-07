/**
 * Scope plumbing for the global-search fan-out.
 *
 * Search must never widen access, so for every entity family it re-uses the *same* scope helper
 * the owning module applies on its own list endpoint (students → studentScopeFilter, admissions →
 * admissionScopeFilter, academics → academicScopeFilter('course'), exams/results/certificates →
 * the exam-family helpers, HR → hrEmployeeScopeFilter). Families whose modules gate on a
 * permission only today (fees, payments, helpdesk, documents) are treated the same way here —
 * tenant + permission, nothing more — so a search row can never surface something those endpoints
 * would not already return. Enforcement of the type list itself lives in
 * `global-search.service.ts`; this file only turns grants into `where` fragments.
 *
 * See `apps/api/src/modules/global-search/search-registry.ts` for the per-type wiring.
 */
import type { ScopeGrant } from '../rbac/permissions.service';

/** The `{ scopeType, scopeId }` shape consumed by the exam-family scope helpers. */
export interface ScopeIdGrant {
  scopeType: string;
  scopeId?: string;
}

/**
 * `PermissionsService` emits grants as `{ scopeType, campusId|departmentId|programId }`, whereas
 * the exam/results/certificates helpers read `{ scopeType, scopeId }`. Map the id explicitly per
 * scope kind so a CAMPUS grant can never be misread as a department id.
 */
export function toScopeIdGrants(grants: ScopeGrant[]): ScopeIdGrant[] {
  return grants.map((grant) => ({
    scopeType: grant.scopeType,
    scopeId:
      grant.scopeType === 'CAMPUS'
        ? grant.campusId
        : grant.scopeType === 'DEPARTMENT'
          ? grant.departmentId
          : grant.scopeType === 'PROGRAM'
            ? grant.programId
            : undefined,
  }));
}

/** A `where` fragment that can only ever match zero rows — the fail-closed scope. */
export const NO_ROWS: Record<string, unknown> = { id: { in: [] } };

/**
 * Several scope helpers treat an empty grant array as "unrestricted" (they behave as if no filter
 * applies), which would leak. `getScopeGrantsFor` returns an empty array when the caller lacks the
 * permission entirely, so callers must gate on this *before* invoking a helper.
 */
export function hasNoGrant(grants: ScopeGrant[] | undefined): boolean {
  return !grants || grants.length === 0;
}

/**
 * Combines the text-match, scope and base (soft-delete / type) fragments under a single `AND`.
 * Spreading them into one object would let a later `OR` overwrite an earlier one.
 */
export function combineSearchWhere(
  ...fragments: Array<Record<string, unknown> | undefined | null>
): Record<string, unknown> {
  const usable = fragments.filter((f): f is Record<string, unknown> => Boolean(f && Object.keys(f).length));
  const [first, ...rest] = usable;
  if (!first) return {};
  if (rest.length === 0) return first;
  return { AND: usable };
}
