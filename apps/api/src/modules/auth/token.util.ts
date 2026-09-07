import { createHash, randomBytes } from 'crypto';

/** Opaque, high-entropy refresh token value — never a JWT, so there are no claims to leak and
 * it's trivially revocable by deleting/marking its row. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

/** Only this hash is ever persisted — the raw token exists only in the httpOnly cookie. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
