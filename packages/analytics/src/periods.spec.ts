import {
  addPeriod,
  buildSeries,
  comparePeriods,
  periodKey,
  periodKeyToStart,
  previousPeriod,
  resolvePeriods,
  round2,
  startOfUtcDay,
  startOfUtcMonth,
} from './periods';

describe('startOfUtcDay / startOfUtcMonth', () => {
  it('truncates to the UTC boundary', () => {
    const value = new Date('2026-03-17T13:45:12.987Z');
    expect(startOfUtcDay(value).toISOString()).toBe('2026-03-17T00:00:00.000Z');
    expect(startOfUtcMonth(value).toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('is idempotent for an already-aligned value', () => {
    const aligned = new Date('2026-03-17T00:00:00.000Z');
    expect(startOfUtcDay(aligned).getTime()).toBe(aligned.getTime());
  });
});

describe('periodKey / periodKeyToStart', () => {
  it('round-trips a daily key', () => {
    const start = new Date('2026-03-17T00:00:00.000Z');
    const key = periodKey(start, 'DAILY');
    expect(key).toBe('2026-03-17');
    expect(periodKeyToStart(key, 'DAILY').toISOString()).toBe(start.toISOString());
  });

  it('round-trips a monthly key', () => {
    const start = new Date('2026-03-01T00:00:00.000Z');
    const key = periodKey(start, 'MONTHLY');
    expect(key).toBe('2026-03');
    expect(periodKeyToStart(key, 'MONTHLY').toISOString()).toBe(start.toISOString());
  });

  it('rejects a malformed key rather than returning an Invalid Date', () => {
    expect(() => periodKeyToStart('nope', 'DAILY')).toThrow(/Invalid analytics period key/);
    expect(() => periodKeyToStart('2026-03', 'DAILY')).toThrow(/needs a day/);
  });
});

describe('addPeriod', () => {
  it('advances one day across a month boundary', () => {
    expect(addPeriod(new Date('2026-01-31T00:00:00.000Z'), 'DAILY').toISOString()).toBe(
      '2026-02-01T00:00:00.000Z',
    );
  });

  it('advances one month across a year boundary', () => {
    expect(addPeriod(new Date('2026-12-01T00:00:00.000Z'), 'MONTHLY').toISOString()).toBe(
      '2027-01-01T00:00:00.000Z',
    );
  });
});

describe('resolvePeriods', () => {
  it('tiles a 7-day window into exactly 7 whole daily buckets', () => {
    const periods = resolvePeriods(
      new Date('2026-03-10T00:00:00.000Z'),
      new Date('2026-03-17T00:00:00.000Z'),
      'DAILY',
    );
    expect(periods).toHaveLength(7);
    expect(periods[0]?.key).toBe('2026-03-10');
    expect(periods[6]?.key).toBe('2026-03-16');
  });

  it('produces contiguous, non-overlapping buckets', () => {
    const periods = resolvePeriods(
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-04-01T00:00:00.000Z'),
      'DAILY',
    );
    for (let index = 1; index < periods.length; index += 1) {
      expect(periods[index]?.from.toISOString()).toBe(periods[index - 1]?.to.toISOString());
    }
  });

  it('snaps a mid-bucket start forward instead of returning a partial leading bucket', () => {
    const periods = resolvePeriods(
      new Date('2026-03-10T06:00:00.000Z'),
      new Date('2026-03-12T00:00:00.000Z'),
      'DAILY',
    );
    expect(periods.map((period) => period.key)).toEqual(['2026-03-11']);
  });

  it('aligns a monthly window to month starts', () => {
    const periods = resolvePeriods(
      new Date('2026-01-15T00:00:00.000Z'),
      new Date('2026-04-01T00:00:00.000Z'),
      'MONTHLY',
    );
    expect(periods.map((period) => period.key)).toEqual(['2026-02', '2026-03']);
    expect(periods[0]?.from.toISOString()).toBe('2026-02-01T00:00:00.000Z');
  });

  it('caps the number of buckets so a wide range cannot fan out unboundedly', () => {
    const periods = resolvePeriods(
      new Date('2000-01-01T00:00:00.000Z'),
      new Date('2026-01-01T00:00:00.000Z'),
      'DAILY',
      30,
    );
    expect(periods).toHaveLength(30);
  });

  it('rejects an inverted range', () => {
    expect(() =>
      resolvePeriods(new Date('2026-03-10T00:00:00.000Z'), new Date('2026-03-01T00:00:00.000Z'), 'DAILY'),
    ).toThrow(/end after it starts/);
  });
});

describe('previousPeriod', () => {
  it('returns the immediately preceding day, ending where the period starts', () => {
    const periods = resolvePeriods(
      new Date('2026-03-10T00:00:00.000Z'),
      new Date('2026-03-12T00:00:00.000Z'),
      'DAILY',
    );
    // periods[0] is 2026-03-10, periods[1] is 2026-03-11.
    const period = periods[1];
    expect(period).toBeDefined();
    const previous = previousPeriod(period!);
    expect(previous.key).toBe('2026-03-10');
    expect(previous.to.toISOString()).toBe(period!.from.toISOString());
  });

  it('crosses the year boundary for monthly buckets', () => {
    const periods = resolvePeriods(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('2026-02-01T00:00:00.000Z'),
      'MONTHLY',
    );
    const period = periods[0];
    expect(period).toBeDefined();
    expect(previousPeriod(period!).key).toBe('2025-12');
  });
});

describe('percentChange / comparePeriods', () => {
  it('returns null instead of Infinity when there is no baseline', () => {
    expect(comparePeriods(100, 0).percentChange).toBeNull();
    expect(comparePeriods(100, 0).delta).toBe(100);
  });

  it('handles a decline as a negative percentage', () => {
    const comparison = comparePeriods(80, 100);
    expect(comparison.percentChange).toBe(-20);
    expect(comparison.delta).toBe(-20);
  });

  it('uses the absolute value of the baseline so a negative series is not inverted', () => {
    expect(comparePeriods(-50, -100).percentChange).toBe(50);
  });
});

describe('buildSeries', () => {
  it('emits one point per bucket, filling absent buckets with zero', () => {
    const periods = resolvePeriods(
      new Date('2026-03-01T00:00:00.000Z'),
      new Date('2026-03-04T00:00:00.000Z'),
      'DAILY',
    );
    const series = buildSeries('mrr', 'MRR', 'CURRENCY_CENTS', periods, new Map([['2026-03-02', 500]]));
    expect(series.points.map((point) => point.value)).toEqual([0, 500, 0]);
    expect(series.points[0]?.periodStart).toBe('2026-03-01T00:00:00.000Z');
    expect(series.unit).toBe('CURRENCY_CENTS');
  });
});

describe('round2', () => {
  it('clears float dust', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(33.333333)).toBe(33.33);
  });
});
