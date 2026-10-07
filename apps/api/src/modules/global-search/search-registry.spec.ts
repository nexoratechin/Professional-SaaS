import { PERMISSION_KEYS } from '@college-erp/auth';
import { GLOBAL_SEARCH_ENTITY_TYPES } from '@college-erp/types';
import { buildSearchRegistry } from './search-registry';

const PERMISSION_VALUES = new Set(Object.values(PERMISSION_KEYS));

describe('global-search search-registry', () => {
  const registry = buildSearchRegistry();

  it('covers every declared entity type exactly once', () => {
    const types = registry.map((descriptor) => descriptor.type).sort();
    expect(types).toEqual([...GLOBAL_SEARCH_ENTITY_TYPES].sort());
    expect(new Set(types).size).toBe(types.length);
  });

  it('gates every family behind a real permission key from the catalog', () => {
    for (const descriptor of registry) {
      expect(PERMISSION_VALUES.has(descriptor.permission)).toBe(true);
      expect(descriptor.label.length).toBeGreaterThan(0);
    }
  });

  it('builds an OR-of-contains text filter for every family', () => {
    for (const descriptor of registry) {
      const where = descriptor.textWhere('smith');
      expect(Array.isArray(where.OR)).toBe(true);
      expect(where.OR.length).toBeGreaterThan(0);
      for (const clause of where.OR) {
        const value = Object.values(clause)[0] as { contains: string; mode: string };
        expect(value.contains).toBe('smith');
        expect(value.mode).toBe('insensitive');
      }
    }
  });

  it('maps an empty row without throwing and tags it with its own type and an in-app href', () => {
    for (const descriptor of registry) {
      const item = descriptor.map({}, 'smith');
      expect(item.type).toBe(descriptor.type);
      expect(item.href.startsWith('/')).toBe(true);
      expect(typeof item.score).toBe('number');
    }
  });
});
