/**
 * Attendance device secret cipher — AES-256-GCM encryption (key from DEVICE_SECRET_KEY) for
 * device-side secrets stored at rest: the device push token and the vendor communication key.
 *
 * Both must be RECOVERABLE in full (token → HMAC verification of device pushes; comm key →
 * vendor pull adapters), so they are encrypted, never one-way hashed — the same pattern as
 * MfaSecretCipher for TOTP secrets, but on a distinct key so a device-token leak can never
 * decrypt MFA material (and vice versa).
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

@Injectable()
export class DeviceSecretCipher {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    this.key = Buffer.from(config.get('DEVICE_SECRET_KEY'), 'hex');
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
      throw new Error('Malformed attendance device secret payload.');
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertextHex, 'hex')), decipher.final()]);
    return plaintext.toString('utf8');
  }

  matches(payload: string | null | undefined, candidate: string): boolean {
    if (!payload) return false;
    const expected = Buffer.from(this.decrypt(payload), 'utf8');
    const actual = Buffer.from(candidate, 'utf8');
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  }

  /** Verifies an optional HMAC push signature over `timestamp.canonicalBody`. Returns false when
   * either side of the comparison is missing; caller decides primary auth (bearer token). */
  verifyHmacSignature(canonicalBody: string, signature: string, timestamp: string, secret: string): boolean {
    const expected = createHmac('sha256', secret).update(`${timestamp}.${canonicalBody}`, 'utf8').digest('hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    const actualBuf = Buffer.from(signature, 'hex');
    if (expectedBuf.length !== actualBuf.length) return false;
    return timingSafeEqual(expectedBuf, actualBuf);
  }
}