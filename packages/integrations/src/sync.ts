/**
 * Synchronization bookkeeping — pure, testable logic for turning adapter pages into durable state.
 *
 * ## Why sync state is a ledger and not a log
 *
 * A sync that runs twice must not create duplicate records, and a sync that fails halfway must be
 * able to resume. Both need per-entity state keyed on the *provider's* id, which is what
 * `IntegrationSyncRecord` is. This module owns the two decisions that are easy to get subtly wrong
 * and are therefore worth isolating and testing:
 *
 *  - **Has this record actually changed?** Comparing a content hash means an unchanged record costs
 *    one hash computation instead of a full write + downstream event. Getting this wrong in either
 *    direction is expensive: no comparison re-writes everything every run; always-compare silently
 *    drops real updates.
 *  - **What is the outcome of this page?** Folding per-record results into a run verdict
 *    (SUCCEEDED / PARTIAL / FAILED) is a status-machine decision, not something to re-derive at
 *    three call sites.
 *
 * It has no database access — the caller persists what these functions return.
 */

import { createHash } from 'crypto';
import type { PullPage, PushOutcome } from './types';

/**
 * Stable content hash for change detection.
 *
 * Keys are sorted before hashing so a provider that reorders JSON object keys between responses
 * does not make every record look modified. Without sorting, a provider with unstable key ordering
 * would defeat change detection entirely — a subtle bug that only shows up as "nothing ever syncs
 * efficiently" against one specific vendor.
 */
export function contentHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload ?? null)).digest('hex');
}

/** Deterministic JSON: object keys sorted recursively, arrays left in order (order is meaningful). */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

export interface SyncRecordDecision {
  externalId: string;
  /** False when the stored hash matches, meaning the write can be skipped entirely. */
  changed: boolean;
  contentHash: string;
}

/**
 * Decides which records in a page actually need writing.
 *
 * `knownHashes` is keyed by externalId and comes from the caller reading existing
 * `IntegrationSyncRecord.contentHash` values. Records whose hash matches are reported
 * `changed: false` so the caller can leave them alone.
 */
export function decideRecordChanges(
  page: Pick<PullPage, 'records'>,
  knownHashes: Record<string, string | null | undefined>,
): SyncRecordDecision[] {
  return page.records.map((record) => {
    const hash = record.contentHash ?? contentHash(record.payload);
    const previous = knownHashes[record.externalId];
    return {
      externalId: record.externalId,
      // A record with no stored hash is always a change: first sight is not "unchanged".
      changed: previous !== hash,
      contentHash: hash,
    };
  });
}

export interface SyncCounters {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
}

export function emptyCounters(): SyncCounters {
  return { attempted: 0, succeeded: 0, failed: 0, skipped: 0 };
}

/** Folds per-record push outcomes into counters. Records with no externalId are skipped, not failed. */
export function countPushOutcomes(
  outcomes: PushOutcome[],
  counters: SyncCounters = emptyCounters(),
): SyncCounters {
  for (const outcome of outcomes) {
    if (!outcome.externalId) {
      counters.skipped += 1;
      continue;
    }
    counters.attempted += 1;
    if (outcome.ok) counters.succeeded += 1;
    else counters.failed += 1;
  }
  return counters;
}

/**
 * Derives the terminal run status from the counters and whether the run ran to completion.
 *
 * The rules, and why each exists:
 *  - A run that could not finish at all (an exception, no records attempted) is FAILED, never
 *    PARTIAL — PARTIAL means "we did work and some of it stuck".
 *  - Any failure with at least one success is PARTIAL. Reporting this as FAILED would hide a 99%
 *    successful 10,000-record sync behind an alarming status.
 *  - All attempted succeeded is SUCCEEDED, regardless of skipped records (a provider that returns
 *    records without ids is a warning, not a failure).
 */
export function deriveRunStatus(
  counters: SyncCounters,
  options: { completed: boolean; hasMore?: boolean },
): 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELED' {
  if (!options.completed) return 'FAILED';
  if (counters.failed === 0) return 'SUCCEEDED';
  if (counters.succeeded > 0) return 'PARTIAL';
  return counters.attempted === 0 ? 'FAILED' : 'FAILED';
}

/**
 * Whether the framework should enqueue a follow-up run.
 *
 * Only when the provider said there is more (`hasMore`) AND this run was not itself broken. Without
 * the health condition, a provider that errors on page 2 while claiming more data would spin the
 * queue forever — a self-inflicted retry storm against a system that is already failing.
 */
export function shouldContinueSync(
  status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELED',
  hasMore: boolean,
): boolean {
  return hasMore && (status === 'SUCCEEDED' || status === 'PARTIAL');
}

/** Health verdict from a run's outcome — drives Integration.healthStatus without a background job. */
export function healthFromSyncStatus(status: 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'CANCELED'): 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' {
  if (status === 'SUCCEEDED') return 'HEALTHY';
  if (status === 'PARTIAL') return 'DEGRADED';
  return 'UNHEALTHY';
}
