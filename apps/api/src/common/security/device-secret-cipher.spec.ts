import { createHmac } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import { DeviceSecretCipher } from './device-secret-cipher';

function fakeConfig(key: string): AppConfigService {
  return { get: () => key } as unknown as AppConfigService;
}

describe('DeviceSecretCipher', () => {
  const key = '0'.repeat(63) + '1'; // 64 hex chars
  const cipher = new DeviceSecretCipher(fakeConfig(key));

  it('round-trips a token', () => {
    const token = 'dev-tok-1234567890';
    expect(cipher.decrypt(cipher.encrypt(token))).toBe(token);
  });

  it('produces iv:authTag:ciphertext (hex, colon-separated)', () => {
    const encrypted = cipher.encrypt('some-token');
    expect(encrypted.split(':')).toHaveLength(3);
    expect(encrypted).toMatch(/^[0-9a-f:]+$/);
  });

  it('random IV -> distinct ciphertexts for identical plaintext', () => {
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('matches() accepts the right token and rejects wrong/empty', () => {
    const encrypted = cipher.encrypt('right-token');
    expect(cipher.matches(encrypted, 'right-token')).toBe(true);
    expect(cipher.matches(encrypted, 'wrong-token')).toBe(false);
    expect(cipher.matches(null, 'anything')).toBe(false);
    expect(cipher.matches(undefined, 'anything')).toBe(false);
  });

  it('throws on a malformed ciphertext or tampered auth tag', () => {
    expect(() => cipher.decrypt('garbage')).toThrow();
    const encrypted = cipher.encrypt('token');
    const [iv, authTag, ciphertext] = encrypted.split(':');
    expect(() => cipher.decrypt(`${iv}:${authTag}:${(ciphertext ?? '').slice(0, -2)}00`)).toThrow();
  });

  it('decrypt matches across instances from the same key (verification path is portable)', () => {
    const other = new DeviceSecretCipher(fakeConfig(key));
    const encrypted = cipher.encrypt('portable');
    expect(other.matches(encrypted, 'portable')).toBe(true);
  });

  it('verifies an HMAC signature and rejects tampered ones', () => {
    const secret = 'comm-secret';
    const timestamp = '1725200000000';
    const body = '{"code":"QR-1","events":[]}';
    const signature = makeSig(body, timestamp, secret);
    expect(cipher.verifyHmacSignature(body, signature, timestamp, secret)).toBe(true);
    expect(cipher.verifyHmacSignature(body, signature.slice(0, -2) + '00', timestamp, secret)).toBe(false);
    expect(cipher.verifyHmacSignature(body, signature, '9999999999999', secret)).toBe(false);
  });

  it('rejects a signature over a different canonical body', () => {
    const secret = 'comm-secret';
    const timestamp = '1725200000000';
    const signature = makeSig('{"code":"QR-1","events":[]}', timestamp, secret);
    expect(cipher.verifyHmacSignature('{"code":"QR-2","events":[]}', signature, timestamp, secret)).toBe(false);
  });
});

function makeSig(canonicalBody: string, timestamp: string, secret: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${canonicalBody}`, 'utf8').digest('hex');
}