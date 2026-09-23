/**
 * Pure helpers for hostel rent-charge generation — kept free of Nest/Prisma so they can be unit
 * tested in isolation (see hostel-fees.spec.ts). All money is integer paise.
 */

function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

/** Clamps the day-of-month into the target month so Jan 31 + 1 month = Feb 28/29, not Mar 3. */
function addMonthsClamped(base: Date, months: number): Date {
  const result = new Date(base);
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  result.setDate(Math.min(day, daysInMonth(result)));
  return result;
}

export function computeHostelChargeCents(monthlyRentCents: number, monthCount: number): number {
  const months = Math.max(0, Math.floor(monthCount || 0));
  return monthlyRentCents * months;
}

export interface HostelChargePeriod {
  start: Date;
  end: Date;
}

/** Billing period for a charge. Defaults to the current calendar month when no periodStart is
 * given; end is inclusive (the day before the next periodStart monthCount months out). */
export function hostelChargePeriod(periodStart?: string | null, monthCount = 1): HostelChargePeriod {
  const months = Math.max(1, Math.floor(monthCount || 1));
  let start: Date;
  if (periodStart) {
    start = new Date(periodStart);
  } else {
    const now = new Date();
    start = new Date(now.getFullYear(), now.getMonth(), 1);
  }
  start.setHours(0, 0, 0, 0);
  const endExclusive = addMonthsClamped(start, months);
  const end = new Date(endExclusive.getTime() - 24 * 60 * 60 * 1000);
  return { start, end };
}