import { coveredBy } from './report-export.processor';

describe('report export permission revalidation', () => {
  it('never broadens a frozen scope when the current grant is narrower', () => {
    expect(coveredBy([{ scopeType: 'CAMPUS', campusId: 'c1' }], { scopeType: 'CAMPUS', campusId: 'c1' })).toBe(true);
    expect(coveredBy([{ scopeType: 'CAMPUS', campusId: 'c1' }], { scopeType: 'CAMPUS', campusId: 'c2' })).toBe(false);
    expect(coveredBy([{ scopeType: 'DEPARTMENT', departmentId: 'd1' }], { scopeType: 'PROGRAM', programId: 'p1' })).toBe(false);
  });

  it('treats a current global grant as covering any frozen scope', () => {
    expect(coveredBy([{ scopeType: 'GLOBAL' }], { scopeType: 'PROGRAM', programId: 'p1' })).toBe(true);
  });

  it('denies access after a grant is revoked', () => {
    expect(coveredBy([], { scopeType: 'GLOBAL' })).toBe(false);
  });
});
