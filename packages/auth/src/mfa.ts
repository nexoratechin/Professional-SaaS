import { randomBytes } from 'crypto';
import { authenticator } from 'otplib';

/**
 * Framework-agnostic TOTP (RFC 6238) + recovery-backup-code primitives — pure functions, same
 * pattern as password-policy.ts, so they're unit-testable without NestJS/Prisma and reusable from
 * both the tenant-user and platform-admin MFA services (apps/api/src/modules/auth).
 *
 * A ±1 step (30s) verification window absorbs ordinary clock drift between server and
 * authenticator app without meaningfully widening the guessable window.
 */
authenticator.options = { window: 1 };

export const MFA_BACKUP_CODE_COUNT = 10;

/** Base32 secret, suitable for both authenticator.keyuri() and direct manual entry. */
export function generateTotpSecret(): string {
  return authenticator.generateSecret();
}

/** otpauth:// URI an authenticator app can import directly (scan or paste). */
export function buildTotpUri(secret: string, accountLabel: string, issuer = 'College ERP SaaS'): string {
  return authenticator.keyuri(accountLabel, issuer, secret);
}

/** False (never throws) for a malformed/expired code — callers only need a yes/no. */
export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.check(code, secret);
  } catch {
    return false;
  }
}

/** `XXXXX-XXXXX` (10 hex chars, high entropy, easy to transcribe) — never user-chosen, so
 * callers hash them the same way as opaque refresh tokens (SHA-256), not bcrypt. */
export function generateBackupCodes(count = MFA_BACKUP_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}
