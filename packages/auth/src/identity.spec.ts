import {
  extractEmailDomain,
  isClaimEmailVerified,
  isEmailDomainAllowed,
  readClaimValues,
  resolveMappedRoleIds,
  type IdpRoleMapping,
} from './identity';

describe('extractEmailDomain', () => {
  it('returns the lowercased domain of a normal address', () => {
    expect(extractEmailDomain('Alice@Example.EDU')).toBe('example.edu');
  });

  it('rejects missing, malformed, or multi-@ addresses', () => {
    expect(extractEmailDomain(null)).toBeNull();
    expect(extractEmailDomain('')).toBeNull();
    expect(extractEmailDomain('no-at-sign')).toBeNull();
    expect(extractEmailDomain('@example.edu')).toBeNull();
    expect(extractEmailDomain('alice@')).toBeNull();
    expect(extractEmailDomain('a@b@example.edu')).toBeNull();
  });
});

describe('isEmailDomainAllowed', () => {
  it('allows everything when the allow-list is empty', () => {
    expect(isEmailDomainAllowed('alice@anywhere.test', [])).toBe(true);
    expect(isEmailDomainAllowed(null, [])).toBe(true);
  });

  it('matches configured domains case-insensitively', () => {
    expect(isEmailDomainAllowed('alice@Example.EDU', ['example.edu'])).toBe(true);
    expect(isEmailDomainAllowed('alice@example.edu', ['  EXAMPLE.EDU  '])).toBe(true);
  });

  it('rejects addresses outside the list, including unparseable ones', () => {
    expect(isEmailDomainAllowed('alice@other.test', ['example.edu'])).toBe(false);
    expect(isEmailDomainAllowed('not-an-email', ['example.edu'])).toBe(false);
    expect(isEmailDomainAllowed(null, ['example.edu'])).toBe(false);
  });
});

describe('readClaimValues', () => {
  it('reads a string array claim', () => {
    expect(readClaimValues({ groups: ['faculty', 'registrar'] }, 'groups')).toEqual([
      'faculty',
      'registrar',
    ]);
  });

  it('splits a single delimited string claim', () => {
    expect(readClaimValues({ groups: 'faculty, registrar  staff' }, 'groups')).toEqual([
      'faculty',
      'registrar',
      'staff',
    ]);
  });

  it('drops non-string entries, blanks, and missing claims', () => {
    expect(readClaimValues({ groups: ['faculty', 42, '', '  '] }, 'groups')).toEqual(['faculty']);
    expect(readClaimValues({}, 'groups')).toEqual([]);
    expect(readClaimValues(null, 'groups')).toEqual([]);
  });
});

describe('resolveMappedRoleIds', () => {
  const mappings: IdpRoleMapping[] = [
    { claimName: 'groups', claimValue: 'faculty', roleId: 'role-faculty' },
    { claimName: 'groups', claimValue: 'REGISTRAR', roleId: 'role-registrar' },
    { claimName: 'roles', claimValue: 'admin', roleId: 'role-admin' },
  ];

  it('grants every matching mapping, case-insensitively', () => {
    expect(
      resolveMappedRoleIds({ groups: ['Faculty', 'registrar'], roles: ['admin'] }, mappings),
    ).toEqual(['role-faculty', 'role-registrar', 'role-admin']);
  });

  it('returns nothing when no claim matches', () => {
    expect(resolveMappedRoleIds({ groups: ['students'] }, mappings)).toEqual([]);
    expect(resolveMappedRoleIds(null, mappings)).toEqual([]);
  });

  it('does not duplicate a role matched by more than one mapping', () => {
    const dupes: IdpRoleMapping[] = [
      { claimName: 'groups', claimValue: 'faculty', roleId: 'role-shared' },
      { claimName: 'roles', claimValue: 'faculty', roleId: 'role-shared' },
    ];
    expect(resolveMappedRoleIds({ groups: ['faculty'], roles: ['faculty'] }, dupes)).toEqual([
      'role-shared',
    ]);
  });

  it('returns nothing when there are no mappings', () => {
    expect(resolveMappedRoleIds({ groups: ['faculty'] }, [])).toEqual([]);
  });
});

describe('isClaimEmailVerified', () => {
  it('accepts boolean true and the string "true"', () => {
    expect(isClaimEmailVerified({ email_verified: true })).toBe(true);
    expect(isClaimEmailVerified({ email_verified: 'TRUE' })).toBe(true);
  });

  it('rejects false, missing, and other values', () => {
    expect(isClaimEmailVerified({ email_verified: false })).toBe(false);
    expect(isClaimEmailVerified({ email_verified: 'false' })).toBe(false);
    expect(isClaimEmailVerified({})).toBe(false);
    expect(isClaimEmailVerified(null)).toBe(false);
  });
});
