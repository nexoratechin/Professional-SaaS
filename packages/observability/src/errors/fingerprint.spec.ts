import { fingerprintError, normalizeVolatile } from './fingerprint';

describe('fingerprintError', () => {
  it('groups errors whose messages differ only by volatile ids/numbers', () => {
    // Same throw site (same stack frames), different runtime ids — the canonical "one bug,
    // many requests" case the fingerprint must collapse.
    const throwNotFound = (id: string, tenantId: string) =>
      new Error(`Payment ${id} not found for tenant ${tenantId}`);
    const a = fingerprintError(throwNotFound('123', '550e8400-e29b-41d4-a716-446655440000'));
    const b = fingerprintError(throwNotFound('456', '660e8400-e29b-41d4-a716-446655440001'));
    expect(a).toBe(b);
  });

  it('separates different error types and messages', () => {
    const fail = (error: Error) => error;
    const a = fingerprintError(fail(new Error('boom')));
    const b = fingerprintError(fail(new TypeError('boom')));
    const c = fingerprintError(fail(new Error('different')));
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it('returns a stable 32-char hex hash', () => {
    const error = new Error('x');
    const value = fingerprintError(error);
    expect(value).toMatch(/^[0-9a-f]{32}$/);
    expect(fingerprintError(error)).toBe(value);
  });

  it('handles non-Error throwables', () => {
    expect(fingerprintError('plain string')).toMatch(/^[0-9a-f]{32}$/);
  });

  it('replaces long tokens and uuids in normalization', () => {
    expect(normalizeVolatile('token abcdefghijklmnopqrstuvwx failed')).toContain('<token>');
    expect(normalizeVolatile('id 550e8400-e29b-41d4-a716-446655440000')).toContain('<uuid>');
    expect(normalizeVolatile('count 42')).toContain('<n>');
  });
});
