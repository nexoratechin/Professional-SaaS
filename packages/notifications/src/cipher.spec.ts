import { NotificationSecretCipher, assertNotificationSecretKey } from './cipher';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('NotificationSecretCipher', () => {
  it('round-trips secrets and produces unique ciphertexts', () => {
    const cipher = new NotificationSecretCipher(KEY);
    const first = cipher.encrypt('smtp-password-123');
    const second = cipher.encrypt('smtp-password-123');
    expect(first).not.toBe(second);
    expect(cipher.decrypt(first)).toBe('smtp-password-123');
    expect(cipher.decrypt(second)).toBe('smtp-password-123');
  });

  it('rejects malformed ciphertexts', () => {
    const cipher = new NotificationSecretCipher(KEY);
    expect(() => cipher.decrypt('not-a-valid-payload')).toThrow(/malformed/i);
    const valid = cipher.encrypt('secret');
    expect(() => cipher.decrypt(`${valid.slice(0, -4)}dead`)).toThrow();
  });

  it('rejects a non-64-hex key', () => {
    expect(() => new NotificationSecretCipher('too-short')).toThrow(/64 hex/i);
    expect(() => assertNotificationSecretKey(KEY)).not.toThrow();
  });
});