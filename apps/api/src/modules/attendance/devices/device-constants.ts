/**
 * Attendance device domain constants. These mirror the free-form string storage in the schema:
 * the values below are what the UI/API surface as options, while the DB columns stay open strings
 * so a new vendor/channel never needs a migration.
 */

/** Capture channels mapped onto the granular attendance entitlements (see device-entitlement). */
export const DEVICE_TYPES = ['QR', 'BIOMETRIC', 'RFID', 'MOBILE', 'API'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

/** Wire protocols the ingest / pull pipeline understands. */
export const DEVICE_PROTOCOLS = ['HTTP_PUSH', 'HTTP_PULL', 'TCP', 'MQTT', 'MANUAL'] as const;
export type DeviceProtocol = (typeof DEVICE_PROTOCOLS)[number];

export const DEVICE_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

/** Person-kind a device mapping may point at. */
export const DEVICE_MAPPING_TYPES = ['STUDENT', 'USER'] as const;
export type DeviceMappingType = (typeof DEVICE_MAPPING_TYPES)[number];

/** Canonical normalized event types emitted by device normalizers. */
export const DEVICE_EVENT_TYPES = ['IN', 'OUT', 'SCAN'] as const;
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];

/** Lifecycle statuses of an attendance device log row traversing the ingest pipeline. */
export const DEVICE_LOG_STATUSES = ['QUEUED', 'APPLIED', 'DUPLICATE', 'UNMAPPED', 'REJECTED', 'ERROR'] as const;
export type DeviceLogStatus = (typeof DEVICE_LOG_STATUSES)[number];

/** How an event reached us — API push, device pull, manual upload. */
export const DEVICE_INGEST_SOURCES = ['API', 'PULL', 'PUSH', 'MANUAL'] as const;
export type DeviceIngestSource = (typeof DEVICE_INGEST_SOURCES)[number];

/** markMethod value stamped onto StudentAttendance/FacultyAttendance by this pipeline. */
export const DEVICE_MARK_METHOD = 'DEVICE';

/** Manual marks are never silently overwritten by the device pipeline. */
export const MANUAL_MARK_METHOD = 'MANUAL';