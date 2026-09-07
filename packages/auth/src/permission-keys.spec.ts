import {
  ACTIONS_IMPLIED_BY_MANAGE,
  DEFAULT_ROLE_DEFINITIONS,
  PERMISSION_ACTIONS,
  PERMISSION_CATALOG,
  PERMISSION_KEYS,
  PERMISSION_SCOPE_TYPES,
  SYSTEM_ROLE_CODES,
} from './permission-keys';

describe('permission catalog integrity', () => {
  it('has no duplicate permission keys', () => {
    const keys = PERMISSION_CATALOG.map((entry) => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('has a catalog entry for every constant in PERMISSION_KEYS', () => {
    const catalogKeys = new Set(PERMISSION_CATALOG.map((entry) => entry.key));
    for (const key of Object.values(PERMISSION_KEYS)) {
      expect(catalogKeys.has(key)).toBe(true);
    }
  });

  it('assigns every catalog entry a valid action', () => {
    const validActions = new Set(Object.values(PERMISSION_ACTIONS));
    for (const entry of PERMISSION_CATALOG) {
      expect(validActions.has(entry.action)).toBe(true);
    }
  });

  it('ACTIONS_IMPLIED_BY_MANAGE is exactly the CRUD actions', () => {
    expect(new Set(ACTIONS_IMPLIED_BY_MANAGE)).toEqual(
      new Set([PERMISSION_ACTIONS.VIEW, PERMISSION_ACTIONS.CREATE, PERMISSION_ACTIONS.UPDATE, PERMISSION_ACTIONS.DELETE]),
    );
    expect(ACTIONS_IMPLIED_BY_MANAGE).not.toContain(PERMISSION_ACTIONS.MANAGE);
  });
});

describe('default role definitions', () => {
  const catalogKeys = new Set(PERMISSION_CATALOG.map((entry) => entry.key));
  const validScopeTypes = new Set(Object.values(PERMISSION_SCOPE_TYPES));

  it('covers exactly the 13 non-admin default roles (TENANT_ADMIN is provisioned separately)', () => {
    expect(DEFAULT_ROLE_DEFINITIONS).toHaveLength(13);
    expect(DEFAULT_ROLE_DEFINITIONS.some((role) => role.code === SYSTEM_ROLE_CODES.TENANT_ADMIN)).toBe(false);
  });

  it('every grant references a real permission key with a valid scope type', () => {
    for (const role of DEFAULT_ROLE_DEFINITIONS) {
      expect(role.grants.length).toBeGreaterThan(0);
      for (const grant of role.grants) {
        expect(catalogKeys.has(grant.key)).toBe(true);
        if (grant.scopeType !== undefined) {
          expect(validScopeTypes.has(grant.scopeType)).toBe(true);
        }
      }
    }
  });

  it('every SYSTEM_ROLE_CODES entry other than TENANT_ADMIN has a matching default role definition', () => {
    const definedCodes = new Set(DEFAULT_ROLE_DEFINITIONS.map((role) => role.code));
    for (const code of Object.values(SYSTEM_ROLE_CODES)) {
      if (code === SYSTEM_ROLE_CODES.TENANT_ADMIN) {
        continue;
      }
      expect(definedCodes.has(code)).toBe(true);
    }
  });

  it('does not define a tenant-scoped role for SaaS Super Admin (that is the platform realm)', () => {
    const codes = Object.values(SYSTEM_ROLE_CODES) as string[];
    expect(codes).not.toContain('SAAS_SUPER_ADMIN');
    expect(codes).not.toContain('SUPER_ADMIN');
  });

  it('scopes Student and Parent roles to OWN only (no broader visibility by default)', () => {
    const student = DEFAULT_ROLE_DEFINITIONS.find((role) => role.code === SYSTEM_ROLE_CODES.STUDENT)!;
    const parent = DEFAULT_ROLE_DEFINITIONS.find((role) => role.code === SYSTEM_ROLE_CODES.PARENT)!;
    for (const grant of [...student.grants, ...parent.grants]) {
      expect(grant.scopeType).toBe(PERMISSION_SCOPE_TYPES.OWN);
    }
  });
});
