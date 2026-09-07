import { buildTotpUri, generateBackupCodes, generateTotpSecret, verifyTotpCode } from './mfa';
import { authenticator } from 'otplib';

describe('TOTP core', () => {
  it('generates a base32 secret usable to compute a valid code', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    const code = authenticator.generate(secret);
    expect(verifyTotpCode(secret, code)).toBe(true);
  });

  it('rejects a code generated from a different secret', () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const codeForB = authenticator.generate(secretB);
    expect(verifyTotpCode(secretA, codeForB)).toBe(false);
  });

  it('rejects a malformed code instead of throwing', () => {
    const secret = generateTotpSecret();
    expect(verifyTotpCode(secret, 'not-a-code')).toBe(false);
  });

  it('builds an otpauth:// URI embedding the account label and issuer', () => {
    const secret = generateTotpSecret();
    const uri = buildTotpUri(secret, 'admin@example.com', 'College ERP SaaS');
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    expect(uri).toContain(encodeURIComponent('admin@example.com'));
    expect(uri).toContain(encodeURIComponent('College ERP SaaS'));
  });
});

describe('backup codes', () => {
  it('generates 10 codes by default, each XXXXX-XXXXX and unique', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('honors a custom count', () => {
    expect(generateBackupCodes(3)).toHaveLength(3);
  });
});
