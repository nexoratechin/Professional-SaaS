/**
 * Scope-enforcement helper for the organization module.
 *
 * Takes the ScopeGrant[] array returned by PermissionsService.getScopeGrantsFor and
 * converts it to a Prisma `where` clause that restricts queries to only rows the user is
 * authorized to access.  The scope hierarchy is:
 *
 *   GLOBAL  →  unrestricted
 *   CAMPUS  →  restrict to granted campusIds
 *   DEPARTMENT  →  restrict to granted departmentIds (mapped up to campusId for campus-level entities)
 *   PROGRAM  →  restrict to granted programIds (mapped up to departmentId/campusId)
 *
 * If the user holds NO grants at all for the requested permission the service should reject
 * the request before reaching here, but the helper defensively returns an impossible filter
 * (`{ id: { in: [] } }`) so zero rows are returned rather than leaking access.
 */

export interface ScopeGrantLike {
  scopeType: string;
  campusId?: string;
  departmentId?: string;
  programId?: string;
}

export interface ScopeResolverInput {
  grants: ScopeGrantLike[];
  deptToCampus: (ids: string[]) => Promise<Map<string, string | null>>;
  progToAncestors: (ids: string[]) => Promise<Map<string, { departmentId: string | null; campusId: string | null }>>;
}

type WhereClause = Record<string, unknown>;

/**
 * Returns a Prisma `where` filter scoped to the user's grants, for an entity anchored at the
 * given `level` in the campus hierarchy.
 *
 * @param level  'campus'  → filter on campusId (Campus, Building, Room, Department)
 *               'department' → filter on departmentId or campus-via-department (Program)
 *               'program' → filter on programId, departmentId, or campus-via-department
 *               'global'  → no filter needed (AcademicYear, Term are tenant-global)
 */
export async function scopeFilter(
  input: ScopeResolverInput,
  level: 'campus' | 'department' | 'program' | 'global',
): Promise<WhereClause | undefined> {
  const { grants, deptToCampus, progToAncestors } = input;

  if (grants.some((g) => g.scopeType === 'GLOBAL')) return undefined;

  const campusIds = new Set<string>();
  const deptIds = new Set<string>();
  const progIds = new Set<string>();

  for (const g of grants) {
    if (g.scopeType === 'CAMPUS' && g.campusId) campusIds.add(g.campusId);
    if (g.scopeType === 'DEPARTMENT' && g.departmentId) deptIds.add(g.departmentId);
    if (g.scopeType === 'PROGRAM' && g.programId) progIds.add(g.programId);
  }

  // Map up: dept → campus, program → dept + campus (so campus-level filtering sees the
  // campuses that a deeper-scope grant lives under).
  const effectiveCampusIds = new Set(campusIds);
  if (deptIds.size > 0) {
    const map = await deptToCampus([...deptIds]);
    for (const cid of map.values()) {
      if (cid) effectiveCampusIds.add(cid);
    }
  }
  if (progIds.size > 0) {
    const map = await progToAncestors([...progIds]);
    for (const { departmentId, campusId } of map.values()) {
      if (campusId) effectiveCampusIds.add(campusId);
      if (departmentId) deptIds.add(departmentId);
    }
  }

  if (level === 'global') {
    // AcademicYear/Term are tenant-global entities. Non-GLOBAL scopes are intentionally not
    // granted them — anything other than GLOBAL sees nothing here.
    return { id: { in: [] } };
  }

  if (level === 'campus') {
    if (effectiveCampusIds.size === 0) return { id: { in: [] } };
    return { campusId: { in: [...effectiveCampusIds] } };
  }

  if (level === 'department') {
    const clauses: WhereClause[] = [];
    if (effectiveCampusIds.size > 0) clauses.push({ campusId: { in: [...effectiveCampusIds] } });
    if (deptIds.size > 0) clauses.push({ id: { in: [...deptIds] } });
    return clauses.length === 0 ? { id: { in: [] } } : { OR: clauses };
  }

  // level === 'program'
  const clauses: WhereClause[] = [];
  if (progIds.size > 0) clauses.push({ id: { in: [...progIds] } });
  if (deptIds.size > 0) clauses.push({ departmentId: { in: [...deptIds] } });
  if (effectiveCampusIds.size > 0) {
    clauses.push({ department: { campusId: { in: [...effectiveCampusIds] } } });
  }
  return clauses.length === 0 ? { id: { in: [] } } : { OR: clauses };
}