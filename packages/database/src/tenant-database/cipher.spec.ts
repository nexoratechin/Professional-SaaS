import { TenantDatabaseSecretCipher, assertTenantDatabaseSecretKey } from './cipher';

const KEY = 'a'.repeat(64);

describe('TenantDatabaseSecretCipher', () => {
  it('round-trips a connection URL', () => {
    const cipher = new TenantDatabaseSecretCipher(KEY);
    const url = 'postgresql://user:pass@localhost:5432/tenant_db?schema=tenant_x';
    const encrypted = cipher.encrypt(url);
    expect(encrypted).not.toContain('user:pass');
    expect(cipher.decrypt(encrypted)).toBe(url);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const cipher = new TenantDatabaseSecretCipher(KEY);
    expect(cipher.encrypt('x')).not.toBe(cipher.encrypt('x'));
  });

  it('rejects a malformed payload', () => {
    const cipher = new TenantDatabaseSecretCipher(KEY);
    expect(() => cipher.decrypt('not-a-payload')).toThrow();
  });

  it('requires a 64-hex key', () => {
    expect(() => assertTenantDatabaseSecretKey('short')).toThrow();
    expect(assertTenantDatabaseSecretKey(KEY)).toHaveLength(32);
  });
});
