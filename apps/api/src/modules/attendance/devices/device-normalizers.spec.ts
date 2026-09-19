import { normalizeDeviceEvent } from './device-normalizers';

describe('device-normalizers', () => {
  it('normalizes a single generic event', () => {
    const { events, rejected } = normalizeDeviceEvent(
      { externalPersonId: 'FP-1', capturedAt: '2026-09-01T09:00:00Z', eventType: 'IN' },
      'hsm',
    );
    expect(events).toEqual([{ externalPersonId: 'FP-1', capturedAt: new Date('2026-09-01T09:00:00Z'), eventType: 'IN' }]);
    expect(rejected).toHaveLength(0);
  });

  it('normalizes an array payload and a wrapped { events } payload', () => {
    const arrayNorm = normalizeDeviceEvent(
      [
        { id: 'A', time: '2026-09-01T09:00:00Z', inOut: 'out' },
        { id: 'B', time: '2026-09-01T09:05:00Z' },
      ],
      'generic-vendor',
    );
    expect(arrayNorm.events).toHaveLength(2);
    expect(arrayNorm.events[0]?.eventType).toBe('OUT');

    const wrappedNorm = normalizeDeviceEvent({ events: [{ pin: '999', Time: '2026-09-01T09:00:00Z', Status: 0 }] }, 'zkteco');
    expect(wrappedNorm.events).toHaveLength(1);
    expect(wrappedNorm.events[0]?.externalPersonId).toBe('999');
  });

  it('maps ZKTeco Status 0 -> IN, 1 -> OUT, 2 -> IN', () => {
    expect(normalizeDeviceEvent({ PIN: '12', Time: '2026-09-01T09:00:00Z', Status: 0 }, 'ZKTeco').events[0]?.eventType).toBe('IN');
    expect(normalizeDeviceEvent({ PIN: '12', Time: '2026-09-01T09:00:00Z', Status: 1 }, 'ZKteco').events[0]?.eventType).toBe('OUT');
    expect(normalizeDeviceEvent({ PIN: '12', Time: '2026-09-01T09:00:00Z', Status: 2 }, 'zkteco').events[0]?.eventType).toBe('IN');
  });

  it('normalizes external person ids (trim/uppercase, aliases)', () => {
    const { events } = normalizeDeviceEvent({ badge: '  fp-77 ', scanTime: '2026-09-01T09:00:00Z' }, 'acme');
    expect(events[0]?.externalPersonId).toBe('FP-77');
  });

  it('rejects inputs missing a person id or timestamp', () => {
    const { events, rejected } = normalizeDeviceEvent(
      { capturedAt: '2026-09-01T09:00:00Z' },
      'acme',
    );
    expect(events).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/person identifier or timestamp/i);
  });

  it('rejects a malformed ZKTeco row', () => {
    const { events, rejected } = normalizeDeviceEvent({ PIN: '12' }, 'zkteco');
    expect(events).toHaveLength(0);
    expect(rejected[0]?.reason).toMatch(/missing PIN or Time/i);
  });

  it('rejects non-object inputs', () => {
    const { events, rejected } = normalizeDeviceEvent([42], 'acme');
    expect(events).toHaveLength(0);
    expect(rejected).toHaveLength(1);
  });
});