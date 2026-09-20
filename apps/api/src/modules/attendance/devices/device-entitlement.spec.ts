import { deviceEntitlementKey } from './device-entitlement';

describe('device-entitlement', () => {
  it('maps each capture channel to the granular attendance entitlement', () => {
    expect(deviceEntitlementKey('QR')).toBe('attendance.qr');
    expect(deviceEntitlementKey('BIOMETRIC')).toBe('attendance.biometric');
    expect(deviceEntitlementKey('RFID')).toBe('attendance.biometric');
    expect(deviceEntitlementKey('MOBILE')).toBe('attendance.basic');
    expect(deviceEntitlementKey('API')).toBe('attendance.basic');
  });

  it('throws for an unrecognized device type', () => {
    expect(() => deviceEntitlementKey('GPS')).toThrow();
  });
});