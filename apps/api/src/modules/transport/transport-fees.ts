/**
 * Pure helpers for transport pass fee-charge generation — kept free of Nest/Prisma so they can be
 * unit tested in isolation (see transport-fees.spec.ts). All money is integer paise. Mirrors the
 * hostel rent-charge period math so the two modules bill identically.
 */

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function computeTransportChargeCents(monthlyFeeCents: number, monthCount: number): number {
  const months = Math.max(0, Math.floor(monthCount || 0));
  return monthlyFeeCents * months;
}

export interface TransportChargePeriod {
  start: Date;
  end: Date;
}

/** Billing period for a route fee. Defaults to the pass periodStart (or the current calendar
 * month) when none is passed; end is inclusive — the day before the next periodStart monthCount
 * months out, clamped so Jan 31 + 1 month ends on the last day of the target month (Feb 28/29). */
export function transportChargePeriod(
  periodStart?: string | null,
  monthCount = 1,
): TransportChargePeriod {
  const months = Math.max(1, Math.floor(monthCount || 1));
  let start: Date;
  if (periodStart) {
    start = new Date(periodStart);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  start.setHours(0, 0, 0, 0);

  const day = start.getDate();
  const target = new Date(start);
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = daysInMonth(target);
  const clamped = day > lastDay;
  if (clamped) {
    target.setDate(lastDay);
  } else {
    target.setDate(day);
    target.setTime(target.getTime() - 24 * 60 * 60 * 1000);
  }
  return { start, end: target };
}