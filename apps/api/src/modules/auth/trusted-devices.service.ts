import { Injectable, NotFoundException } from '@nestjs/common';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { SecurityEventsService } from '../security/security-events.service';
import { generateOpaqueToken, hashToken } from './token.util';
import type { RequestMeta } from './auth.service';

/** "Remember this device" bookkeeping — rows are only ever created right after an MFA challenge
 * succeeds (see MfaService.verifyChallenge), never as a substitute for one. */
@Injectable()
export class TrustedDevicesService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly securityEvents: SecurityEventsService,
  ) {}

  async findActiveMatch(tenantId: string, userId: string, rawDeviceToken: string | undefined) {
    if (!rawDeviceToken) {
      return null;
    }
    const device = await this.platformPrisma.client.trustedDevice.findUnique({
      where: { deviceTokenHash: hashToken(rawDeviceToken) },
    });
    if (!device || device.tenantId !== tenantId || device.userId !== userId) {
      return null;
    }
    if (device.revokedAt || device.expiresAt < new Date()) {
      return null;
    }
    return device;
  }

  async touch(deviceId: string, trustedDeviceDays: number): Promise<void> {
    await this.platformPrisma.client.trustedDevice.update({
      where: { id: deviceId },
      data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + trustedDeviceDays * 24 * 60 * 60 * 1000) },
    });
  }

  /** Returns the raw device token — caller (MfaService) sets it as an httpOnly cookie; only its
   * hash is ever persisted. */
  async create(tenantId: string, userId: string, meta: RequestMeta, trustedDeviceDays: number): Promise<string> {
    const rawToken = generateOpaqueToken();
    await this.platformPrisma.client.trustedDevice.create({
      data: {
        tenantId,
        userId,
        deviceTokenHash: hashToken(rawToken),
        label: meta.userAgent?.slice(0, 120),
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
        expiresAt: new Date(Date.now() + trustedDeviceDays * 24 * 60 * 60 * 1000),
      },
    });

    await this.securityEvents.record({
      scope: 'TENANT',
      tenantId,
      userId,
      eventType: 'TRUSTED_DEVICE_ADDED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return rawToken;
  }

  async list(tenantId: string, userId: string) {
    return this.platformPrisma.client.trustedDevice.findMany({
      where: { tenantId, userId, revokedAt: null },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  async revoke(tenantId: string, userId: string, deviceId: string): Promise<void> {
    const device = await this.platformPrisma.client.trustedDevice.findFirst({
      where: { id: deviceId, tenantId, userId },
    });
    if (!device) {
      throw new NotFoundException('Trusted device not found.');
    }

    await this.platformPrisma.client.trustedDevice.update({
      where: { id: deviceId },
      data: { revokedAt: new Date() },
    });

    await this.securityEvents.record({
      scope: 'TENANT',
      tenantId,
      userId,
      eventType: 'TRUSTED_DEVICE_REVOKED',
      metadata: { deviceId },
    });
  }
}
