/**
 * Scope-enforcement helper for the attendance module.
 *
 * Converts the ScopeGrant[] array returned by PermissionsService.getScopeGrantsFor into a
 * Prisma `where` clause fragment restricting attendance session queries to rows the caller may
 * access. Attendance sessions anchor on the org tree through courseOffering.campusId and
 * section.program.department.campusId, plus self-service (OWN) links:
 *
 *   GLOBAL     → unrestricted
 *   CAMPUS     → sessions whose offering/section resolves to a granted campus
 *   DEPARTMENT → resolved UP to its campus (the org-module convention) before filtering
 *   PROGRAM    → resolved UP to its campus before filtering
 *   OWN        → sessions the actor is part of: a faculty member's own marks/assignments and
 *                the sessions of the sections/offerings their students sit in
 *
 * Department/program grants are resolved UP to campus ids in the service (mirroring the
 * timetable module) and passed in as `campusIds`. Multiple grants are unioned (OR). With no
 * usable grants the helper defensively returns an impossible filter so zero rows leak.
 */

import type { ScopeGrantLike } from '../students/student-scope';

type WhereClause = Record<string, unknown>;

export interface AttendanceScopeResult {
  /** Session-level where clause; `undefined` means unrestricted (GLOBAL). */
  where: WhereClause | undefined;
  /** True when the caller only holds OWN-scope grants for the permission. */
  own: boolean;
}

export function attendanceScopeFilter(
  grants: ScopeGrantLike[],
  actorUserId: string,
  campusIds: Set<string>,
): AttendanceScopeResult {
  if (grants.some((g) => g.scopeType === 'GLOBAL')) return { where: undefined, own: false };

  const clauses: WhereClause[] = [];
  let hasOwn = false;

  for (const g of grants) {
    if (g.scopeType === 'OWN') hasOwn = true;
  }

  if (campusIds.size > 0) {
    const ids = [...campusIds];
    clauses.push({
      OR: [
        { courseOffering: { campusId: { in: ids } } },
        { section: { program: { department: { campusId: { in: ids } } } } },
      ],
    });
  }

  if (hasOwn) {
    clauses.push({
      deletedAt: null,
      OR: [
        { createdBy: actorUserId },
        { markedByUserId: actorUserId },
        { timetableEntry: { assignedUserId: actorUserId } },
        { courseOffering: { faculty: { some: { userId: actorUserId, isActive: true } } } },
        { section: { students: { some: { userId: actorUserId } } } },
        { courseOffering: { registrations: { some: { student: { userId: actorUserId } } } } },
      ],
    });
  }

  if (clauses.length === 0) return { where: { id: { in: [] } }, own: hasOwn };
  if (clauses.length === 1) return { where: clauses[0], own: hasOwn };
  return { where: { OR: clauses }, own: hasOwn };
}

/** True when every grant on a permission is OWN-scope (faculty/student self-service). */
export function isOwnOnly(grants: ScopeGrantLike[]): boolean {
  if (grants.length === 0) return false;
  return grants.every((g) => g.scopeType === 'OWN');
}