/* eslint-disable @typescript-eslint/no-explicit-any */
import { UnauthorizedException } from '@nestjs/common';
import { DeviceIngestService } from './device-ingest.service';
import { buildDeviceDedupeKey } from './device-dedupe';
import { TenantScopedPrismaService } from '../../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../../audit/audit.service';
import { DeviceSecretCipher } from '../../../common/security/device-secret-cipher';
import { EntitlementsGatewayService } from '../../rbac/entitlements-gateway.service';

function makeClient() {
  const client: Record<string, any> = {
    attendanceDeviceLog: {
      findMany: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    attendanceDevice: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    attendanceSession: { findMany: jest.fn() },
    courseRegistration: { findMany: jest.fn() },
    studentEnrollment: { findMany: jest.fn() },
    studentAttendance: {
      findMany: jest.fn(),
      upsert: jest.fn(async (args: any) => ({ id: 'att-new', studentId: args.create.studentId, sessionId: args.create.sessionId })),
    },
    facultyAttendance: {
      upsert: jest.fn(async (args: any) => ({ id: 'fa-new', userId: args.create.userId, date: args.create.date })),
    },
    attendanceDeviceUser: { findMany: jest.fn() },
    tenantConfiguration: { findFirst: jest.fn() },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };
  return client;
}

describe('DeviceIngestService', () => {
  let client: Record<string, any>;
  let service: DeviceIngestService;
  const entitlements = { canUse: jest.fn() };
  const cipher = { verifyHmacSignature: jest.fn().mockReturnValue(true) } as unknown as DeviceSecretCipher;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const device = { id: 'dev-1', code: 'QR-1', deviceType: 'QR', status: 'ACTIVE' };
  const tenantId = 'tenant-1';

  function config(data: Record<string, unknown> = {}) {
    client.tenantConfiguration.findFirst.mockResolvedValue({
      data: {
        attendance: {
          autoApplyDeviceMarks: true,
          gracePeriodMinutes: 10,
          deviceIngestEnabled: true,
          deviceSyncEnabled: true,
          ingestMaxSkewSeconds: 300,
          ...data,
        },
      },
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    client = makeClient();
    const tenantPrisma = { client } as unknown as TenantScopedPrismaService;
    service = new DeviceIngestService(tenantPrisma, audit, cipher, entitlements as unknown as EntitlementsGatewayService);
    entitlements.canUse.mockResolvedValue(true);
  });

  it('applies a mapped DEVICE mark to a student attendance session', async () => {
    config();
    client.attendanceDeviceLog.findMany.mockResolvedValue([]);
    client.attendanceDeviceLog.create.mockImplementation(async (args: any) => ({ id: 'log-1', ...args.data }));
    client.attendanceDeviceUser.findMany.mockResolvedValue([
      { externalPersonId: 'ST-1', mappedType: 'STUDENT', studentId: 'st-1', userId: null },
    ]);
    client.attendanceSession.findMany.mockResolvedValue([
      {
        id: 's1',
        date: new Date('2026-09-01T00:00:00Z'),
        courseOfferingId: 'co-1',
        sectionId: null,
        startTime: '09:00',
        endTime: '11:00',
        attendanceType: 'CLASS',
        termId: 't1',
        subjectCode: 'CS101',
        subjectName: 'CS 101',
      },
    ]);
    client.courseRegistration.findMany.mockResolvedValue([{ courseOfferingId: 'co-1', studentId: 'st-1' }]);
    client.studentEnrollment.findMany.mockResolvedValue([]);
    client.studentAttendance.findMany.mockResolvedValue([]);

    const counts = await service.ingest({
      tenantId,
      device,
      source: 'PUSH',
      rows: [{ externalPersonId: 'ST-1', capturedAt: '2026-09-01T09:30:00Z', eventType: 'IN' }],
      actorUserId: 'user-1',
    });

    expect(counts).toMatchObject({ received: 1, applied: 1, duplicate: 0, unmapped: 0, rejected: 0, error: 0 });

    const createArgs = client.attendanceDeviceLog.create.mock.calls[0][0].data;
    expect(createArgs.status).toBe('QUEUED');
    expect(createArgs.dedupeKey).toBeTruthy();

    const upsertArgs = client.studentAttendance.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({ tenantId_sessionId_studentId: { tenantId, sessionId: 's1', studentId: 'st-1' } });
    expect(upsertArgs.create.markMethod).toBe('DEVICE');
    expect(upsertArgs.create.status).toBe('PRESENT');

    const logUpdate = client.attendanceDeviceLog.update.mock.calls.find((c: any) => c[0].where?.id === 'log-1')[0].data;
    expect(logUpdate.status).toBe('APPLIED');
    expect(logUpdate).toMatchObject({ sessionId: 's1', appliedRecordId: 'att-new' });
  });

  it('marks a session late when captured after end + grace', async () => {
    config();
    client.attendanceDeviceLog.findMany.mockResolvedValue([]);
    client.attendanceDeviceLog.create.mockImplementation(async (args: any) => ({ id: 'log-1', ...args.data }));
    client.attendanceDeviceUser.findMany.mockResolvedValue([
      { externalPersonId: 'ST-1', mappedType: 'STUDENT', studentId: 'st-1', userId: null },
    ]);
    client.attendanceSession.findMany.mockResolvedValue([
      { id: 's1', date: new Date('2026-09-01T00:00:00Z'), courseOfferingId: 'co-1', sectionId: null, startTime: '09:00', endTime: '11:00', attendanceType: 'CLASS', termId: 't1', subjectCode: 'CS101', subjectName: 'CS 101' },
    ]);
    client.courseRegistration.findMany.mockResolvedValue([{ courseOfferingId: 'co-1', studentId: 'st-1' }]);
    client.studentEnrollment.findMany.mockResolvedValue([]);
    client.studentAttendance.findMany.mockResolvedValue([]);

    await service.ingest({
      tenantId,
      device,
      source: 'PUSH',
      rows: [{ externalPersonId: 'ST-1', capturedAt: '2026-09-01T11:20:00Z', eventType: 'IN' }],
    });

    expect(client.studentAttendance.upsert).toHaveBeenCalledTimes(1);
    expect(client.studentAttendance.upsert.mock.calls[0][0].create.status).toBe('LATE');
  });

  it('flags UNMAPPED events and does not create attendance', async () => {
    config();
    client.attendanceDeviceLog.findMany.mockResolvedValue([]);
    client.attendanceDeviceLog.create.mockImplementation(async (args: any) => ({ id: 'log-1', ...args.data }));
    client.attendanceDeviceUser.findMany.mockResolvedValue([]);

    const counts = await service.ingest({
      tenantId,
      device,
      source: 'API',
      rows: [{ externalPersonId: 'FP-999', capturedAt: '2026-09-01T09:30:00Z', eventType: 'IN' }],
    });

    expect(counts.unmapped).toBe(1);
    expect(client.studentAttendance.upsert).not.toHaveBeenCalled();
    const logUpdate = client.attendanceDeviceLog.update.mock.calls[0][0].data;
    expect(logUpdate.status).toBe('UNMAPPED');
  });

  it('counts dedupe duplicates without creating or applying them', async () => {
    config();
    const key = buildDeviceDedupeKey({ deviceId: 'dev-1', externalPersonId: 'ST-1', eventType: 'IN', capturedAt: new Date('2026-09-01T09:30:00Z') });
    client.attendanceDeviceLog.findMany.mockResolvedValue([{ dedupeKey: key }]);

    const counts = await service.ingest({
      tenantId,
      device,
      source: 'PUSH',
      rows: [{ externalPersonId: 'ST-1', capturedAt: '2026-09-01T09:30:00Z', eventType: 'IN' }],
    });

    expect(counts.duplicate).toBe(1);
    expect(counts.applied).toBe(0);
    expect(client.attendanceDeviceLog.create).not.toHaveBeenCalled();
  });

  it('preserves an existing MANUAL mark instead of overwriting it', async () => {
    config();
    client.attendanceDeviceLog.findMany.mockResolvedValue([]);
    client.attendanceDeviceLog.create.mockImplementation(async (args: any) => ({ id: 'log-1', ...args.data }));
    client.attendanceDeviceUser.findMany.mockResolvedValue([
      { externalPersonId: 'ST-1', mappedType: 'STUDENT', studentId: 'st-1', userId: null },
    ]);
    client.attendanceSession.findMany.mockResolvedValue([
      { id: 's1', date: new Date('2026-09-01T00:00:00Z'), courseOfferingId: 'co-1', sectionId: null, startTime: '09:00', endTime: '11:00', attendanceType: 'CLASS', termId: 't1', subjectCode: 'CS101', subjectName: 'CS 101' },
    ]);
    client.courseRegistration.findMany.mockResolvedValue([{ courseOfferingId: 'co-1', studentId: 'st-1' }]);
    client.studentEnrollment.findMany.mockResolvedValue([]);
    client.studentAttendance.findMany.mockResolvedValue([
      { id: 'att-manual', sessionId: 's1', studentId: 'st-1', markMethod: 'MANUAL', status: 'PRESENT' },
    ]);

    const counts = await service.ingest({
      tenantId,
      device,
      source: 'PUSH',
      rows: [{ externalPersonId: 'ST-1', capturedAt: '2026-09-01T09:30:00Z', eventType: 'IN' }],
    });

    expect(counts.applied).toBe(1);
    expect(client.studentAttendance.upsert).not.toHaveBeenCalled();
    const logUpdate = client.attendanceDeviceLog.update.mock.calls[0][0].data;
    expect(logUpdate.status).toBe('APPLIED');
    expect(logUpdate.appliedRecordId).toBe('att-manual');
    expect(logUpdate.processingNote).toMatch(/preserved/i);
  });

  it('persists ERROR logs for rows that fail normalization', async () => {
    config();
    client.attendanceDeviceLog.create.mockImplementation(async (args: any) => ({ id: 'log-err', ...args.data }));

    const counts = await service.ingest({
      tenantId,
      device,
      source: 'API',
      rows: [{ externalPersonId: '   ', capturedAt: 'not-a-date', eventType: 'IN' }],
    });

    expect(counts.received).toBe(1);
    expect(counts.error).toBe(1);
    const errLog = client.attendanceDeviceLog.create.mock.calls[0][0].data;
    expect(errLog.status).toBe('ERROR');
  });

  it('rejects a push whose HMAC timestamp is outside the skew window', async () => {
    config({ ingestMaxSkewSeconds: 300 });
    const veryOldTimestamp = String(Math.floor(Date.now() / 1000) - 10_000);

    await expect(
      service.ingest({
        tenantId,
        device,
        source: 'PUSH',
        rows: [{ externalPersonId: 'ST-1', capturedAt: '2026-09-01T09:30:00Z', eventType: 'IN' }],
        verifyHmac: {
          canonicalBody: '{}',
          signature: 'a'.repeat(64),
          timestamp: veryOldTimestamp,
          secret: 'tok',
          maxSkewSeconds: 300,
        },
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects a device whose tenant lost its QR entitlement', async () => {
    entitlements.canUse.mockResolvedValue(false);
    await expect(
      service.ingest({ tenantId, device, source: 'PUSH', rows: [] }),
    ).rejects.toThrow(/entitled/i);
  });

  it('rejects ingest when tenant ingestion is disabled', async () => {
    config({ deviceIngestEnabled: false });
    await expect(
      service.ingest({ tenantId, device, source: 'PUSH', rows: [] }),
    ).rejects.toThrow(/disabled/i);
  });
});