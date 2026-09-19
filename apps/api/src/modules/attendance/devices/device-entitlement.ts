/**
 * Maps an attendance device's capture channel to the granular entitlement key that gates it.
 * QR kiosks → attendance.qr, biometric AND RFID readers → attendance.biometric (RFID is folded
 * under the biometric entitlement so the plan catalog needs no new key), and mobile/API ingestion
 * → attendance.basic. Reused by device creation AND by the ingest pipeline, so a device whose
 * entitlement lapses mid-flight stops applying marks rather than silently succeeding.
 */
import { ENTITLEMENT_KEYS, type EntitlementKey } from '@college-erp/auth';
import { BadRequestException } from '@nestjs/common';
import type { DeviceType } from './device-constants';

const DEVICE_TYPE_ENTITLEMENT: Record<DeviceType, EntitlementKey> = {
  QR: ENTITLEMENT_KEYS.ATTENDANCE_QR,
  BIOMETRIC: ENTITLEMENT_KEYS.ATTENDANCE_BIOMETRIC,
  RFID: ENTITLEMENT_KEYS.ATTENDANCE_BIOMETRIC,
  MOBILE: ENTITLEMENT_KEYS.ATTENDANCE_BASIC,
  API: ENTITLEMENT_KEYS.ATTENDANCE_BASIC,
};

export function deviceEntitlementKey(deviceType: string): EntitlementKey {
  const key = DEVICE_TYPE_ENTITLEMENT[deviceType as DeviceType];
  if (!key) {
    throw new BadRequestException(`Unsupported attendance device type "${deviceType}".`);
  }
  return key;
}