/**
 * results-scope — pure scope filters. Result processes are anchored on BOTH the exam session
 * (program scope) and the student (student anchor), unioned with OR so an OWN student can read
 * their own results while a program manager reads the whole program.
 */
import {
  resultsProcessScopeFilter,
  resultsRegistrationScopeFilter,
  resultsSessionScopeFilter,
} from './results-scope';

const ACTOR = 'user-1';

describe('resultsProcessScopeFilter', () => {
  it('is unrestricted for GLOBAL', () => {
    expect(resultsProcessScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
  });

  it('is unrestricted when no grants are supplied', () => {
    expect(resultsProcessScopeFilter([])).toBeUndefined();
  });

  it('ORs the session anchor and the student anchor for a PROGRAM grant', () => {
    expect(resultsProcessScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual({
      OR: [
        { session: { programId: { in: ['p1'] } } },
        { student: { programId: { in: ['p1'] } } },
      ],
    });
  });

  it('anchors an OWN grant to the actor on the student side and to nothing on the session side', () => {
    expect(resultsProcessScopeFilter([{ scopeType: 'OWN' }], ACTOR)).toEqual({
      OR: [{ session: { id: { in: [] } } }, { student: { userId: ACTOR } }],
    });
  });
});

describe('delegated filters', () => {
  it('resultsSessionScopeFilter mirrors the exams session filter', () => {
    expect(resultsSessionScopeFilter([{ scopeType: 'DEPARTMENT', scopeId: 'd1' }])).toEqual({
      program: { departmentId: { in: ['d1'] } },
    });
    expect(resultsSessionScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
  });

  it('resultsRegistrationScopeFilter mirrors the exams registration filter', () => {
    expect(resultsRegistrationScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual({
      OR: [{ session: { programId: { in: ['p1'] } } }, { student: { programId: { in: ['p1'] } } }],
    });
  });
});
