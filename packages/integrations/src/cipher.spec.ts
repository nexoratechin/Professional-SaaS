import { IntegrationSecretCipher, assertIntegrationSecretKey } from './cipher';

const KEY_A = 'a'.repeat(64);
const KEY_B = 'b'.repeat(64);

describe('IntegrationSecretCipher', () => {
  it('round-trips a credential bag', () => {
    const cipher = new IntegrationSecretCipher(KEY_A);
    const bag = { apiKey: 'sk_live_abc123', username: 'acme', password: 'p@ss' };
    expect(cipher.decryptBag(cipher.encryptBag(bag))).toEqual(bag);
  });

  it('produces the iv:authTag:ciphertext envelope used by the other repo ciphers', () => {
    const cipher = new IntegrationSecretCipher(KEY_A);
    const payload = cipher.encrypt('some-token');
    expect(payload.split(':')).toHaveLength(3);
    expect(payload).toMatch(/^[0-9a-f:]+$/);
  });

  it('uses a fresh IV per encryption so the same secret never repeats on the wire', () => {
    const cipher = new IntegrationSecretCipher(KEY_A);
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('is portable across instances built from the same key (API encrypts, worker decrypts)', () => {
    const apiCipher = new IntegrationSecretCipher(KEY_A);
    const workerCipher = new IntegrationSecretCipher(KEY_A);
    expect(workerCipher.decryptBag(apiCipher.encryptBag({ token: 'portable' }))).toEqual({ token: 'portable' });
  });

  it('cannot be decrypted with a different key', () => {
    const payload = new IntegrationSecretCipher(KEY_A).encrypt('secret');
    expect(() => new IntegrationSecretCipher(KEY_B).decrypt(payload)).toThrow();
  });

  it('rejects tampered ciphertext (authenticated encryption)', () => {
    const cipher = new IntegrationSecretCipher(KEY_A);
    const payload = cipher.encrypt('payload');
    const [iv, authTag, ciphertext] = payload.split(':');
    const flipped = `${ciphertext!.slice(0, -2)}${ciphertext!.endsWith('00') ? '11' : '00'}`;
    expect(() => cipher.decrypt(`${iv}:${authTag}:${flipped}`)).toThrow();
  });

  it('treats an absent credential column as no credentials rather than corruption', () => {
    const cipher = new IntegrationSecretCipher(KEY_A);
    expect(cipher.decryptBag(null)).toEqual({});
    expect(cipher.decryptBag(undefined)).toEqual({});
    expect(cipher.decryptBag('')).toEqual({});
  });

  it('throws on a malformed payload rather than returning garbage', () => {
    const cipher = new IntegrationSecretCipher(KEY_A);
    expect(() => cipher.decrypt('not-a-valid-payload')).toThrow(/Malformed/);
  });

  it('rejects non-object credential JSON', () => {
    const cipher = new IntegrationSecretCipher(KEY_A);
    expect(() => cipher.decryptBag(cipher.encrypt('["a"]'))).toThrow(/not a JSON object/);
  });

  describe('matches (constant-time shared-secret comparison)', () => {
    it('matches the right secret and rejects the wrong one', () => {
      const cipher = new IntegrationSecretCipher(KEY_A);
      const payload = cipher.encrypt('shared-secret');
      expect(cipher.matches(payload, 'shared-secret')).toBe(true);
      expect(cipher.matches(payload, 'wrong-secret')).toBe(false);
    });

    it('returns false for a missing payload or differing length rather than throwing', () => {
      const cipher = new IntegrationSecretCipher(KEY_A);
      expect(cipher.matches(null, 'anything')).toBe(false);
      expect(cipher.matches(cipher.encrypt('abc'), 'a-much-longer-value')).toBe(false);
    });

    it('returns false for corrupt ciphertext instead of propagating a decrypt error', () => {
      const cipher = new IntegrationSecretCipher(KEY_A);
      expect(cipher.matches('garbage', 'anything')).toBe(false);
    });
  });

  describe('assertIntegrationSecretKey', () => {
    it('accepts 64 hex characters', () => {
      expect(assertIntegrationSecretKey(KEY_A)).toHaveLength(32);
    });

    it('rejects wrong length or non-hex values', () => {
      expect(() => assertIntegrationSecretKey('abc')).toThrow(/64 hex/);
      expect(() => assertIntegrationSecretKey('z'.repeat(64))).toThrow(/64 hex/);
    });
  });
});
