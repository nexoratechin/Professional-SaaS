/**
 * Shared, framework-agnostic password policy — a pure function so it's testable without
 * NestJS/class-validator, and reusable from anywhere a password is ever set (invite, tenant
 * provisioning, reset-password). Follows NIST SP 800-63B's emphasis on length over forced
 * complexity, plus a small common-password blocklist and a character-class-diversity floor as
 * a pragmatic middle ground for an enterprise-facing product.
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_MIN_CHARACTER_CLASSES = 3;

/** Small, deliberately short blocklist of extremely common passwords/patterns — not a full
 * breached-password-database integration (that needs an external service, out of scope here). */
export const COMMON_WEAK_PASSWORDS: ReadonlySet<string> = new Set(
  [
    'password',
    'password1',
    'password123',
    '12345678',
    '123456789',
    '1234567890',
    'qwerty123',
    'qwertyuiop',
    'letmein123',
    'admin1234',
    'welcome123',
    'iloveyou1',
    'changeme1',
    'abc123456',
  ].map((value) => value.toLowerCase()),
);

export interface PasswordPolicyViolation {
  rule: 'MIN_LENGTH' | 'MAX_LENGTH' | 'CHARACTER_DIVERSITY' | 'COMMON_PASSWORD';
  message: string;
}

function countCharacterClasses(password: string): number {
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/];
  return classes.filter((pattern) => pattern.test(password)).length;
}

/** Returns an empty array when the password satisfies policy, otherwise one entry per
 * violated rule (so callers/tests can assert on which rule failed, not just pass/fail). */
export function validatePasswordStrength(password: string): PasswordPolicyViolation[] {
  const violations: PasswordPolicyViolation[] = [];

  if (password.length < PASSWORD_MIN_LENGTH) {
    violations.push({
      rule: 'MIN_LENGTH',
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
    });
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    violations.push({
      rule: 'MAX_LENGTH',
      message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`,
    });
  }
  if (countCharacterClasses(password) < PASSWORD_MIN_CHARACTER_CLASSES) {
    violations.push({
      rule: 'CHARACTER_DIVERSITY',
      message:
        `Password must contain at least ${PASSWORD_MIN_CHARACTER_CLASSES} of: lowercase, ` +
        'uppercase, digit, special character.',
    });
  }
  if (COMMON_WEAK_PASSWORDS.has(password.toLowerCase())) {
    violations.push({ rule: 'COMMON_PASSWORD', message: 'This password is too common.' });
  }

  return violations;
}

export function isPasswordStrong(password: string): boolean {
  return validatePasswordStrength(password).length === 0;
}
