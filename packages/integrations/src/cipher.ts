/**
 * Cipher for integration credentials stored at rest (payment gateway API keys, accounting client
 * secrets, SMS sender tokens, IdP client secrets, webhook signing secrets).
 *
 * AES-256-GCM, key from env `INTEGRATION_SECRET_KEY` (64 hex chars = 32 bytes) — deliberately a
 * DISTINCT key from MFA, device and notification secrets, following the same rule this repo already
 * applies per credential class: one leaked key must never decrypt another class of secret. A tenant
 * whose payment gateway key leaks must not, by extension, expose every notification SMTP password.
 *
 * Credentials must be RECOVERABLE (the adapter has to send the real API key to the provider), so
 * this is reversible encryption, never a one-way hash — the same trade-off already made by
 * MfaSecretCipher, DeviceSecretCipher and NotificationSecretCipher.
 *
 * Shared as a class rather than duplicated per app because apps/api encrypts on save and apps/worker
 * decrypts at dispatch, and the two must agree byte-for-byte.
 */
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function assertIntegrationSecretKey(secretKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(secretKey)) {
    throw new Error('INTEGRATION_SECRET_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(secretKey, 'hex');
}

export class IntegrationSecretCipher {
  private readonly key: Buffer;

  constructor(secretKey: string) {
    this.key = assertIntegrationSecretKey(secretKey);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
  }

  decrypt(payload: string): string {
    const [ivHex, authTagHex, ciphertextHex] = payload.split(':');
    if (!ivHex || !authTagHex || !ciphertextHex) {
      throw new Error('Malformed encrypted integration credential payload.');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
    return plaintext.toString('utf8');
  }

  /**
   * Encrypts a credential bag as the canonical JSON string stored in `credentialsEncrypted`.
   * Centralised so the exact serialization is identical in the API and the worker.
   */
  encryptBag(credentials: Record<string, unknown>): string {
    return this.encrypt(JSON.stringify(credentials));
  }

  /**
   * Decrypts a stored bag. Returns `{}` for a null/empty column rather than throwing: an
   * integration legitimately has no credentials yet (a DRAFT awaiting secrets, or a `webhook`
   * integration whose only secret is its endpoint's own), and "no credentials" must not be
   * indistinguishable from "corrupt ciphertext".
   */
  decryptBag(payload: string | null | undefined): Record<string, unknown> {
    if (!payload) return {};
    const parsed: unknown = JSON.parse(this.decrypt(payload));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored integration credentials are not a JSON object.');
    }
    return parsed as Record<string, unknown>;
  }

  /** Constant-time comparison for shared secrets that are verified rather than decrypted. */
  matches(payload: string | null | undefined, candidate: string): boolean {
    if (!payload) return false;
    try {
      const expected = Buffer.from(this.decrypt(payload), 'utf8');
      const actual = Buffer.from(candidate, 'utf8');
      if (expected.length !== actual.length) return false;
      // timingSafeEqual throws on a length mismatch, which the check above has already excluded.
      return timingSafeEqual(expected, actual);
    } catch {
      return false;
    }
  }
}
