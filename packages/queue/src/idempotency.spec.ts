import { buildIdempotencyKey, deterministicJobId, toBullJobId } from './idempotency';

describe('idempotency helpers', () => {
  it('joins non-empty parts with a colon and drops empty/undefined parts', () => {
    expect(buildIdempotencyKey('report', undefined, 'abc', null, 7)).toBe('report:abc:7');
  });

  it('throws when every part is empty', () => {
    expect(() => buildIdempotencyKey(null, undefined, '')).toThrow(/at least one non-empty part/i);
  });

  it('produces a stable BullMQ-safe job id', () => {
    expect(toBullJobId('report:{runId}:{tenant}')).toBe('report-runId-tenant');
    expect(deterministicJobId('certificate-generation', 't1', 'c9')).toBe('certificate-generation-t1-c9');
  });

  it('is deterministic for the same logical inputs', () => {
    expect(buildIdempotencyKey('a', 'b')).toBe(buildIdempotencyKey('a', 'b'));
  });
});
