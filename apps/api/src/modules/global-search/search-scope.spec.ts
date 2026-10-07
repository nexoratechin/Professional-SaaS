import { combineSearchWhere, hasNoGrant, NO_ROWS, toScopeIdGrants } from './search-scope';
import type { ScopeGrant } from '../rbac/permissions.service';

describe('global-search search-scope', () => {
  describe('toScopeIdGrants', () => {
    it('maps each scope kind to its own id (never crossing campus/department/program)', () => {
      const grants: ScopeGrant[] = [
        { scopeType: 'CAMPUS', campusId: 'campus-1' },
        { scopeType: 'DEPARTMENT', departmentId: 'dept-1' },
        { scopeType: 'PROGRAM', programId: 'program-1' },
        { scopeType: 'GLOBAL' },
        { scopeType: 'OWN' },
      ];

      expect(toScopeIdGrants(grants)).toEqual([
        { scopeType: 'CAMPUS', scopeId: 'campus-1' },
        { scopeType: 'DEPARTMENT', scopeId: 'dept-1' },
        { scopeType: 'PROGRAM', scopeId: 'program-1' },
        { scopeType: 'GLOBAL', scopeId: undefined },
        { scopeType: 'OWN', scopeId: undefined },
      ]);
    });
  });

  describe('hasNoGrant', () => {
    it('treats missing and empty grant arrays as no access', () => {
      expect(hasNoGrant(undefined)).toBe(true);
      expect(hasNoGrant([])).toBe(true);
      expect(hasNoGrant([{ scopeType: 'GLOBAL' }])).toBe(false);
    });
  });

  describe('combineSearchWhere', () => {
    it('returns an empty object when there is nothing to combine', () => {
      expect(combineSearchWhere(undefined, null, {})).toEqual({});
    });

    it('returns the single fragment unchanged', () => {
      const only = { OR: [{ fullName: { contains: 'ravi', mode: 'insensitive' } }] };
      expect(combineSearchWhere(only)).toBe(only);
    });

    it('wraps multiple fragments in AND so a scope OR cannot overwrite the text OR', () => {
      const text = { OR: [{ fullName: { contains: 'ravi' } }] };
      const scope = { OR: [{ campusId: { in: ['c1'] } }] };
      expect(combineSearchWhere(text, scope)).toEqual({ AND: [text, scope] });
    });

    it('includes the fail-closed scope when present', () => {
      expect(combineSearchWhere({ OR: [{ id: { in: ['x'] } }] }, NO_ROWS)).toEqual({
        AND: [{ OR: [{ id: { in: ['x'] } }] }, NO_ROWS],
      });
    });
  });
});
