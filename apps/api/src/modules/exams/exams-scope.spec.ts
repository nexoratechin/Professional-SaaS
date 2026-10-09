/**
 * exams-scope — pure scope filters for sessions, students, registrations, marks, subjects,
 * seating plans and hall tickets. No DB. Department/program grants resolve UP the org tree exactly
 * as the RBAC scope model specifies.
 */
import {
  examHallTicketScopeFilter,
  examMarksScopeFilter,
  examRegistrationScopeFilter,
  examSeatingPlanScopeFilter,
  examSessionScopeFilter,
  examStudentScopeFilter,
  examStudentWhereInput,
  examSubjectScopeFilter,
} from './exams-scope';

const ACTOR = 'user-1';

describe('examSessionScopeFilter', () => {
  it('is unrestricted for GLOBAL', () => {
    expect(examSessionScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
  });

  it('fails closed when the caller only holds OWN (student) scope', () => {
    expect(examSessionScopeFilter([{ scopeType: 'OWN' }])).toEqual({ id: { in: [] } });
  });

  it('matches a PROGRAM grant directly on programId', () => {
    expect(examSessionScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual({
      programId: { in: ['p1'] },
    });
  });

  it('resolves a DEPARTMENT grant through the program relation', () => {
    expect(examSessionScopeFilter([{ scopeType: 'DEPARTMENT', scopeId: 'd1' }])).toEqual({
      program: { departmentId: { in: ['d1'] } },
    });
  });

  it('resolves a CAMPUS grant through program -> department -> campus', () => {
    expect(examSessionScopeFilter([{ scopeType: 'CAMPUS', scopeId: 'c1' }])).toEqual({
      program: { department: { campusId: { in: ['c1'] } } },
    });
  });

  it('prefers the narrowest grant when several are held', () => {
    const where = examSessionScopeFilter([
      { scopeType: 'CAMPUS', scopeId: 'c1' },
      { scopeType: 'DEPARTMENT', scopeId: 'd1' },
      { scopeType: 'PROGRAM', scopeId: 'p1' },
    ]);
    expect(where).toEqual({ programId: { in: ['p1'] } });
  });
});

describe('examStudentWhereInput', () => {
  it('is unrestricted for GLOBAL', () => {
    expect(examStudentWhereInput([{ scopeType: 'GLOBAL' }])).toBeUndefined();
  });

  it('anchors an OWN grant to the actor user id', () => {
    expect(examStudentWhereInput([{ scopeType: 'OWN' }], ACTOR)).toEqual({ userId: ACTOR });
  });

  it('fails closed for OWN without an actor', () => {
    expect(examStudentWhereInput([{ scopeType: 'OWN' }])).toEqual({ id: { in: [] } });
  });

  it('resolves DEPARTMENT and CAMPUS grants up the org tree', () => {
    expect(examStudentWhereInput([{ scopeType: 'DEPARTMENT', scopeId: 'd1' }])).toEqual({
      program: { departmentId: { in: ['d1'] } },
    });
    expect(examStudentWhereInput([{ scopeType: 'CAMPUS', scopeId: 'c1' }])).toEqual({
      campusId: { in: ['c1'] },
    });
  });
});

describe('derived filters', () => {
  it('examStudentScopeFilter wraps the anchor on the student relation', () => {
    expect(examStudentScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual({
      student: { programId: { in: ['p1'] } },
    });
  });

  it('examRegistrationScopeFilter ORs the session anchor and the student anchor', () => {
    expect(examRegistrationScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual({
      OR: [{ session: { programId: { in: ['p1'] } } }, { student: { programId: { in: ['p1'] } } }],
    });
  });

  it('examMarksScopeFilter nests the registration clause', () => {
    expect(examMarksScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual({
      registration: { OR: [{ session: { programId: { in: ['p1'] } } }, { student: { programId: { in: ['p1'] } } }] },
    });
  });

  it('examSubjectScopeFilter and examSeatingPlanScopeFilter nest the session clause', () => {
    const expected = { session: { programId: { in: ['p1'] } } };
    expect(examSubjectScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual(expected);
    expect(examSeatingPlanScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual(expected);
  });

  it('examHallTicketScopeFilter nests the registration clause', () => {
    expect(examHallTicketScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual({
      registration: { OR: [{ session: { programId: { in: ['p1'] } } }, { student: { programId: { in: ['p1'] } } }] },
    });
  });

  it('returns undefined (unrestricted) for GLOBAL across every derived filter', () => {
    expect(examStudentScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
    expect(examRegistrationScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
    expect(examMarksScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
    expect(examSubjectScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
    expect(examSeatingPlanScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
    expect(examHallTicketScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
  });
});
