import { hostelBookingWhereInput, hostelStudentWhereInput } from './hostel-scope';

describe('hostelStudentWhereInput', () => {
  it('returns undefined for GLOBAL-scope grants (full tenant access)', () => {
    expect(hostelStudentWhereInput([{ scopeType: 'GLOBAL' }], 'actor-1')).toBeUndefined();
    expect(hostelStudentWhereInput([{ scopeType: 'CAMPUS', scopeId: 'c' }, { scopeType: 'GLOBAL' }], 'actor-1')).toBeUndefined();
    expect(hostelStudentWhereInput(undefined, 'actor-1')).toBeUndefined();
  });

  it('returns an impossible filter when grants carry nothing actionable', () => {
    expect(hostelStudentWhereInput([], 'actor-1')).toEqual({ id: { in: [] } });
    expect(hostelStudentWhereInput([{ scopeType: 'CAMPUS', scopeId: undefined }], 'actor-1')).toEqual({ id: { in: [] } });
  });

  it('restricts to the actor for OWN-scope grants', () => {
    expect(hostelStudentWhereInput([{ scopeType: 'OWN' }], 'actor-1')).toEqual({ userId: 'actor-1' });
  });

  it('restricts to granted campus ids for CAMPUS-scope grants', () => {
    const grants = [{ scopeType: 'CAMPUS', scopeId: 'c1' }, { scopeType: 'CAMPUS', scopeId: 'c2' }];
    expect(hostelStudentWhereInput(grants, 'actor-1')).toEqual({ campusId: { in: ['c1', 'c2'] } });
  });

  it('filters students whose program sits under a granted department', () => {
    expect(hostelStudentWhereInput([{ scopeType: 'DEPARTMENT', scopeId: 'd1' }], 'actor-1')).toEqual({
      program: { departmentId: { in: ['d1'] } },
    });
  });

  it('restricts to granted program ids for PROGRAM-scope grants', () => {
    expect(hostelStudentWhereInput([{ scopeType: 'PROGRAM', scopeId: 'p1' }], 'actor-1')).toEqual({ programId: { in: ['p1'] } });
  });

  it('applies the finest granted scope (program beats department beats campus, own beats all)', () => {
    const grants = [
      { scopeType: 'CAMPUS', scopeId: 'c1' },
      { scopeType: 'DEPARTMENT', scopeId: 'd2' },
      { scopeType: 'PROGRAM', scopeId: 'p3' },
    ];
    expect(hostelStudentWhereInput(grants, 'actor-1')).toEqual({ programId: { in: ['p3'] } });
    expect(hostelStudentWhereInput([{ scopeType: 'CAMPUS', scopeId: 'c1' }, { scopeType: 'DEPARTMENT', scopeId: 'd2' }], 'actor-1')).toEqual({
      program: { departmentId: { in: ['d2'] } },
    });
  });

  it('prefers the actor record over hierarchy scopes when OWN is granted', () => {
    const grants = [{ scopeType: 'CAMPUS', scopeId: 'c1' }, { scopeType: 'OWN' }];
    expect(hostelStudentWhereInput(grants, 'actor-1')).toEqual({ userId: 'actor-1' });
  });
});

describe('hostelBookingWhereInput', () => {
  it('returns undefined for unrestricted access', () => {
    expect(hostelBookingWhereInput([{ scopeType: 'GLOBAL' }], 'actor-1')).toBeUndefined();
  });

  it('wraps the student clause so only that student-linked bookings are visible', () => {
    expect(hostelBookingWhereInput([{ scopeType: 'OWN' }], 'actor-1')).toEqual({ student: { userId: 'actor-1' } });
  });
});