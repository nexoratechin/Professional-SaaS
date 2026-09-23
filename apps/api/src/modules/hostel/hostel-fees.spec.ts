import { computeHostelChargeCents, hostelChargePeriod } from './hostel-fees';

describe('computeHostelChargeCents', () => {
  it('nulls/halts non-positive inputs', () => {
    expect(computeHostelChargeCents(0, 1)).toBe(0);
    expect(computeHostelChargeCents(-5, 1)).toBe(-5 * 1);
    expect(computeHostelChargeCents(-5, 1)).toBe(-5);
  });

  it('floors fractional month counts and clamps negatives/nonsense to zero', () => {
    expect(computeHostelChargeCents(100000, 0)).toBe(0);
    expect(computeHostelChargeCents(100000, 2.6)).toBe(200000);
    expect(computeHostelChargeCents(100000, -2)).toBe(0);
    expect(computeHostelChargeCents(100000, NaN)).toBe(0);
  });

  it('computes rent × months in paise', () => {
    expect(computeHostelChargeCents(150000, 3)).toBe(450000);
    expect(computeHostelChargeCents(1, 1)).toBe(1);
  });
});

describe('hostelChargePeriod', () => {
  it('defaults to the current calendar month when no start is given', () => {
    const { start, end } = hostelChargePeriod(null, 1);
    const now = new Date();
    expect(start.getFullYear()).toBe(now.getFullYear());
    expect(start.getMonth()).toBe(now.getMonth());
    expect(start.getDate()).toBe(1);
    // end is inclusive: the last day of the same month
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    expect(end.getDate()).toBe(lastDay);
  });

  it('uses the supplied start and extends monthCount months inclusive', () => {
    const { start, end } = hostelChargePeriod('2026-01-10', 2);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(10);
    // Jan 10 + 2 months = Mar 9 (inclusive end)
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(2);
    expect(end.getDate()).toBe(9);
  });

  it('clamps month-end overflow instead of rolling into the next month', () => {
    // Jan 31 → clamped next start Feb 28 → inclusive end Feb 27 (period covers one month)
    const { end } = hostelChargePeriod('2026-01-31', 1);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(27);
  });

  it('treats leap-day starts correctly (Feb 29 2028 + 12 months → end Feb 27 2029)', () => {
    const { end } = hostelChargePeriod('2028-02-29', 12);
    expect(end.getFullYear()).toBe(2029);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(27);
  });

  it('coerces invalid or excessive month counts to at least one month', () => {
    const a = hostelChargePeriod('2026-05-01', 0);
    expect(a.end.getMonth() - a.start.getMonth()).toBe(0);
    const b = hostelChargePeriod('2026-05-01', -3);
    expect(b.end.getMonth() - b.start.getMonth()).toBe(0);
  });
});