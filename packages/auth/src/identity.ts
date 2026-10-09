/**
 * Framework-agnostic enterprise-identity primitives — pure functions, same pattern as
 * password-policy.ts / mfa.ts, so the SSO claim-mapping rules are unit-testable without
 * NestJS/Prisma and one implementation is shared by the OIDC client and the identity admin API.
 *
 * These deliberately deal only in plain claim maps (already-parsed id_token claims), not in
 * provider config rows: "which roles does this claim snapshot grant?" is a pure question that must
 * not depend on how the token was fetched.
 */

/** Minimal shape of one IdP-group -> local-role mapping, structurally compatible with the
 *  IdentityProviderRoleMapping table row without importing Prisma here. */
export interface IdpRoleMapping {
  claimName: string;
  claimValue: string;
  roleId: string;
}

/** `{ sub, email, email_verified, groups: [...] }` — whatever the id_token carried. */
export type IdpClaims = Record<string, unknown>;

/**
 * The domain part of an email, lowercased, or null if there isn't a usable one. Kept strict (one
 * `@`, non-empty local/domain parts) because this feeds an allow-list check — a malformed address
 * must fail closed, never accidentally match.
 */
export function extractEmailDomain(email: string | null | undefined): string | null {
  if (!email) {
    return null;
  }
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) {
    return null;
  }
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  if (!local || !domain || local.includes('@') || domain.includes('@')) {
    return null;
  }
  return domain;
}

/**
 * Whether an email is allowed through an IdP's domain allow-list. An EMPTY allow-list means "no
 * restriction" (the common case); a non-empty one requires an exact, case-insensitive domain
 * match. An address with no parseable domain is never allowed when a list is configured.
 */
export function isEmailDomainAllowed(
  email: string | null | undefined,
  allowedEmailDomains: readonly string[],
): boolean {
  if (allowedEmailDomains.length === 0) {
    return true;
  }
  const domain = extractEmailDomain(email);
  if (!domain) {
    return false;
  }
  return allowedEmailDomains.some((allowed) => allowed.trim().toLowerCase() === domain);
}

/**
 * Reads the string values out of a claim that may be a single string, an array of strings, or
 * missing/mistyped. Group claims are maddeningly inconsistent between IdPs (and sometimes a
 * space- or comma-delimited single string), so this normalizes all of those to a flat list of
 * non-empty, trimmed values. Everything else is ignored rather than coerced.
 */
export function readClaimValues(claims: IdpClaims | null | undefined, claimName: string): string[] {
  const raw = claims?.[claimName];
  if (raw === undefined || raw === null) {
    return [];
  }
  if (typeof raw === 'string') {
    // Some IdPs emit a single delimited string rather than a JSON array.
    return raw
      .split(/[,\s]+/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }
  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  }
  return [];
}

/**
 * Resolves the set of local role ids an IdP claim snapshot grants: every mapping whose claim
 * value appears in the named claim, matched case-insensitively on the mapping's `claimName`.
 * Multiple matches union (a user in two mapped groups gets both roles). The returned ids are
 * unique and in first-match order, so the result is deterministic for the same claims.
 */
export function resolveMappedRoleIds(
  claims: IdpClaims | null | undefined,
  mappings: readonly IdpRoleMapping[],
): string[] {
  if (mappings.length === 0) {
    return [];
  }
  const claimValuesByGroup = new Map<string, Set<string>>();
  const readGroup = (claimName: string): Set<string> => {
    const key = claimName.toLowerCase();
    let values = claimValuesByGroup.get(key);
    if (!values) {
      values = new Set(readClaimValues(claims, claimName).map((value) => value.toLowerCase()));
      claimValuesByGroup.set(key, values);
    }
    return values;
  };

  const roleIds: string[] = [];
  const seen = new Set<string>();
  for (const mapping of mappings) {
    const granted = readGroup(mapping.claimName).has(mapping.claimValue.trim().toLowerCase());
    if (granted && !seen.has(mapping.roleId)) {
      seen.add(mapping.roleId);
      roleIds.push(mapping.roleId);
    }
  }
  return roleIds;
}

/**
 * Whether an id_token asserted a verified email. Accepts the boolean JSON form and the
 * string forms some IdPs emit (`"true"`); anything else — including a missing claim — is false,
 * which is the safe default for a check that guards account linking.
 */
export function isClaimEmailVerified(claims: IdpClaims | null | undefined): boolean {
  const raw = claims?.['email_verified'];
  if (raw === true) {
    return true;
  }
  return typeof raw === 'string' && raw.trim().toLowerCase() === 'true';
}
