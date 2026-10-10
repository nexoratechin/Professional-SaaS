/**
 * Grandfather-father-son (GFS) retention for backup archives.
 *
 * Pure and deterministic: given the archives currently in storage and a policy, it returns exactly
 * which keys to keep and which to delete. The newest archive is always kept — a retention policy
 * that would delete the only backup ever taken is a policy bug, not an acceptable outcome.
 *
 * Tiers are applied strictly in order (daily, then weekly on what remains, then monthly on what
 * remains), which is the standard GFS shape: the last N days are kept individually, then one per
 * week for the previous W weeks, then one per month for the previous M months.
 */

export interface RetentionEntry {
  /** Storage key (or any caller-defined identifier echoed back in the plan). */
  key: string;
  createdAt: Date | string;
}

export interface RetentionPolicy {
  /** Keep the newest backup of each of the last N UTC days. */
  daily: number;
  /** Keep the newest backup of each of the last W ISO weeks (of what daily did not keep). */
  weekly: number;
  /** Keep the newest backup of each of the last M calendar months (of what remains). */
  monthly: number;
}

export interface RetentionPlan {
  /** Newest first. */
  keep: string[];
  /** Everything not kept. */
  delete: string[];
}

function toDate(value: Date | string): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** ISO-8601 week key (`2026-W41`), computed in UTC. */
export function isoWeekKey(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

type NormalizedEntry = { key: string; date: Date };

/**
 * Applies one GFS tier to the entries no earlier tier covered. Determines the newest `maxBuckets`
 * distinct buckets among `remaining` (which is sorted newest-first), keeps the newest entry in each
 * of those buckets, and removes *every* entry belonging to a selected bucket from `remaining` —
 * a backup that lost to the newest in its bucket in this tier is deleted, not promoted to the next
 * tier. Entries in buckets beyond this tier stay for the following (coarser) tier.
 */
function takeTier(
  remaining: NormalizedEntry[],
  bucketOf: (date: Date) => string,
  maxBuckets: number,
  kept: Set<string>,
): void {
  if (maxBuckets <= 0) return;
  const selectedBuckets = new Set<string>();
  for (const entry of remaining) {
    if (selectedBuckets.size >= maxBuckets) break;
    selectedBuckets.add(bucketOf(entry.date));
  }
  // Iterate newest-first (remaining is sorted desc): the first entry seen in a selected bucket is
  // the newest, so it is kept while every later entry in the same bucket is dropped.
  const keptBuckets = new Set<string>();
  const next: NormalizedEntry[] = [];
  for (const entry of remaining) {
    const bucket = bucketOf(entry.date);
    if (!selectedBuckets.has(bucket)) {
      next.push(entry);
      continue;
    }
    if (!keptBuckets.has(bucket)) {
      kept.add(entry.key);
      keptBuckets.add(bucket);
    }
  }
  remaining.length = 0;
  remaining.push(...next);
}

export function planRetention(entries: readonly RetentionEntry[], policy: RetentionPolicy): RetentionPlan {
  const valid: NormalizedEntry[] = [];
  const invalid: string[] = [];
  for (const entry of entries) {
    const date = toDate(entry.createdAt);
    if (date) {
      valid.push({ key: entry.key, date });
    } else {
      // An unparseable timestamp cannot be classified; prune it (it can never be a valid restore
      // target anyway once its manifest is unreadable).
      invalid.push(entry.key);
    }
  }
  valid.sort((a, b) => b.date.getTime() - a.date.getTime());

  const kept = new Set<string>();
  const remaining: NormalizedEntry[] = [...valid];

  takeTier(remaining, dayKey, policy.daily, kept);
  takeTier(remaining, isoWeekKey, policy.weekly, kept);
  takeTier(remaining, monthKey, policy.monthly, kept);

  const newest = valid[0];
  if (newest) kept.add(newest.key);

  const deleteKeys = [...valid.filter((entry) => !kept.has(entry.key)).map((entry) => entry.key), ...invalid];
  const keepKeys = valid.filter((entry) => kept.has(entry.key)).map((entry) => entry.key);

  return { keep: keepKeys, delete: deleteKeys };
}
