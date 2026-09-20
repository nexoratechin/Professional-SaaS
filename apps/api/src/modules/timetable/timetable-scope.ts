/**
 * Scope-enforcement helper for the timetable module.
 *
 * Converts the ScopeGrant[] array returned by PermissionsService.getScopeGrantsFor into a
 * Prisma `where` clause fragment restricting timetable queries to rows the caller may access.
 * The timetable domain anchors on the campus/term for the weekly grid plus the actor
 * self-service (OWN) link on entries:
 *
 *   GLOBAL     → unrestricted
 *   CAMPUS     → only timetables for the granted campus
 *   DEPARTMENT → the campus the granted department sits under
 *   PROGRAM    → the campus of the granted program's department
 *   OWN        → only PUBLISHED timetables the actor is a part of (assigned faculty on an
 *                entry, or a student whose section has an entry); entry-level lists apply
 *                the narrower per-entry OWN filter
 *
 * Department/program grants are resolved UP to campus ids first (the org module convention);
 * the service resolves those ids via a DB query and passes them in as `campusIds`. Multiple
 * grants are unioned (OR). With no usable grants at all the helper defensively returns an
 * impossible filter (`{ id: { in: [] } }`) so zero rows are returned rather than leaking
 * access.
 */

import type { ScopeGrantLike } from '../students/student-scope';

type WhereClause = Record<string, unknown>;

export interface TimetableScopeResult {
  /** Timetable-level where clause; `undefined` means unrestricted (GLOBAL). */
  where: WhereClause | undefined;
  /** True when the caller only has OWN-scope grants for timetable.view (faculty/student). */
  own: boolean;
}

export function timetableScopeFilter(
  grants: ScopeGrantLike[],
  actorUserId: string,
  campusIds: Set<string>,
): TimetableScopeResult {
  if (grants.some((g) => g.scopeType === 'GLOBAL')) return { where: undefined, own: false };

  const clauses: WhereClause[] = [];
  let hasOwn = false;

  for (const g of grants) {
    if (g.scopeType === 'OWN') hasOwn = true;
  }

  if (campusIds.size > 0) clauses.push({ campusId: { in: [...campusIds] } });

  if (hasOwn) {
    clauses.push({
      status: 'PUBLISHED',
      entries: {
        some: {
          OR: [
            { assignedUserId: actorUserId },
            { section: { students: { some: { userId: actorUserId } } } },
          ],
        },
      },
    });
  }

  if (clauses.length === 0) return { where: { id: { in: [] } }, own: hasOwn };
  if (clauses.length === 1) return { where: clauses[0], own: hasOwn };
  return { where: { OR: clauses }, own: hasOwn };
}

/** Per-entry OWN filter used when the caller has no broader scope (see owner of factory). */
export function ownEntryFilter(actorUserId: string): WhereClause {
  return {
    OR: [
      { assignedUserId: actorUserId },
      { section: { students: { some: { userId: actorUserId } } } },
    ],
  };
}

/** True when the caller should see/own availability & substitution rows as themselves only. */
export function isOwnOnly(grants: ScopeGrantLike[]): boolean {
  if (grants.length === 0) return false;
  return grants.every((g) => g.scopeType === 'OWN');
}