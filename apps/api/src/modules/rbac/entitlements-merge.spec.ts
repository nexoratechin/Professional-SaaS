import { mergeCandidates, type CandidateRow } from './entitlements.service';

function row(overrides: Partial<CandidateRow>): CandidateRow {
  return {
    key: 'library',
    type: 'BOOLEAN',
    boolValue: true,
    limitValue: null,
    source: 'PLAN',
    sourceRef: 'plan-1',
    ...overrides,
  };
}

describe('mergeCandidates', () => {
  it('keeps a single candidate as-is', () => {
    const merged = mergeCandidates([row({ key: 'admissions' })]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.key).toBe('admissions');
    expect(merged[0]?.boolValue).toBe(true);
  });

  it('lets a more specific source win for BOOLEAN keys (later entry wins)', () => {
    const merged = mergeCandidates([
      row({ key: 'library', source: 'PLAN', boolValue: true }),
      row({ key: 'library', source: 'SUBSCRIPTION_ITEM', boolValue: false, sourceRef: 'item-1' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.source).toBe('SUBSCRIPTION_ITEM');
    expect(merged[0]?.boolValue).toBe(false);
  });

  it('sums QUANTITY limits across sources for the same key instead of overriding', () => {
    const merged = mergeCandidates([
      row({ key: 'max_campuses', type: 'QUANTITY', boolValue: false, limitValue: 5, source: 'PLAN_MODULE' }),
      row({ key: 'max_campuses', type: 'QUANTITY', boolValue: false, limitValue: 3, source: 'SUBSCRIPTION_ITEM' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.limitValue).toBe(8);
  });

  it('falls back to last-wins when types mismatch for the same key', () => {
    const merged = mergeCandidates([
      row({ key: 'reports', type: 'BOOLEAN', boolValue: true, limitValue: null }),
      row({ key: 'reports', type: 'QUANTITY', boolValue: false, limitValue: 10, source: 'SUBSCRIPTION_ITEM' }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.type).toBe('QUANTITY');
    expect(merged[0]?.limitValue).toBe(10);
  });

  it('keeps unrelated keys independent', () => {
    const merged = mergeCandidates([row({ key: 'admissions' }), row({ key: 'library' })]);
    expect(merged.map((m) => m.key).sort()).toEqual(['admissions', 'library']);
  });
});
