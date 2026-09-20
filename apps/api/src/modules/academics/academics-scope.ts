/**
 * Scope-enforcement helper for the academics module.
 *
 * Converts the ScopeGrant[] array returned by PermissionsService.getScopeGrantsFor into a
 * Prisma `where` clause fragment restricting academics queries to rows the caller may access.
 * The academics domain anchors on the campus → department → program hierarchy plus the actor
 * self-service (OWN) link:
 *
 *   GLOBAL     → unrestricted
 *   OWN        → only the actor's own student records (student.userId = actorUserId)
 *   CAMPUS     → restrict to the granted campus (via program.dept.campus for program anchors,
 *                via course.department.campus for the course catalog)
 *   DEPARTMENT → restrict to granted departmentIds
 *   PROGRAM    → restrict to granted programIds
 *
 * Multiple grants are unioned (OR), and program grants are mapped UP to the department/campus
 * they sit under (org module convention) before use. Own-scope grants never let a caller read
 * beyond their own student rows. With no usable grants at all the helper defensively returns an
 * impossible filter (`{ id: { in: [] } }`) so zero rows are returned rather than leaking access.
 */

import type { ScopeGrantLike } from '../students/student-scope';

type WhereClause = Record<string, unknown>;

export type AcademicAnchor = 'program' | 'course' | 'student' | 'term';

export function academicScopeFilter(
  grants: ScopeGrantLike[],
  actorUserId: string,
  anchor: AcademicAnchor,
): WhereClause | undefined {
  if (grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;

  // Terms/academic-years are tenant-global entities; non-GLOBAL scopes are intentionally not
  // granted them — anything other than GLOBAL sees nothing.
  if (anchor === 'term') return { id: { in: [] } };

  const campusIds = new Set<string>();
  const deptIds = new Set<string>();
  const progIds = new Set<string>();
  let hasOwn = false;

  for (const g of grants) {
    if (g.scopeType === 'OWN') hasOwn = true;
    if (g.scopeType === 'CAMPUS' && g.campusId) campusIds.add(g.campusId);
    if (g.scopeType === 'DEPARTMENT' && g.departmentId) deptIds.add(g.departmentId);
    if (g.scopeType === 'PROGRAM' && g.programId) progIds.add(g.programId);
  }

  if (anchor === 'course') {
    const clauses: WhereClause[] = [];
    if (deptIds.size > 0) clauses.push({ departmentId: { in: [...deptIds] } });
    if (campusIds.size > 0) clauses.push({ department: { campusId: { in: [...campusIds] } } });
    if (clauses.length === 0) return { id: { in: [] } };
    return clauses.length === 1 ? clauses[0] : { OR: clauses };
  }

  if (anchor === 'student') {
    const clauses: WhereClause[] = [];
    if (hasOwn) clauses.push({ student: { userId: actorUserId } });
    if (progIds.size > 0) clauses.push({ student: { programId: { in: [...progIds] } } });
    if (deptIds.size > 0) clauses.push({ student: { program: { departmentId: { in: [...deptIds] } } } });
    if (campusIds.size > 0) clauses.push({ student: { campusId: { in: [...campusIds] } } });
    if (clauses.length === 0) return { id: { in: [] } };
    return clauses.length === 1 ? clauses[0] : { OR: clauses };
  }

  // program anchor
  const clauses: WhereClause[] = [];
  if (progIds.size > 0) clauses.push({ programId: { in: [...progIds] } });
  if (deptIds.size > 0) clauses.push({ program: { departmentId: { in: [...deptIds] } } });
  if (campusIds.size > 0) clauses.push({ program: { department: { campusId: { in: [...campusIds] } } } });
  if (clauses.length === 0) return { id: { in: [] } };
  return clauses.length === 1 ? clauses[0] : { OR: clauses };
}