import { buildDeviceDedupeKey, canonicalizePersistedEvents, normalizeExternalPersonId } from './device-dedupe';

describe('device-dedupe', () => {
  describe('normalizeExternalPersonId', () => {
    it('trims, uppercases and collapses surrounding whitespace', () => {
      expect(normalizeExternalPersonId('  ab-12  ')).toBe('AB-12');
      expect(normalizeExternalPersonId('fp-0042')).toBe('FP-0042');
    });

    it('returns null for empty/blank input', () => {
      expect(normalizeExternalPersonId('')).toBeNull();
      expect(normalizeExternalPersonId('   ')).toBeNull();
      expect(normalizeExternalPersonId(undefined)).toBeNull();
      expect(normalizeExternalPersonId(null)).toBeNull();
    });
  });

  describe('buildDeviceDedupeKey', () => {
    const base = { deviceId: 'dev-1', externalPersonId: 'FP-1', eventType: 'IN' };

    it('is deterministic for identical inputs', () => {
      const a = buildDeviceDedupeKey({ ...base, capturedAt: new Date('2026-09-01T09:00:00Z') });
      const b = buildDeviceDedupeKey({ ...base, capturedAt: '2026-09-01T09:00:00Z' });
      expect(a).toBe(b);
    });

    it('differs when person, eventType, device or capturedAt change', () => {
      const key = buildDeviceDedupeKey({ ...base, capturedAt: new Date('2026-09-01T09:00:00Z') });
      expect(buildDeviceDedupeKey({ ...base, externalPersonId: 'FP-2', capturedAt: new Date('2026-09-01T09:00:00Z') })).not.toBe(key);
      expect(buildDeviceDedupeKey({ ...base, eventType: 'OUT', capturedAt: new Date('2026-09-01T09:00:00Z') })).not.toBe(key);
      expect(buildDeviceDedupeKey({ ...base, deviceId: 'dev-2', capturedAt: new Date('2026-09-01T09:00:00Z') })).not.toBe(key);
      expect(buildDeviceDedupeKey({ ...base, capturedAt: new Date('2026-09-01T09:01:00Z') })).not.toBe(key);
    });

    it('produces a stable sha256 hex string', () => {
      const key = buildDeviceDedupeKey({ ...base, capturedAt: new Date('2026-09-01T09:00:00Z') });
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  it('canonicalizePersistedEvents renders a stable JSON contract', () => {
    expect(canonicalizePersistedEvents('QR-1', [{ capturedAt: 'x', externalPersonId: 'FP-1' }])).toBe(
      '{"code":"QR-1","events":[{"capturedAt":"x","externalPersonId":"FP-1"}]}',
    );
  });
});