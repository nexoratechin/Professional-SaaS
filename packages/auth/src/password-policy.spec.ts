import { isPasswordStrong, validatePasswordStrength } from './password-policy';

describe('validatePasswordStrength', () => {
  it('accepts a long, diverse password', () => {
    expect(validatePasswordStrength('Correct-Horse-Battery-9')).toEqual([]);
    expect(isPasswordStrong('Correct-Horse-Battery-9')).toBe(true);
  });

  it('rejects a password shorter than the minimum length', () => {
    const violations = validatePasswordStrength('Sh0rt!');
    expect(violations.map((v) => v.rule)).toContain('MIN_LENGTH');
  });

  it('rejects a password with too few character classes', () => {
    const violations = validatePasswordStrength('alllowercaseletters');
    expect(violations.map((v) => v.rule)).toContain('CHARACTER_DIVERSITY');
  });

  it('rejects a common password even if it technically meets length/diversity rules', () => {
    const violations = validatePasswordStrength('Password123');
    expect(violations.map((v) => v.rule)).toContain('COMMON_PASSWORD');
  });

  it('rejects an excessively long password', () => {
    const violations = validatePasswordStrength(`Aa1!${'x'.repeat(200)}`);
    expect(violations.map((v) => v.rule)).toContain('MAX_LENGTH');
  });

  it('is case-insensitive when matching the common-password blocklist', () => {
    expect(isPasswordStrong('PASSWORD123')).toBe(false);
  });
});
