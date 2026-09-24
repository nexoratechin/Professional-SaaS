/**
 * Scope-enforcement helpers for the placements module.
 *
 * Placement rows split into two kinds:
 *  1. Catalog rows (PlacementCompany, PlacementContact, PlacementDrive, PlacementPosition,
 *     PlacementRound) are tenant-wide operational data — they implement no per-user read filter
 *     once the caller holds the placement permission (the actual granting roles today — Principal
 *     PLACEMENTS_VIEW, Placement Officer PLACEMENTS_MANAGE — are all GLOBAL).
 *  2. Student-anchored rows (eligibility, resumes, applications, round results, selections,
 *     offers, joinings, outcomes) are filtered by the caller's grants along the student dimension,
 *     mirroring the students module convention:
 *       GLOBAL     → unrestricted
 *       OWN        → only the caller's own student record (userId = actor)
 *       CAMPUS     → students whose campusId is granted
 *       DEPARTMENT → students whose program.departmentId is granted
 *       PROGRAM    → students whose programId is granted
 *
 * Multiple grants are unioned (OR). A grant set with no usable clauses defensively yields an
 * impossible filter so zero rows leak. The same filter is reused for the student lists an
 * operator may bulk-apply/eligibility-evaluate, so a DEPARTMENT-scoped coordinator can only ever
 * touch their own departments' students.
 */
import { studentScopeFilter, type ScopeGrantLike } from '../students/student-scope';

type Where = Record<string, unknown>;

export { type ScopeGrantLike } from '../students/student-scope';

/** Student-level Prisma `where` for the given grants; `undefined` means GLOBAL (unrestricted).
 * Spread the result into a query's `where` — `...undefined` contributes nothing, so callers can
 * universally write `where: { ...studentWhere, ...filters }`. */
export function placementStudentWhere(grants: ScopeGrantLike[], actorUserId: string): Where | undefined {
  return studentScopeFilter(grants, actorUserId);
}