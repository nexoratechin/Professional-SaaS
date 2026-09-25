/**
 * Cipher for notification provider credentials stored at rest (SMTP password, SMS/push gateway
 * API keys, …). AES-256-GCM, key from env `NOTIFICATION_SECRET_KEY` (64 hex chars = 32 bytes) —
 * a distinct key from MFA/device secrets so one leaked credential class can never decrypt another.
 *
 * Credentials must be RECOVERABLE (the worker needs the raw SMTP password / API key to send), so
 * this is reversible encryption, never a one-way hash — the same pattern as MfaSecretCipher and
 * DeviceSecretCipher, shared here because both apps/api (encrypt on save) and apps/worker
 * (decrypt on delivery) need it.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function assertNotificationSecretKey(secretKey: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(secretKey)) {
    throw new Error('NOTIFICATION_SECRET_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(secretKey, 'hex');
}

export class NotificationSecretCipher {
  private readonly key: Buffer;

  constructor(secretKey: string) {
    this.key = assertNotificationSecretKey(secretKey);
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
      throw new Error('Malformed encrypted notification provider credentials payload.');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
    return plaintext.toString('utf8');
  }
}