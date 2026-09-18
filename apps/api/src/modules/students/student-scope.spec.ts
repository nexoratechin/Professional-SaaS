import { studentScopeFilter, type ScopeGrantLike } from './student-scope';

describe('studentScopeFilter', () => {
  it('returns undefined for GLOBAL-scope grants (full tenant access)', () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'GLOBAL' }];
    expect(studentScopeFilter(grants, 'actor-1')).toBeUndefined();
    expect(studentScopeFilter([{ scopeType: 'CAMPUS', campusId: 'c' }, { scopeType: 'GLOBAL' }], 'actor-1')).toBeUndefined();
  });

  it('returns an impossible filter when no grants exist', () => {
    expect(studentScopeFilter([], 'actor-1')).toEqual({ id: { in: [] } });
  });

  it('restricts to the actor for OWN-scope grants', () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'OWN' }];
    expect(studentScopeFilter(grants, 'actor-1')).toEqual({ userId: 'actor-1' });
  });

  it('restricts to granted campus ids for CAMPUS-scope grants', () => {
    const grants: ScopeGrantLike[] = [
      { scopeType: 'CAMPUS', campusId: 'c1' },
      { scopeType: 'CAMPUS', campusId: 'c2' },
    ];
    expect(studentScopeFilter(grants, 'actor-1')).toEqual({
      OR: [{ campusId: { in: ['c1'] } }, { campusId: { in: ['c2'] } }],
    });
  });

  it('filters students whose program sits under a granted department', () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'DEPARTMENT', departmentId: 'd1' }];
    expect(studentScopeFilter(grants, 'actor-1')).toEqual({
      program: { departmentId: { in: ['d1'] } },
    });
  });

  it('restricts to granted program ids for PROGRAM-scope grants', () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'PROGRAM', programId: 'p1' }];
    expect(studentScopeFilter(grants, 'actor-1')).toEqual({ programId: { in: ['p1'] } });
  });

  it('unions multiple different scopes into an OR clause', () => {
    const grants: ScopeGrantLike[] = [
      { scopeType: 'OWN' },
      { scopeType: 'CAMPUS', campusId: 'c1' },
      { scopeType: 'DEPARTMENT', departmentId: 'd2' },
      { scopeType: 'PROGRAM', programId: 'p3' },
    ];
    expect(studentScopeFilter(grants, 'actor-1')).toEqual({
      OR: [{ userId: 'actor-1' }, { campusId: { in: ['c1'] } }, { program: { departmentId: { in: ['d2'] } } }, { programId: { in: ['p3'] } }],
    });
  });

  it('drops grants that carry no concrete scope ids (defensive impossible filter)', () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'CAMPUS', campusId: undefined }];
    expect(studentScopeFilter(grants, 'actor-1')).toEqual({ id: { in: [] } });
  });
});