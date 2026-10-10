import { isoWeekKey, planRetention, type RetentionEntry } from './retention';

function entry(key: string, iso: string): RetentionEntry {
  return { key, createdAt: iso };
}

describe('isoWeekKey', () => {
  it('computes ISO-8601 week keys in UTC', () => {
    expect(isoWeekKey(new Date('2026-01-01T12:00:00Z'))).toBe('2026-W01');
    expect(isoWeekKey(new Date('2026-10-09T12:00:00Z'))).toBe('2026-W41');
    // 2027-01-01 is a Friday in ISO week 53 of 2026.
    expect(isoWeekKey(new Date('2027-01-01T12:00:00Z'))).toBe('2026-W53');
  });
});

describe('planRetention (GFS)', () => {
  it('keeps the newest backup per day for the daily window, then prunes the rest by week/month', () => {
    const entries = [
      // Three backups on the first day: only the newest is kept.
      entry('d1-early', '2026-10-09T01:00:00Z'),
      entry('d1-mid', '2026-10-09T02:00:00Z'),
      entry('d1-late', '2026-10-09T03:00:00Z'),
      entry('d2', '2026-10-08T03:00:00Z'),
      entry('d3', '2026-10-07T03:00:00Z'),
      // Same ISO week as d2/d3, older than the daily window: weekly tier keeps the newest.
      entry('d4', '2026-10-06T03:00:00Z'),
      entry('d5', '2026-10-05T03:00:00Z'),
      // A different (older) month: monthly tier keeps the newest.
      entry('m1', '2026-09-20T03:00:00Z'),
      entry('m2', '2026-09-10T03:00:00Z'),
    ];
    const plan = planRetention(entries, { daily: 2, weekly: 2, monthly: 2 });

    expect(plan.keep).toEqual(['d1-late', 'd2', 'd3', 'm1', 'm2']);
    expect(plan.delete).toEqual(['d1-mid', 'd1-early', 'd4', 'd5']);
  });

  it('never deletes the newest backup even with a zeroed policy', () => {
    const plan = planRetention([entry('one', '2026-10-09T03:00:00Z'), entry('two', '2026-10-01T03:00:00Z')], {
      daily: 0,
      weekly: 0,
      monthly: 0,
    });
    expect(plan.keep).toEqual(['one']);
    expect(plan.delete).toEqual(['two']);
  });

  it('prunes entries whose timestamp cannot be parsed', () => {
    const plan = planRetention([entry('good', '2026-10-09T03:00:00Z'), entry('bad', 'not-a-date')], {
      daily: 7,
      weekly: 4,
      monthly: 12,
    });
    expect(plan.keep).toEqual(['good']);
    expect(plan.delete).toEqual(['bad']);
  });

  it('handles an empty list', () => {
    expect(planRetention([], { daily: 7, weekly: 4, monthly: 12 })).toEqual({ keep: [], delete: [] });
  });
});
