import { scopeFilter, type ScopeGrantLike } from './org-scope';

const noOpDeptToCampus = async () => new Map<string, string | null>();
const noOpProgToAncestors = async () => new Map<string, { departmentId: string | null; campusId: string | null }>();

describe('scopeFilter', () => {
  it('returns undefined for GLOBAL-scope grants (full access)', async () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'GLOBAL' }];
    expect(await scopeFilter({ grants, deptToCampus: noOpDeptToCampus, progToAncestors: noOpProgToAncestors }, 'campus')).toBeUndefined();
    expect(await scopeFilter({ grants, deptToCampus: noOpDeptToCampus, progToAncestors: noOpProgToAncestors }, 'program')).toBeUndefined();
  });

  it('returns an impossible filter when no grants exist', async () => {
    const r = await scopeFilter(
      { grants: [], deptToCampus: noOpDeptToCampus, progToAncestors: noOpProgToAncestors },
      'campus',
    );
    expect(r).toEqual({ id: { in: [] } });
  });

  it('filters campus-level entities by granted campusIds', async () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'CAMPUS', campusId: 'c1' }, { scopeType: 'CAMPUS', campusId: 'c2' }];
    const r = await scopeFilter({ grants, deptToCampus: noOpDeptToCampus, progToAncestors: noOpProgToAncestors }, 'campus');
    expect(r).toEqual({ campusId: { in: ['c1', 'c2'] } });
  });

  it('maps DEPARTMENT-scoped grants up to their campus for campus-level entities', async () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'DEPARTMENT', departmentId: 'd1' }];
    const deptToCampus = async () => new Map([['d1', 'c9']]);
    const r = await scopeFilter({ grants, deptToCampus, progToAncestors: noOpProgToAncestors }, 'campus');
    expect(r).toEqual({ campusId: { in: ['c9'] } });
  });

  it('returns an impossible filter when a DEPARTMENT grant maps to no campus', async () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'DEPARTMENT', departmentId: 'dOrphan' }];
    const deptToCampus = async () => new Map([['dOrphan', null]]);
    const r = await scopeFilter({ grants, deptToCampus, progToAncestors: noOpProgToAncestors }, 'campus');
    expect(r).toEqual({ id: { in: [] } });
  });

  it('filters program-level entities by PROGRAM grants directly and DEPARTMENT/CAMPUS grants via OR', async () => {
    const grants: ScopeGrantLike[] = [
      { scopeType: 'PROGRAM', programId: 'p1' },
      { scopeType: 'DEPARTMENT', departmentId: 'd2' },
      { scopeType: 'CAMPUS', campusId: 'c3' },
    ];
    const deptToCampus = async () => new Map([['d2', 'c2']]);
    const progToAncestors = async () => new Map([['p1', { departmentId: 'd1', campusId: 'c1' }]]);
    const r = await scopeFilter({ grants, deptToCampus, progToAncestors }, 'program');
    expect(r).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { id: { in: ['p1'] } },
          { departmentId: { in: ['d2', 'd1'] } },
          { department: { campusId: { in: ['c3', 'c2', 'c1'] } } },
        ]),
      }),
    );
  });

  it('filters department entities by campus and department OR clauses', async () => {
    const grants: ScopeGrantLike[] = [
      { scopeType: 'DEPARTMENT', departmentId: 'd5' },
      { scopeType: 'PROGRAM', programId: 'p9' },
    ];
    const deptToCampus = async () => new Map([['d5', 'c5']]);
    const progToAncestors = async () => new Map([['p9', { departmentId: 'd9', campusId: 'c9' }]]);
    const r = await scopeFilter({ grants, deptToCampus, progToAncestors }, 'department');
    expect(r).toEqual(
      expect.objectContaining({
        OR: expect.arrayContaining([
          { campusId: { in: ['c5', 'c9'] } },
          { id: { in: ['d5', 'd9'] } },
        ]),
      }),
    );
  });

  it('denies tenant-global entities to non-GLOBAL scopes (see nothing)', async () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'CAMPUS', campusId: 'c1' }];
    const r = await scopeFilter({ grants, deptToCampus: noOpDeptToCampus, progToAncestors: noOpProgToAncestors }, 'global');
    expect(r).toEqual({ id: { in: [] } });
  });
});