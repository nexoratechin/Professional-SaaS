import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AttendanceDevicesService } from './attendance-devices.service';
import { DeviceSecretCipher } from '../../../common/security/device-secret-cipher';

const TEST_KEY = 'a'.repeat(64);

function makeCipher(): DeviceSecretCipher {
  return new DeviceSecretCipher({ get: (key: string) => (key === 'DEVICE_SECRET_KEY' ? TEST_KEY : undefined) } as never);
}

/** A cipher reused to mint the encrypted push token stored on test devices. */
const tokenCipher = makeCipher();

function connectedDevice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'd1',
    code: 'MAIN-GATE',
    tenantId: 't1',
    status: 'ACTIVE',
    deviceType: 'RFID',
    authTokenEncrypted: tokenCipher.encrypt('real-device-token'),
    ...overrides,
  };
}

function makeService(device: Record<string, unknown> | null) {
  const findFirst = jest.fn().mockResolvedValue(device);
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const ingest = jest
    .fn()
    .mockResolvedValue({ received: 1, applied: 1, duplicate: 0, unmapped: 0, rejected: 0, error: 0 });

  const platformPrisma = { client: { attendanceDevice: { findFirst } } };
  const tenantPrisma = { client: { attendanceDevice: { updateMany } } };
  const ingestService = {
    deviceRules: jest.fn().mockResolvedValue({
      autoApply: true,
      gracePeriodMinutes: 10,
      ingestEnabled: true,
      deviceSyncEnabled: true,
      ingestMaxSkewSeconds: 300,
    }),
    ingest,
  };

  const service = new AttendanceDevicesService(
    tenantPrisma as never,
    platformPrisma as never,
    { record: jest.fn() } as never,
    makeCipher(),
    { canUse: jest.fn().mockResolvedValue(true) } as never,
    ingestService as never,
  );
  return { service, ingest };
}

describe('AttendanceDevicesService.ingestPushByCode (public device gateway auth)', () => {
  it('rejects when the named device does not exist', async () => {
    const { service } = makeService(null);
    await expect(
      service.ingestPushByCode('MAIN-GATE', [{ personId: '1' }], { bearerToken: 'x', signature: null, timestamp: null }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a device that has no push token configured', async () => {
    const { service } = makeService(connectedDevice({ authTokenEncrypted: null }));
    await expect(
      service.ingestPushByCode('MAIN-GATE', [], { bearerToken: 'anything', signature: null, timestamp: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('FAILS CLOSED: a request with no Authorization header is rejected (was the auth-bypass bug)', async () => {
    const { service, ingest } = makeService(connectedDevice());
    await expect(
      service.ingestPushByCode('MAIN-GATE', [{ personId: '1' }], { bearerToken: null, signature: null, timestamp: null }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects a wrong push token', async () => {
    const { service, ingest } = makeService(connectedDevice());
    await expect(
      service.ingestPushByCode('MAIN-GATE', [], { bearerToken: 'wrong', signature: null, timestamp: null }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(ingest).not.toHaveBeenCalled();
  });

  it('accepts the request when the correct push token is presented', async () => {
    const { service, ingest } = makeService(connectedDevice());
    const result = await service.ingestPushByCode('MAIN-GATE', [{ personId: '1' }], {
      bearerToken: 'real-device-token',
      signature: null,
      timestamp: null,
    });
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(result.counts.received).toBe(1);
  });

  it('rejects an event push to an inactive device even with a valid token', async () => {
    const { service } = makeService(connectedDevice({ status: 'INACTIVE' }));
    await expect(
      service.ingestPushByCode('MAIN-GATE', [], { bearerToken: 'real-device-token', signature: null, timestamp: null }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
