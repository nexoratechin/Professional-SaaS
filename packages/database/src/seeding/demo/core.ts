/**
 * Shared plumbing for the demo-college seeder.
 *
 * Determinism: every demo row gets a UUID derived from a stable name (UUID v5 over a fixed
 * namespace), so repeated seed runs upsert the same rows instead of duplicating them. Dates are
 * anchored to the seeded 2026-27 academic calendar rather than "now", so re-running the seeder
 * never rewrites rows with fresh timestamps — the seed is repeatable and safe.
 */
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const DEMO_TENANT_SLUG = 'demo-college';

const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'; // RFC 4122 DNS namespace
const NAME_PREFIX = `college-erp.demo/${DEMO_TENANT_SLUG}/`;

/** A fixed "now" for the demo dataset (the seeded 2026-27 odd semester is in progress). */
export const DEMO_NOW = new Date('2026-10-10T09:00:00.000Z');

/** Parse a yyyy-mm-dd string into a UTC Date at midnight. */
export function demoDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}

/** Parse a yyyy-mm-ddTHH:mm string into a UTC Date. */
export function demoDateTime(isoDateTime: string): Date {
  return new Date(`${isoDateTime}:00.000Z`);
}

/** UUID v5 (SHA-1, RFC 4122) — deterministic ids for idempotent upserts. */
function uuidV5(name: string): string {
  const namespace = Buffer.from(NAMESPACE_UUID.replace(/-/g, ''), 'hex');
  const digest = createHash('sha1').update(namespace).update(name, 'utf8').digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Stable id for a demo entity, namespaced to the demo tenant. */
export function demoId(segment: string): string {
  return uuidV5(NAME_PREFIX + segment);
}

/** Context threaded through every demo seeding module. */
export interface DemoContext {
  prisma: PrismaClient;
  tenantId: string;
  /** The demo college's bootstrap admin user — stamped as createdBy/updatedBy on demo rows. */
  creator: string;
  /** bcrypt hash shared by every demo user (password comes from SEED_DEMO_PASSWORD). */
  passwordHash: string;
  ids: (segment: string) => string;
}

/** Per-module id maps returned by each seeding stage (e.g. { campusMain: '...' }). */
export type IdMap = Record<string, string>;

/** Fetch a required id from a stage result — throws early with a useful message if a key typos. */
export function must(map: IdMap, key: string): string {
  const value = map[key];
  if (!value) {
    throw new Error(`Demo seed bug: missing id "${key}". Available: ${Object.keys(map).join(', ')}`);
  }
  return value;
}

/** Deterministic value spread across [min, max] from two integer indexes (stable pseudo-random). */
export function spread(a: number, b: number, min: number, max: number): number {
  const range = Math.max(1, max - min + 1);
  return min + ((a * 37 + b * 101 + ((a * b) % 13)) % range);
}

/** Pick from a list by index without ever returning undefined (stable round-robin). */
export function stablePick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) {
    throw new Error('stablePick: empty collection');
  }
  return item;
}

/** True when the string is a valid date — small guard for the calendar data below. */
export function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

/** Add whole days to a date (UTC) without mutating the original. */
export function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

/** Split an amount (paise/cents) into two installment shares (60/40, rounded to whole rupees). */
export function installments60_40(amountCents: number): { first: number; second: number } {
  const toRupees = (value: number) => Math.round(value / 100) * 100;
  const first = toRupees(amountCents * 0.6);
  return { first, second: amountCents - first };
}

/** Log one line for a seeded module. */
export function logDemo(moduleName: string, counts: Record<string, number>): void {
  const detail = Object.entries(counts)
    .map(([key, value]) => `${key}=${value}`)
    .join(' ');
  console.log(`[demo-seed] ${moduleName}: ${detail}`);
}

export type { PrismaClient };
