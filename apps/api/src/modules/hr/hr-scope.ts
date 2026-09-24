/**
 * Scope-enforcement helpers for the HR module.
 *
 * Takes the ScopeGrant[] returned by PermissionsService.getScopeGrantsFor plus the caller-resolved
 * id sets and converts them into a Prisma `where` clause fragment restricting Employee queries (and,
 * via the `employee:` relation, leave/payroll/workload/review rows that anchor on an employee) to
 * rows the caller may access. Employee rows carry every relevant dimension directly, so the filter
 * is flat:
 *
 *   GLOBAL     → unrestricted
 *   CAMPUS     → capusId in granted campus ids
 *   DEPARTMENT → departmentId in granted department ids
 *   PROGRAM    → resolved UP to its department in the service (mirroring the org convention) and
 *                applied as a departmentId filter
 *   OWN        → only { userId = actor } (self-service: a faculty member's own HR record)
 *
 * Multiple grants are unioned (OR). With no usable grants the helper defensively returns an
 * impossible filter so zero rows leak. PROGRAM grants carry a programId which an Employee row does
 * not have, so the service resolves each granted program up to its department before calling in.
 */

import type { ScopeGrantLike } from '../students/student-scope';

type WhereClause = Record<string, unknown>;

export interface HrScopeOptions {
  grants: ScopeGrantLike[];
  actorUserId: string;
  /** Granted campus ids (CAMPUS-scope grants). */
  campusIds: Set<string>;
  /** Granted + program-resolved department ids (DEPARTMENT + PROGRAM-scope grants). */
  departmentIds: Set<string>;
}

export interface HrScopeResult {
  /** Employee-level where clause; `undefined` means unrestricted (GLOBAL). */
  employeeWhere: WhereClause | undefined;
  /** Own-scope result (all amended if every grant was OWN). */
  own: boolean;
}

export function hrEmployeeScopeFilter(options: HrScopeOptions): HrScopeResult {
  const { grants, actorUserId, campusIds, departmentIds } = options;

  if (grants.some((g) => g.scopeType === 'GLOBAL')) return { employeeWhere: undefined, own: false };

  const clauses: WhereClause[] = [];
  let hasOwn = false;

  for (const g of grants) {
    if (g.scopeType === 'OWN') hasOwn = true;
  }

  if (campusIds.size > 0) {
    clauses.push({ campusId: { in: [...campusIds] } });
  }

  if (departmentIds.size > 0) {
    clauses.push({ departmentId: { in: [...departmentIds] } });
  }

  if (hasOwn) {
    clauses.push({ deletedAt: null, userId: actorUserId });
  }

  if (clauses.length === 0) return { employeeWhere: { id: { in: [] } }, own: hasOwn };
  if (clauses.length === 1) return { employeeWhere: clauses[0], own: hasOwn };
  return { employeeWhere: { OR: clauses }, own: hasOwn };
}

/** True when the caller's grants are exclusively OWN-scope (faculty/staff self-service). */
export function isOwnOnly(grants: ScopeGrantLike[]): boolean {
  if (grants.length === 0) return false;
  return grants.every((g) => g.scopeType === 'OWN');
}