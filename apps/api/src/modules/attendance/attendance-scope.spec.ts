/**
 * attendance-scope — pure scope enforcement (no DB). These are the exact clauses the attendance
 * service attaches to session/record queries, so a regression here is a tenant-isolation or
 * authorization regression, not a cosmetic one.
 */
import type { ScopeGrantLike } from '../students/student-scope';
import { attendanceScopeFilter, isOwnOnly } from './attendance-scope';

const ACTOR = 'user-1';

describe('attendanceScopeFilter', () => {
  it('is unrestricted for a GLOBAL grant', () => {
    const result = attendanceScopeFilter([{ scopeType: 'GLOBAL' }], ACTOR, new Set());
    expect(result).toEqual({ where: undefined, own: false });
  });

  it('fails closed (impossible filter) when the caller has no usable grants', () => {
    const result = attendanceScopeFilter([], ACTOR, new Set());
    expect(result.own).toBe(false);
    expect(result.where).toEqual({ id: { in: [] } });
  });

  it('scopes CAMPUS grants through the offering and the section org tree', () => {
    const result = attendanceScopeFilter([{ scopeType: 'CAMPUS', campusId: 'c1' }], ACTOR, new Set(['c1']));
    expect(result.own).toBe(false);
    expect(result.where).toEqual({
      OR: [
        { courseOffering: { campusId: { in: ['c1'] } } },
        { section: { program: { department: { campusId: { in: ['c1'] } } } } },
      ],
    });
  });

  it('restricts an OWN-only faculty/student caller to sessions they are a party to', () => {
    const result = attendanceScopeFilter([{ scopeType: 'OWN' }], ACTOR, new Set());
    expect(result.own).toBe(true);
    expect(result.where).toEqual({
      deletedAt: null,
      OR: [
        { createdBy: ACTOR },
        { markedByUserId: ACTOR },
        { timetableEntry: { assignedUserId: ACTOR } },
        { courseOffering: { faculty: { some: { userId: ACTOR, isActive: true } } } },
        { section: { students: { some: { userId: ACTOR } } } },
        { courseOffering: { registrations: { some: { student: { userId: ACTOR } } } } },
      ],
    });
  });

  it('unions campus-scoped and OWN grants with OR', () => {
    const grants: ScopeGrantLike[] = [{ scopeType: 'CAMPUS', campusId: 'c1' }, { scopeType: 'OWN' }];
    const result = attendanceScopeFilter(grants, ACTOR, new Set(['c1']));
    expect(result.own).toBe(true);
    // Both a campus clause and an own clause are present, combined under a single OR.
    expect(result.where).toEqual({
      OR: [
        {
          OR: [
            { courseOffering: { campusId: { in: ['c1'] } } },
            { section: { program: { department: { campusId: { in: ['c1'] } } } } },
          ],
        },
        {
          deletedAt: null,
          OR: [
            { createdBy: ACTOR },
            { markedByUserId: ACTOR },
            { timetableEntry: { assignedUserId: ACTOR } },
            { courseOffering: { faculty: { some: { userId: ACTOR, isActive: true } } } },
            { section: { students: { some: { userId: ACTOR } } } },
            { courseOffering: { registrations: { some: { student: { userId: ACTOR } } } } },
          ],
        },
      ],
    });
  });
});

describe('isOwnOnly', () => {
  it('is false for no grants (nobody)', () => {
    expect(isOwnOnly([])).toBe(false);
  });

  it('is true only when every grant is OWN', () => {
    expect(isOwnOnly([{ scopeType: 'OWN' }])).toBe(true);
    expect(isOwnOnly([{ scopeType: 'OWN' }, { scopeType: 'OWN' }])).toBe(true);
    expect(isOwnOnly([{ scopeType: 'OWN' }, { scopeType: 'CAMPUS' }])).toBe(false);
    expect(isOwnOnly([{ scopeType: 'GLOBAL' }])).toBe(false);
  });
});
