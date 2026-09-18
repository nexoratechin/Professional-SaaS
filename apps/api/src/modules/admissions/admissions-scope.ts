/**
 * Scope-enforcement helper for the admissions module.
 *
 * Converts the ScopeGrant[] array returned by PermissionsService.getScopeGrantsFor into a
 * Prisma `where` clause restricting AdmissionApplication queries to rows the caller may access.
 * Admissions is staff-facing (future applicants may self-serve, but today nobody logs in as an
 * applicant), so OWN is deliberately not mapped — an admissions operator always acts on behalf of
 * applicants, and the flat structure mirrors the students module:
 *
 *   GLOBAL     → unrestricted
 *   CAMPUS     → restrict to granted campusIds
 *   DEPARTMENT → restrict to applications whose program sits in a granted departmentId
 *   PROGRAM    → restrict to applications on granted programIds
 *
 * Multiple grants are unioned (OR). With no grants at all the permissions guard rejects earlier,
 * but the helper defensively returns an impossible filter (`{ id: { in: [] } }`) so zero rows are
 * returned rather than leaking access.
 */

import type { ScopeGrantLike } from '../students/student-scope';

type WhereClause = Record<string, unknown>;

export function admissionScopeFilter(grants: ScopeGrantLike[]): WhereClause | undefined {
  if (grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;

  const clauses: WhereClause[] = [];

  for (const g of grants) {
    if (g.scopeType === 'CAMPUS' && g.campusId) {
      clauses.push({ campusId: { in: [g.campusId] } });
    }
    if (g.scopeType === 'DEPARTMENT' && g.departmentId) {
      clauses.push({ admissionProgram: { program: { departmentId: { in: [g.departmentId] } } } });
    }
    if (g.scopeType === 'PROGRAM' && g.programId) {
      clauses.push({ admissionProgram: { programId: { in: [g.programId] } } });
    }
  }

  if (clauses.length === 0) return { id: { in: [] } };
  return clauses.length === 1 ? clauses[0] : { OR: clauses };
}