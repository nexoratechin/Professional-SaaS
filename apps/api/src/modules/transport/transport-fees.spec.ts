import { computeTransportChargeCents, transportChargePeriod } from './transport-fees';

describe('computeTransportChargeCents', () => {
  it('is zero for zero, negative or NaN month counts', () => {
    expect(computeTransportChargeCents(100000, 0)).toBe(0);
    expect(computeTransportChargeCents(100000, -2)).toBe(0);
    expect(computeTransportChargeCents(100000, NaN)).toBe(0);
  });

  it('floors fractional month counts', () => {
    expect(computeTransportChargeCents(100000, 2.6)).toBe(200000);
  });

  it('multiplies the monthly fee by whole months', () => {
    expect(computeTransportChargeCents(150000, 3)).toBe(450000);
  });
});

describe('transportChargePeriod', () => {
  it('defaults to the current calendar month when no periodStart is given', () => {
    const now = new Date();
    const { start } = transportChargePeriod(null, 1);
    expect(start.getFullYear()).toBe(now.getFullYear());
    expect(start.getMonth()).toBe(now.getMonth());
  });

  it('returns an inclusive end for a 1-month period', () => {
    const { start, end } = transportChargePeriod('2026-01-10', 1);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(0);
    expect(start.getDate()).toBe(10);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(9);
  });

  it('clamps day-of-month across short months to the last day of the target month', () => {
    // Jan 31 + 1 month → no Feb 31, so the inclusive end is Feb 28
    const { end } = transportChargePeriod('2026-01-31', 1);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(28);
  });

  it('clamps into leap years correctly', () => {
    // Feb 29 2028 + 12 months → no Feb 29 2029, so the inclusive end is Feb 28 2029
    const { end } = transportChargePeriod('2028-02-29', 12);
    expect(end.getFullYear()).toBe(2029);
    expect(end.getMonth()).toBe(1);
    expect(end.getDate()).toBe(28);
  });

  it('falls back to a 1-month period for zero/negative month counts', () => {
    const { end } = transportChargePeriod('2026-05-01', 0);
    expect(end.getFullYear()).toBe(2026);
    expect(end.getMonth()).toBe(4);
    expect(end.getDate()).toBe(31);
  });
});