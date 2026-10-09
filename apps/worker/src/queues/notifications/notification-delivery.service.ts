import { Logger } from '@nestjs/common';
import { AUDIT_ACTIONS, FEATURE_KEYS } from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient, type Notification, type Prisma } from '@college-erp/database';
import {
  bumpWindow,
  recordNotificationAttempt,
  recordNotificationFailure,
  WINDOW_COUNTERS,
} from '@college-erp/observability';
import {
  NotificationSecretCipher,
  ProviderDeliveryError,
  createNotificationProvider,
  devConsoleProviderFor,
  type NotificationProvider,
  type ProviderSendResult,
} from '@college-erp/notifications';
import { Inject, Injectable, Optional } from '@nestjs/common';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { EntitlementGate } from '../../entitlement/entitlement-gate';
import { WORKER_REDIS_CLIENT } from '../../common/observability/redis.constants';

type TenantClient = ReturnType<typeof createTenantScopedClient>;
type DeliveryLogStatus = 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED';

export interface DeliveryEvaluation {
  /** False when the notification must not be delivered (already handled: FAILED or SUPPRESSED). */
  deliver: boolean;
}

/**
 * The channel-agnostic notification delivery pipeline, shared by the orchestrating
 * NotificationsProcessor (IN_APP/PUSH) and the dedicated emails/sms/whatsapp transport processors.
 *
 * Two phases:
 *  - evaluate()  — entitlement re-check (a downgraded tenant gets no delivery) and per-user channel
 *                  preference suppression. A suppressed delivery is terminal and audited.
 *  - deliver()   — provider resolution (tenant config, credentials decrypted with
 *                  NOTIFICATION_SECRET_KEY, dev console fallback), recipient address resolution,
 *                  the provider send loop, per-attempt NotificationDeliveryLog rows, and the
 *                  terminal SENT/FAILED status + audit.
 *
 * Failure semantics: transient failures are rethrown so BullMQ retries with backoff; permanent
 * failures (bad config, missing address, 4xx) mark the row FAILED immediately.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger(NotificationDeliveryService.name);

  constructor(
    private readonly entitlementGate: EntitlementGate,
    private readonly appConfig: AppConfigService,
    @Optional() @Inject(WORKER_REDIS_CLIENT) private readonly redis?: Redis,
  ) {}

  /** Entitlement + preference gate. Mutates the row to FAILED/SUPPRESSED when it must not deliver. */
  async evaluate(tenantClient: TenantClient, notification: Notification): Promise<DeliveryEvaluation> {
    if (!(await this.entitlementGate.isFeatureEnabled(notification.tenantId, FEATURE_KEYS.NOTIFICATIONS))) {
      await this.fail(tenantClient, notification, "Tenant's plan no longer includes the notifications module.");
      return { deliver: false };
    }

    if (notification.recipientUserId) {
      const preference = await tenantClient.notificationPreference.findUnique({
        where: {
          tenantId_userId_channel: {
            tenantId: notification.tenantId,
            userId: notification.recipientUserId,
            channel: notification.channel,
          },
        },
      });
      if (preference && !preference.enabled) {
        await tenantClient.notification.update({
          where: { id: notification.id },
          data: { status: 'SUPPRESSED', lastAttemptAt: new Date() },
        });
        await this.recordDeliveryLog(tenantClient, notification, 'SUPPRESSED', 'preference', null, {
          reason: `User disabled ${notification.channel} channel.`,
        });
        await this.audit(notification.tenantId, notification.id, AUDIT_ACTIONS.NOTIFICATION_SUPPRESSED);
        this.logger.debug(`Suppressed ${notification.channel} notification ${notification.id} per user preference.`);
        return { deliver: false };
      }
    }

    return { deliver: true };
  }

  /** Perform the send. Throws on transient failure so the caller's queue retries with backoff. */
  async deliver(tenantClient: TenantClient, notification: Notification): Promise<void> {
    try {
      const { provider, providerName } = await this.resolveProvider(notification);
      const addresses = await this.resolveAddresses(tenantClient, notification);

      this.logger.log(
        `Delivering ${notification.channel} notification ${notification.id} to user ` +
          `${notification.recipientUserId} (tenant ${notification.tenantId}): "${notification.subject}"`,
      );

      const attemptStartedAt = Date.now();
      const attemptNumber = notification.attempts + 1;
      const results: ProviderSendResult[] = [];

      for (const address of addresses) {
        try {
          const result = await provider.send({
            channel: notification.channel,
            to: address,
            subject: notification.subject ?? undefined,
            body: notification.body,
          });
          results.push(result);

          const logStatus: DeliveryLogStatus = notification.channel === 'IN_APP' ? 'DELIVERED' : 'SENT';
          await this.recordDeliveryLog(tenantClient, notification, logStatus, providerName, result.providerMessageId ?? null, {
            attempt: attemptNumber,
            latencyMs: Date.now() - attemptStartedAt,
            to: maskAddress(address),
          });
        } catch (error) {
          if (error instanceof ProviderDeliveryError) throw error;
          throw new ProviderDeliveryError(
            `Provider threw a non-delivery error: ${error instanceof Error ? error.message : 'unknown'}`,
            true,
            error,
          );
        }
      }

      const providerMessageId = results.map((r) => r.providerMessageId).find(Boolean) ?? null;
      await tenantClient.notification.update({
        where: { id: notification.id },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          provider: providerName,
          providerMessageId,
          attempts: attemptNumber,
          lastAttemptAt: new Date(),
          error: null,
        },
      });
      await this.audit(notification.tenantId, notification.id, AUDIT_ACTIONS.NOTIFICATION_DELIVERED);
      recordNotificationAttempt(notification.channel, 'sent');
    } catch (error) {
      const attemptNumber = notification.attempts + 1;
      const retryable = error instanceof ProviderDeliveryError ? error.retryable : true;
      const message = error instanceof Error ? error.message : 'Unknown delivery error';

      await this.recordDeliveryLog(tenantClient, notification, 'FAILED', notification.provider ?? 'unknown', null, {
        attempt: attemptNumber,
        error: message,
      });

      recordNotificationAttempt(notification.channel, 'failed');
      recordNotificationFailure(notification.channel, notification.provider ?? 'unknown', !retryable);
      if (!retryable) {
        // Terminal delivery failure — feed the cross-process alert window. Retryable failures are
        // deliberately excluded: they are expected noise that BullMQ retries with backoff.
        this.bumpFailureWindow();
      }

      if (retryable) {
        await tenantClient.notification.update({
          where: { id: notification.id },
          data: { attempts: attemptNumber, lastAttemptAt: new Date() },
        });
        throw error;
      }

      await this.fail(tenantClient, notification, message, attemptNumber);
    }
  }

  private bumpFailureWindow(): void {
    if (!this.redis) return;
    void bumpWindow(this.redis, WINDOW_COUNTERS.notificationFailures).catch(() => undefined);
  }

  /** Picks the tenant's active provider for the notification's channel, with dev/VAPID fallbacks. */
  private async resolveProvider(
    notification: Notification & { tenantId: string },
  ): Promise<{ provider: NotificationProvider; providerName: string }> {
    const tenantClient = createTenantScopedClient(notification.tenantId);
    const row = await tenantClient.notificationProviderConfig.findFirst({
      where: { tenantId: notification.tenantId, channel: notification.channel, isActive: true },
      orderBy: { isDefault: 'desc' },
    });

    const vapid = this.vapidConfig();
    const isDev = this.appConfig.get('NODE_ENV') === 'development';

    if (!row) {
      if (notification.channel === 'PUSH' && vapid) {
        return {
          provider: createNotificationProvider({ channel: 'PUSH', provider: 'web_push', config: vapid, credentials: {} }),
          providerName: 'web_push',
        };
      }
      if (isDev) {
        return { provider: devConsoleProviderFor(notification.channel), providerName: 'console' };
      }
      throw new ProviderDeliveryError(
        `No active provider configured for ${notification.channel} in this tenant. Set up notification_provider_configs.`,
        false,
      );
    }

    const credentials = this.decryptCredentials(row.credentialsEncrypted);
    const config = (row.config as Record<string, unknown> | null) ?? {};
    const mergedConfig =
      notification.channel === 'PUSH' && row.provider === 'web_push' ? { ...vapid, ...config } : config;

    let provider: NotificationProvider;
    try {
      provider = createNotificationProvider(
        { channel: notification.channel, provider: row.provider, config: mergedConfig, credentials },
        { allowDevFallback: isDev },
      );
    } catch (error) {
      throw new ProviderDeliveryError(
        error instanceof Error ? error.message : 'Notification provider configuration is invalid.',
        false,
        error,
      );
    }
    return { provider, providerName: row.provider };
  }

  private vapidConfig(): { subject: string; publicKey: string; privateKey: string } | undefined {
    const publicKey = this.appConfig.get('VAPID_PUBLIC_KEY');
    const privateKey = this.appConfig.get('VAPID_PRIVATE_KEY');
    if (!publicKey || !privateKey) return undefined;
    return { subject: this.appConfig.get('VAPID_SUBJECT'), publicKey, privateKey };
  }

  private decryptCredentials(credentialsEncrypted: string | null): Record<string, unknown> {
    if (!credentialsEncrypted) return {};
    try {
      return JSON.parse(
        new NotificationSecretCipher(this.appConfig.get('NOTIFICATION_SECRET_KEY')).decrypt(credentialsEncrypted),
      ) as Record<string, unknown>;
    } catch (error) {
      throw new ProviderDeliveryError(
        `Failed to decrypt provider credentials: ${error instanceof Error ? error.message : 'unknown error'}`,
        false,
        error,
      );
    }
  }

  /** Resolves the concrete address(es) for the notification's recipient. Missing ⇒ terminal. */
  private async resolveAddresses(tenantClient: TenantClient, notification: Notification): Promise<string[]> {
    if (notification.channel === 'IN_APP') {
      return [notification.recipientUserId ?? ''];
    }
    if (!notification.recipientUserId) {
      throw new ProviderDeliveryError(`Recipient user missing for ${notification.channel} notification.`, false);
    }

    const user = await tenantClient.user.findFirst({ where: { id: notification.recipientUserId } });
    if (!user) {
      throw new ProviderDeliveryError('Recipient user no longer exists in this tenant.', false);
    }

    switch (notification.channel) {
      case 'EMAIL':
        if (!user.email) throw new ProviderDeliveryError('Recipient has no email address.', false);
        return [user.email];
      case 'SMS':
      case 'WHATSAPP':
        if (!user.phone) throw new ProviderDeliveryError('Recipient has no phone number.', false);
        return [user.phone];
      case 'PUSH': {
        const devices = await tenantClient.userPushDevice.findMany({ where: { userId: user.id } });
        if (devices.length === 0) throw new ProviderDeliveryError('Recipient has no registered push devices.', false);
        return devices.map((device) => device.deviceToken);
      }
      default:
        return [];
    }
  }

  private async fail(
    tenantClient: TenantClient,
    notification: Notification,
    message: string,
    attempts?: number,
  ): Promise<void> {
    await tenantClient.notification.update({
      where: { id: notification.id },
      data: {
        status: 'FAILED',
        error: message,
        lastAttemptAt: new Date(),
        ...(attempts === undefined ? {} : { attempts }),
      },
    });
    await this.audit(notification.tenantId, notification.id, AUDIT_ACTIONS.NOTIFICATION_FAILED);
  }

  private async recordDeliveryLog(
    tenantClient: TenantClient,
    notification: Notification,
    status: DeliveryLogStatus,
    provider: string,
    providerMessageId: string | null,
    extra: Prisma.InputJsonObject,
  ): Promise<void> {
    await tenantClient.notificationDeliveryLog.create({
      data: {
        tenantId: notification.tenantId,
        notificationId: notification.id,
        channel: notification.channel,
        provider,
        status,
        providerMessageId,
        request: { to: notification.recipientUserId, channel: notification.channel },
        response: extra,
      },
    });
  }

  private async audit(tenantId: string, entityId: string, action: string): Promise<void> {
    await platformPrismaClient.platformAuditLog.create({
      data: { scope: 'TENANT', tenantId, actorType: 'SYSTEM', action, entityType: 'Notification', entityId },
    });
  }
}

/** Keep PII out of logs: show only the first/last chars of an address. */
export function maskAddress(address: string): string {
  if (address.length <= 4) return '••••';
  return `${address.slice(0, 2)}•••${address.slice(-2)}`;
}
