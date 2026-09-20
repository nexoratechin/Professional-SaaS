/**
 * Vendor payload normalizers — the single funnel that turns arbitrary device/vendor payloads into
 * canonical attendance events (externalPersonId + capturedAt + eventType). Vendor-neutral by
 * design: every vendor's wire format is handled here (or in a registered adapter that reduces to
 * raw events) so the ERP never depends on one biometric vendor. Normalization failures are kept
 * as ERROR device logs rather than dropped, so operators can see every rejected event.
 */
import { normalizeExternalPersonId } from './device-dedupe';
import type { DeviceEventType } from './device-constants';

export interface NormalizedDeviceEvent {
  externalPersonId: string | null;
  capturedAt: Date | null;
  eventType: DeviceEventType;
}

export interface NormalizationResult {
  /** Successfully normalized events (may be empty). */
  events: NormalizedDeviceEvent[];
  /** Per-input messages for inputs that failed to normalize (surfaced as ERROR logs). */
  rejected: Array<{ reason: string }>;
}

const EVENT_HINTS = ['IN', 'OUT', 'SCAN'] as const;

function isEventType(value: unknown): value is DeviceEventType {
  return typeof value === 'string' && (EVENT_HINTS as readonly string[]).includes(value.toUpperCase());
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value as string | number);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function pickPersonId(obj: Record<string, unknown>): string | null {
  for (const key of ['externalPersonId', 'external_person_id', 'id', 'empId', 'employeeId', 'pin', 'PIN', 'card', 'cardNo', 'cardNumber', 'rfid', 'userId', 'userNo', 'fingerId', 'enrollId', 'badge']) {
    if (obj[key] !== undefined && obj[key] !== null && typeof obj[key] !== 'object') {
      const normalized = normalizeExternalPersonId(String(obj[key]));
      if (normalized) return normalized;
    }
  }
  return null;
}

/** ZKTeco attendance log row: PIN / Time / Status (0 = in, 1 = out, other = scan). */
function fromZkteco(obj: Record<string, unknown>): NormalizedDeviceEvent | { error: string } {
  const externalPersonId = pickPersonId(obj);
  const capturedAt = asDate(obj['Time'] ?? obj['time'] ?? obj['DateTime']);
  if (!externalPersonId || !capturedAt) {
    return { error: 'ZKTeco row missing PIN or Time.' };
  }
  const rawStatus = String(obj['Status'] ?? '').trim();
  let eventType: DeviceEventType;
  if (rawStatus === '0' || rawStatus === '2') eventType = 'IN';
  else if (rawStatus === '1') eventType = 'OUT';
  else eventType = 'SCAN';
  return { externalPersonId, capturedAt, eventType };
}

function fromGeneric(obj: Record<string, unknown>): NormalizedDeviceEvent | { error: string } {
  const externalPersonId = pickPersonId(obj);
  const capturedAt = asDate(obj['capturedAt'] ?? obj['captured_at'] ?? obj['time'] ?? obj['scanTime'] ?? obj['lastTime'] ?? obj['dateTime']);
  if (!externalPersonId || !capturedAt) {
    return { error: 'Event missing a person identifier or timestamp.' };
  }
  const raw = obj['eventType'] ?? obj['event_type'] ?? obj['type'] ?? obj['inOut'] ?? obj['direction'];
  const eventType: DeviceEventType = isEventType(raw) ? raw.toUpperCase() as DeviceEventType : 'SCAN';
  return { externalPersonId, capturedAt, eventType };
}

/** Normalizes one raw payload into zero-or-more canonical events. The two supported shapes are a
 * single event object and an array (or { events: [...] } / { data: [...] } wrapper). */
export function normalizeDeviceEvent(payload: unknown, vendor: string): NormalizationResult {
  const inputs: unknown[] = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)['events'])
      ? (payload as Record<string, unknown>)['events'] as unknown[]
      : payload && typeof payload === 'object' && Array.isArray((payload as Record<string, unknown>)['data'])
        ? (payload as Record<string, unknown>)['data'] as unknown[]
        : [payload];

  const events: NormalizedDeviceEvent[] = [];
  const rejected: Array<{ reason: string }> = [];

  for (const input of inputs) {
    if (!input || typeof input !== 'object') {
      rejected.push({ reason: 'Event payload is not an object.' });
      continue;
    }
    const obj = input as Record<string, unknown>;
    const vendorKey = vendor.toLowerCase();
    const result = vendorKey === 'zkteco' ? fromZkteco(obj) : fromGeneric(obj);
    if ('error' in result) {
      rejected.push({ reason: result.error });
      continue;
    }
    events.push({
      externalPersonId: result.externalPersonId,
      capturedAt: result.capturedAt,
      eventType: result.eventType,
    });
  }

  return { events, rejected };
}