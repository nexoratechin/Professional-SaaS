/**
 * certificate-scope — pure scope filters. Certificates are per-student evidence, so they reuse the
 * exams student anchor and never expose another program's students / another user's records.
 */
import { certificateScopeFilter, certificatesStudentScopeFilter } from './certificate-scope';

const ACTOR = 'user-1';

describe('certificateScopeFilter', () => {
  it('is unrestricted for GLOBAL', () => {
    expect(certificateScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
  });

  it('is unrestricted when no grants are supplied', () => {
    expect(certificateScopeFilter([])).toBeUndefined();
  });

  it('nests the student anchor for a PROGRAM grant', () => {
    expect(certificateScopeFilter([{ scopeType: 'PROGRAM', scopeId: 'p1' }])).toEqual({
      student: { programId: { in: ['p1'] } },
    });
  });

  it('anchors an OWN grant to the actor user id', () => {
    expect(certificateScopeFilter([{ scopeType: 'OWN' }], ACTOR)).toEqual({
      student: { userId: ACTOR },
    });
  });
});

describe('certificatesStudentScopeFilter', () => {
  it('delegates to the exams student anchor', () => {
    expect(certificatesStudentScopeFilter([{ scopeType: 'DEPARTMENT', scopeId: 'd1' }])).toEqual({
      program: { departmentId: { in: ['d1'] } },
    });
    expect(certificatesStudentScopeFilter([{ scopeType: 'GLOBAL' }])).toBeUndefined();
  });
});
