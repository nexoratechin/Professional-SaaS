import { AUDIT_ACTIONS, AUDIT_MODULES } from './audit-keys';

describe('audit taxonomy integrity', () => {
  it('has no duplicate module values', () => {
    const values = Object.values(AUDIT_MODULES);
    expect(new Set(values).size).toBe(values.length);
  });

  it('has no duplicate action values', () => {
    const values = Object.values(AUDIT_ACTIONS);
    expect(new Set(values).size).toBe(values.length);
  });

  it('every module value is a lowercase, non-empty string', () => {
    for (const value of Object.values(AUDIT_MODULES)) {
      expect(value).toMatch(/^[a-z_]+$/);
    }
  });

  it('every action value is an upper-snake-case, non-empty string', () => {
    for (const value of Object.values(AUDIT_ACTIONS)) {
      expect(value).toMatch(/^[A-Z_]+$/);
    }
  });

  it('reserves a module tag for every module in the permission/feature catalogs', () => {
    const reserved = [
      'students',
      'academics',
      'timetable',
      'attendance',
      'admissions',
      'fees',
      'payments',
      'exams',
      'results',
      'certificates',
      'library',
      'hostel',
      'transport',
      'hr',
      'placements',
      'inventory',
      'reports',
      'integrations',
    ];
    const moduleValues = new Set(Object.values(AUDIT_MODULES) as string[]);
    for (const module of reserved) {
      expect(moduleValues.has(module)).toBe(true);
    }
  });
});
