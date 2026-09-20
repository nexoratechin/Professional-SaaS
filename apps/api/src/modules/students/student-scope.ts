/**
 * Scope-enforcement helper for the students module.
 *
 * Takes the ScopeGrant[] array returned by PermissionsService.getScopeGrantsFor and converts
 * it to a Prisma `where` clause that restricts student queries to only rows the user is
 * authorized to access. Unlike the organization module's hierarchy (which maps scopes UP the
 * campus → department → program tree), a Student row already carries every dimension directly
 * (campusId, programId, and — for the OWN scope — userId), so the filter is flatter:
 *
 *   GLOBAL     → unrestricted
 *   OWN        → only { userId = actor } (the student self-serving their own record)
 *   CAMPUS     → restrict to granted campusIds
 *   DEPARTMENT → restrict to students whose program sits in a granted departmentId
 *   PROGRAM    → restrict to granted programIds
 *
 * Multiple grants are unioned (OR). If the user holds NO grants at all the service should
 * reject before reaching here, but the helper defensively returns an impossible filter
 * (`{ id: { in: [] } }`) so zero rows are returned rather than leaking access.
 */

export interface ScopeGrantLike {
  scopeType: string;
  campusId?: string;
  departmentId?: string;
  programId?: string;
}

type WhereClause = Record<string, unknown>;

export function studentScopeFilter(
  grants: ScopeGrantLike[],
  actorUserId: string,
): WhereClause | undefined {
  if (grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;

  const clauses: WhereClause[] = [];

  for (const g of grants) {
    if (g.scopeType === 'OWN') {
      clauses.push({ userId: actorUserId });
    }
    if (g.scopeType === 'CAMPUS' && g.campusId) {
      clauses.push({ campusId: { in: [g.campusId] } });
    }
    if (g.scopeType === 'DEPARTMENT' && g.departmentId) {
      clauses.push({ program: { departmentId: { in: [g.departmentId] } } });
    }
    if (g.scopeType === 'PROGRAM' && g.programId) {
      clauses.push({ programId: { in: [g.programId] } });
    }
  }

  if (clauses.length === 0) return { id: { in: [] } };
  return clauses.length === 1 ? clauses[0] : { OR: clauses };
}