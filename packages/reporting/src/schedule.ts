import type { ReportScheduleFrequency } from './types';
import { ReportScopeError } from './types';

export interface ReportScheduleTiming {
  frequency: ReportScheduleFrequency;
  timeOfDay: string;
  timezone: string;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localParts(date: Date, timezone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts: Record<string, number> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? date.getUTCFullYear(),
    month: parts.month ?? date.getUTCMonth() + 1,
    day: parts.day ?? date.getUTCDate(),
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

function offsetMs(timezone: string, date: Date): number {
  const parts = localParts(date, timezone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - date.getTime();
}

function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  const firstOffset = offsetMs(timezone, guess);
  let result = new Date(guess.getTime() - firstOffset);
  const secondOffset = offsetMs(timezone, result);
  if (secondOffset !== firstOffset) result = new Date(guess.getTime() - secondOffset);
  return result;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function assertTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new ReportScopeError(`Unknown timezone: ${timezone}`);
  }
}

export function calculateNextRunAt(timing: ReportScheduleTiming, from: Date = new Date()): Date {
  assertTimezone(timing.timezone);
  const match = /^(?:[01]\d|2[0-3]):([0-5]\d)$/.exec(timing.timeOfDay);
  if (!match) throw new ReportScopeError('timeOfDay must be a 24-hour HH:mm value.');
  const hour = Number(timing.timeOfDay.slice(0, 2));
  const minute = Number(match[1] ?? '0');

  const local = localParts(from, timing.timezone);
  const currentWeekday = new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay();
  const targetWeekday = timing.dayOfWeek ?? currentWeekday;
  const targetMonthDay = timing.dayOfMonth ?? local.day;

  for (let offset = 0; offset <= 550; offset += 1) {
    const cursor = new Date(Date.UTC(local.year, local.month - 1, local.day + offset));
    const year = cursor.getUTCFullYear();
    const month = cursor.getUTCMonth() + 1;
    const day = cursor.getUTCDate();
    const weekday = cursor.getUTCDay();

    if (timing.frequency === 'WEEKLY' && weekday !== targetWeekday) continue;
    if (timing.frequency === 'MONTHLY') {
      const clamped = Math.min(Math.max(targetMonthDay, 1), daysInMonth(year, month));
      if (day !== clamped) continue;
    }

    const candidate = zonedTimeToUtc(year, month, day, hour, minute, timing.timezone);
    if (candidate.getTime() > from.getTime()) return candidate;
  }

  throw new ReportScopeError('Could not calculate the next schedule run within the supported horizon.');
}
