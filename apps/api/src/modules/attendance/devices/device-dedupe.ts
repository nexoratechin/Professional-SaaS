/**
 * Device-event identity & deduplication — pure helpers.
 *
 * Every incoming device event is deterministically keyed by (device, person, eventType,
 * capturedAt). The key is stored on AttendanceDeviceLog.dedupeKey and backed by a unique index
 * (tenantId, dedupeKey), which is the hard duplicate-prevention boundary at the DB level — the
 * same event re-pushed by a device, a retried HTTP request, or a pull-then-push race collapses
 * into one row. Nullable-key semantics allow a malformed/un-keyed event through as a first-class
 * row while still blocking clones.
 */
import { createHash } from 'crypto';

/** Stable canonical form of a device-side person identifier (fingerprint id, card/RFID hex,
 * PIN, mobile registration id). */
export function normalizeExternalPersonId(value: string | null | undefined): string | null {
  if (value == null) return null;
  const cleaned = String(value).trim().toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/** Replays an event like a shared secret — if a device double-fires, this must not collide. */
export function buildDeviceDedupeKey(opts: {
  deviceId: string;
  externalPersonId: string;
  eventType: string;
  capturedAt: Date | string;
}): string {
  const at = opts.capturedAt instanceof Date ? opts.capturedAt.toISOString() : new Date(opts.capturedAt).toISOString();
  const canonical = [opts.deviceId, opts.externalPersonId, opts.eventType, at].join('|');
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Canonical body string used for the optional HMAC push signature. Won't byte-match an arbitrary
 * device payload — devices that sign use this exact canonicalization on their side. */
export function canonicalizePersistedEvents(deviceCode: string, events: Array<Record<string, unknown>>): string {
  return JSON.stringify({ code: deviceCode, events });
}