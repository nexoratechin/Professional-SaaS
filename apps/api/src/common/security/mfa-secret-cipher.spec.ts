import type { AppConfigService } from '../../config/app-config.service';
import { MfaSecretCipher } from './mfa-secret-cipher';

function fakeConfig(key: string): AppConfigService {
  return { get: () => key } as unknown as AppConfigService;
}

describe('MfaSecretCipher', () => {
  const key = '0'.repeat(63) + '1'; // 64 hex chars
  const cipher = new MfaSecretCipher(fakeConfig(key));

  it('round-trips a TOTP secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = cipher.encrypt(secret);
    expect(cipher.decrypt(encrypted)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV) for the same plaintext', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    expect(cipher.encrypt(secret)).not.toBe(cipher.encrypt(secret));
  });

  it('stores iv:authTag:ciphertext as hex, colon-separated', () => {
    const encrypted = cipher.encrypt('JBSWY3DPEHPK3PXP');
    const parts = encrypted.split(':');
    expect(parts).toHaveLength(3);
    for (const part of parts) {
      expect(part).toMatch(/^[0-9a-f]+$/);
    }
  });

  it('throws on a malformed payload rather than silently returning garbage', () => {
    expect(() => cipher.decrypt('not-a-valid-payload')).toThrow();
  });

  it('throws if the auth tag was tampered with (detects ciphertext modification)', () => {
    const encrypted = cipher.encrypt('JBSWY3DPEHPK3PXP');
    const [iv, authTag, ciphertext] = encrypted.split(':');
    const tampered = `${iv}:${authTag}:${(ciphertext ?? '').slice(0, -2)}00`;
    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it('decrypts correctly with a different key instance constructed from the same hex key', () => {
    const otherCipher = new MfaSecretCipher(fakeConfig(key));
    const encrypted = cipher.encrypt('JBSWY3DPEHPK3PXP');
    expect(otherCipher.decrypt(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });
});
