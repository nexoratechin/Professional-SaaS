import {
  contentHash,
  countPushOutcomes,
  decideRecordChanges,
  deriveRunStatus,
  emptyCounters,
  healthFromSyncStatus,
  shouldContinueSync,
  stableStringify,
} from './sync';

describe('stableStringify', () => {
  it('is insensitive to object key order, so provider key reordering is not a false "changed"', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    expect(contentHash({ b: 1, a: 2 })).toBe(contentHash({ a: 2, b: 1 }));
  });

  it('preserves array order, which is semantically meaningful', () => {
    expect(stableStringify([1, 2, 3])).not.toBe(stableStringify([3, 2, 1]));
  });

  it('handles nested structures and primitives', () => {
    expect(stableStringify({ a: { b: [{ c: 1 }] } })).toBe('{"a":{"b":[{"c":1}]}}');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify('x')).toBe('"x"');
  });

  it('drops undefined members rather than emitting invalid JSON', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });
});

describe('contentHash', () => {
  it('changes when a value changes and is stable when it does not', () => {
    expect(contentHash({ amount: 100 })).toBe(contentHash({ amount: 100 }));
    expect(contentHash({ amount: 100 })).not.toBe(contentHash({ amount: 101 }));
  });
});

describe('decideRecordChanges', () => {
  const page = {
    records: [
      { externalId: 'a', payload: { v: 1 }, contentHash: 'h-a' },
      { externalId: 'b', payload: { v: 2 }, contentHash: 'h-b' },
      { externalId: 'c', payload: { v: 3 }, contentHash: 'h-c' },
    ],
  };

  it('skips records whose stored hash matches', () => {
    const decisions = decideRecordChanges(page, { a: 'h-a', b: 'h-b', c: 'h-CHANGED' });
    expect(decisions.map((d) => d.externalId)).toEqual(['a', 'b', 'c']);
    expect(decisions[0]!.changed).toBe(false);
    expect(decisions[1]!.changed).toBe(false);
    expect(decisions[2]!.changed).toBe(true);
  });

  it('treats first sight as changed, not "unchanged"', () => {
    const decisions = decideRecordChanges(page, {});
    expect(decisions.every((d) => d.changed)).toBe(true);
  });

  it('derives the hash from the payload when the provider supplies none', () => {
    const decisions = decideRecordChanges({ records: [{ externalId: 'x', payload: { n: 1 } }] }, {});
    expect(decisions[0]!.contentHash).toBe(contentHash({ n: 1 }));
  });

  it("honours a provider-supplied hash over our own", () => {
    const decisions = decideRecordChanges(
      { records: [{ externalId: 'x', payload: { n: 1 }, contentHash: 'provider-hash' }] },
      { x: 'provider-hash' },
    );
    expect(decisions[0]!.contentHash).toBe('provider-hash');
    expect(decisions[0]!.changed).toBe(false);
  });
});

describe('countPushOutcomes', () => {
  it('counts successes, failures and id-less records distinctly', () => {
    const counters = countPushOutcomes([
      { externalId: 'a', ok: true },
      { externalId: 'b', ok: false, error: 'nope' },
      { externalId: '', ok: true },
    ]);
    expect(counters).toEqual({ attempted: 2, succeeded: 1, failed: 1, skipped: 1 });
  });

  it('starts from zeroed counters', () => {
    expect(emptyCounters()).toEqual({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 });
  });
});

describe('deriveRunStatus', () => {
  it('is FAILED when the run could not complete at all', () => {
    expect(deriveRunStatus({ attempted: 0, succeeded: 0, failed: 0, skipped: 0 }, { completed: false })).toBe('FAILED');
  });

  it('is SUCCEEDED when nothing failed, even with skips', () => {
    expect(deriveRunStatus({ attempted: 10, succeeded: 10, failed: 0, skipped: 3 }, { completed: true })).toBe('SUCCEEDED');
  });

  it('is PARTIAL when some records stuck but others landed — a 99% sync must not read as broken', () => {
    expect(deriveRunStatus({ attempted: 1000, succeeded: 940, failed: 60, skipped: 0 }, { completed: true })).toBe('PARTIAL');
  });

  it('is FAILED when every attempted record failed', () => {
    expect(deriveRunStatus({ attempted: 10, succeeded: 0, failed: 10, skipped: 0 }, { completed: true })).toBe('FAILED');
  });
});

describe('shouldContinueSync', () => {
  it('continues when the provider reported more and the run was healthy', () => {
    expect(shouldContinueSync('SUCCEEDED', true)).toBe(true);
    expect(shouldContinueSync('PARTIAL', true)).toBe(true);
  });

  it('stops when there is no more data', () => {
    expect(shouldContinueSync('SUCCEEDED', false)).toBe(false);
  });

  it('stops on a broken run even if the provider claims more, so a failing provider is not hammered', () => {
    expect(shouldContinueSync('FAILED', true)).toBe(false);
    expect(shouldContinueSync('CANCELED', true)).toBe(false);
  });
});

describe('healthFromSyncStatus', () => {
  it('maps run outcomes onto integration health', () => {
    expect(healthFromSyncStatus('SUCCEEDED')).toBe('HEALTHY');
    expect(healthFromSyncStatus('PARTIAL')).toBe('DEGRADED');
    expect(healthFromSyncStatus('FAILED')).toBe('UNHEALTHY');
    expect(healthFromSyncStatus('CANCELED')).toBe('UNHEALTHY');
  });
});
