import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type NotificationJobData } from '@college-erp/types';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { SecurityEventsService } from '../security/security-events.service';
import { TrustedDevicesService } from './trusted-devices.service';
import type { RequestMeta } from './auth.service';

export interface RiskAssessment {
  isNewDevice: boolean;
  trustedDevice: Awaited<ReturnType<TrustedDevicesService['findActiveMatch']>>;
}

/**
 * Heuristic-based "is this a device/location we've seen before for this user" assessment — NOT
 * full geolocation (no GeoIP database/service is wired up in this environment; see the
 * project-wide pattern of documenting infra that doesn't exist yet rather than half-building
 * around it). A login counts as "seen before" if either a matching TrustedDevice cookie is
 * presented, or an identical (ipAddress, userAgent) pair has a prior SUCCESS LoginEvent for this
 * exact tenant+email. Everything else is flagged as a new device.
 */
@Injectable()
export class LoginRiskService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly securityEvents: SecurityEventsService,
    private readonly trustedDevices: TrustedDevicesService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationsQueue: Queue<NotificationJobData>,
  ) {}

  async assess(
    tenantId: string,
    user: { id: string; email: string },
    meta: RequestMeta,
    rawDeviceToken: string | undefined,
  ): Promise<RiskAssessment> {
    const trustedDevice = await this.trustedDevices.findActiveMatch(tenantId, user.id, rawDeviceToken);
    if (trustedDevice) {
      return { isNewDevice: false, trustedDevice };
    }

    const priorSuccess = await this.platformPrisma.client.loginEvent.findFirst({
      where: {
        tenantId,
        emailAttempted: user.email,
        result: 'SUCCESS',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    return { isNewDevice: !priorSuccess, trustedDevice: null };
  }

  /** Fire only for logins that actually completed (never for one that stalled at an MFA
   * challenge that was never verified) — queued the same way NotificationsService does, through
   * a Notification row + a `deliver` job carrying only ids, never the message body itself. */
  async notifyNewDevice(
    tenantId: string,
    user: { id: string; email: string; fullName: string },
    meta: RequestMeta,
  ): Promise<void> {
    const locationHint = [meta.ipAddress, meta.userAgent].filter(Boolean).join(' — ');
    const notification = await this.platformPrisma.client.notification.create({
      data: {
        tenantId,
        recipientUserId: user.id,
        channel: 'IN_APP',
        subject: 'New sign-in to your account',
        body:
          `We noticed a new sign-in to your account${locationHint ? ` from ${locationHint}` : ''}. ` +
          "If this wasn't you, change your password immediately and review your active sessions.",
      },
    });
    await this.notificationsQueue.add('deliver', { tenantId, notificationId: notification.id });

    await this.securityEvents.record({
      scope: 'TENANT',
      tenantId,
      userId: user.id,
      eventType: 'NEW_DEVICE_LOGIN',
      severity: 'WARNING',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }
}
