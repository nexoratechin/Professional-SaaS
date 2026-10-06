import { REDACTED, redactForLog, sanitizeHeaders, truncateResponse } from './redact';

describe('redactForLog', () => {
  it('masks obviously-named secret keys at any depth', () => {
    const input = {
      apiKey: 'anything',
      nested: { deeper: { clientSecret: 'shh', safe: 'visible' } },
    };
    expect(redactForLog(input)).toEqual({
      apiKey: REDACTED,
      nested: { deeper: { clientSecret: REDACTED, safe: 'visible' } },
    });
  });

  it('matches secret key names case-insensitively and as substrings', () => {
    const redacted = redactForLog({ API_KEY: 'a', myPassword: 'b', X_Auth_Token: 'c', RefreshToken: 'd' }) as Record<string, unknown>;
    expect(Object.values(redacted)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED]);
  });

  it('masks PII-shaped keys', () => {
    const redacted = redactForLog({ cardNumber: '4111111111111111', cvv: '123', iban: 'DE00', aadhaar: '9999' }) as Record<string, unknown>;
    expect(Object.values(redacted)).toEqual([REDACTED, REDACTED, REDACTED, REDACTED]);
  });

  it('masks secret-shaped values even under an innocuous key', () => {
    expect(redactForLog({ data: 'sk_live_abcdefgh12345678' })).toEqual({ data: REDACTED });
    expect(redactForLog({ blob: 'AKIAIOSFODNN7EXAMPLE' })).toEqual({ blob: REDACTED });
    expect(redactForLog({ blob: 'ghp_0123456789abcdefghijklmnopqrstuvwx' })).toEqual({ blob: REDACTED });
    expect(redactForLog({ blob: 'xoxb-1234567890-abcdefghij' })).toEqual({ blob: REDACTED });
    expect(redactForLog({ blob: 'whsec_abcdefghijklmnopqrstuv' })).toEqual({ blob: REDACTED });
  });

  it('masks bearer/basic authorization values pasted into a neutral field', () => {
    expect(redactForLog({ note: 'Bearer sk_live_abcdefghij' })).toEqual({ note: REDACTED });
    expect(redactForLog({ note: 'Basic dXNlcjpwYXNz' })).toEqual({ note: REDACTED });
  });

  it('masks JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abcdefghijkl';
    expect(redactForLog({ data: jwt })).toEqual({ data: REDACTED });
  });

  it('leaves ordinary business data untouched', () => {
    const payload = {
      studentId: 'a1b2',
      amount: 1500,
      currency: 'INR',
      paid: true,
      note: 'Term 1 fee',
      missing: null,
    };
    expect(redactForLog(payload)).toEqual(payload);
  });

  it('walks arrays and preserves order', () => {
    expect(redactForLog([{ token: 'x' }, { ok: 'y' }])).toEqual([{ token: REDACTED }, { ok: 'y' }]);
  });

  it('stops at a depth limit rather than recursing forever on a hostile payload', () => {
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 20; i += 1) deep = { child: deep };
    const result = JSON.stringify(redactForLog(deep));
    expect(result).toContain('max depth');
  });

  it('caps array breadth so a huge webhook body cannot bloat a JSONB log column', () => {
    const result = redactForLog(Array.from({ length: 200 }, (_, i) => i)) as unknown[];
    expect(result.length).toBeLessThanOrEqual(51);
    expect(String(result[result.length - 1])).toContain('truncated');
  });

  it('truncates very long strings', () => {
    const result = redactForLog({ note: 'x'.repeat(5_000) }) as { note: string };
    expect(result.note.length).toBeLessThan(5_000);
    expect(result.note).toContain('truncated');
  });

  it('handles null, undefined and non-serializable values without throwing', () => {
    expect(redactForLog(null)).toBeNull();
    expect(redactForLog(undefined)).toBeNull();
    expect(redactForLog(() => undefined)).toBe('[function]');
  });

  it('handles a self-referential payload instead of blowing the stack', () => {
    // An unauthenticated webhook body is attacker-controlled; a cycle must terminate, not recurse.
    const circular: Record<string, unknown> = { name: 'loop' };
    circular.self = circular;
    const result = redactForLog(circular) as Record<string, unknown>;
    expect(result.name).toBe('loop');
    expect(result.self).toBe('[circular]');
  });

  it('terminates on mutually-referencing objects', () => {
    const a: Record<string, unknown> = { id: 'a' };
    const b: Record<string, unknown> = { id: 'b', a };
    a.b = b;
    expect(() => redactForLog(a)).not.toThrow();
  });
});

describe('sanitizeHeaders', () => {
  it('keeps only allow-listed non-secret headers', () => {
    const result = sanitizeHeaders({
      'content-type': 'application/json',
      'user-agent': 'vendor/1.0',
      'x-request-id': 'req_1',
      authorization: 'Bearer secret',
      cookie: 'session=abc',
      'x-api-key': 'sk_live_xxx',
    });
    expect(result).toEqual({
      'content-type': 'application/json',
      'user-agent': 'vendor/1.0',
      'x-request-id': 'req_1',
    });
  });

  it('never persists a header whose name merely looks secret', () => {
    // `x-signature` and `x-webhook-token` are not on the allow-list, so nothing survives the
    // filter and the whole call collapses to null rather than a half-populated header dump.
    expect(sanitizeHeaders({ 'x-signature': 'v1=abc', 'x-webhook-token': 't' })).toBeNull();
  });

  it('joins array header values', () => {
    expect(sanitizeHeaders({ 'x-request-id': ['a', 'b'] })).toEqual({ 'x-request-id': 'a, b' });
  });

  it('returns null when nothing is allow-listed or there are no headers', () => {
    expect(sanitizeHeaders({})).toBeNull();
    expect(sanitizeHeaders(null)).toBeNull();
    expect(sanitizeHeaders({ authorization: 'x' })).toBeNull();
  });
});

describe('truncateResponse', () => {
  it('leaves a short body alone', () => {
    expect(truncateResponse('short')).toBe('short');
  });

  it('truncates and reports how much was dropped', () => {
    const result = truncateResponse('y'.repeat(50), 10);
    expect(result.startsWith('yyyyyyyyyy')).toBe(true);
    expect(result).toContain('truncated 40 chars');
  });
});
