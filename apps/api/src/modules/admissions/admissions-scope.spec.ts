import { admissionScopeFilter } from './admissions-scope';

describe('admissionScopeFilter', () => {
  it('returns undefined for GLOBAL grants (full tenant access)', () => {
    expect(admissionScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
    expect(admissionScopeFilter([{ scopeType: 'CAMPUS', campusId: 'c' }, { scopeType: 'GLOBAL' }])).toBeUndefined();
  });

  it('returns an impossible filter when no grants exist', () => {
    expect(admissionScopeFilter([])).toEqual({ id: { in: [] } });
  });

  it('restricts to granted campus ids for CAMPUS grants', () => {
    const grants = [
      { scopeType: 'CAMPUS', campusId: 'c1' },
      { scopeType: 'CAMPUS', campusId: 'c2' },
    ];
    expect(admissionScopeFilter(grants)).toEqual({
      OR: [{ campusId: { in: ['c1'] } }, { campusId: { in: ['c2'] } }],
    });
  });

  it('filters applications whose program sits under a granted department', () => {
    expect(admissionScopeFilter([{ scopeType: 'DEPARTMENT', departmentId: 'd1' }])).toEqual({
      admissionProgram: { program: { departmentId: { in: ['d1'] } } },
    });
  });

  it('restricts to granted program ids for PROGRAM grants', () => {
    expect(admissionScopeFilter([{ scopeType: 'PROGRAM', programId: 'p1' }])).toEqual({
      admissionProgram: { programId: { in: ['p1'] } },
    });
  });

  it('unions multiple different scopes into an OR clause', () => {
    const grants = [
      { scopeType: 'CAMPUS', campusId: 'c1' },
      { scopeType: 'DEPARTMENT', departmentId: 'd2' },
      { scopeType: 'PROGRAM', programId: 'p3' },
    ];
    expect(admissionScopeFilter(grants)).toEqual({
      OR: [
        { campusId: { in: ['c1'] } },
        { admissionProgram: { program: { departmentId: { in: ['d2'] } } } },
        { admissionProgram: { programId: { in: ['p3'] } } },
      ],
    });
  });

  it('drops grants that carry no concrete scope ids (defensive impossible filter)', () => {
    expect(admissionScopeFilter([{ scopeType: 'CAMPUS' }])).toEqual({ id: { in: [] } });
  });

  it('ignores OWN grants (admissions is staff-facing; no self-service applicant rows)', () => {
    expect(admissionScopeFilter([{ scopeType: 'OWN' }])).toEqual({ id: { in: [] } });
  });
});