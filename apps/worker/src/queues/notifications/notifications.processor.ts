import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import type { Job } from 'bullmq';
import {
  AUDIT_ACTIONS,
  FEATURE_KEYS,
} from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient, type Notification, type Prisma } from '@college-erp/database';
import {
  NotificationSecretCipher,
  ProviderDeliveryError,
  createNotificationProvider,
  devConsoleProviderFor,
  type NotificationProvider,
  type ProviderSendResult,
} from '@college-erp/notifications';
import { QUEUE_NAMES, type NotificationJobData } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { EntitlementGate } from '../../entitlement/entitlement-gate';

type TenantClient = ReturnType<typeof createTenantScopedClient>;
type DeliveryLogStatus = 'SENT' | 'DELIVERED' | 'FAILED' | 'SUPPRESSED';

/**
 * Tenant-aware background job processing: an HTTP request gets its tenant context from
 * TenantResolutionMiddleware + TenantMatchGuard, but there is no request and no guard here —
 * the job payload (tenantId) is the only carrier. This processor refuses to run without one,
 * and rebuilds a tenant-scoped Prisma client from it for the entire job — never the raw
 * unscoped client — so a notification job can only ever read/update the tenant it was
 * enqueued for.
 *
 * Delivery pipeline (per attempt):
 *  1. entitlement re-check (last step of the pipeline — a downgraded tenant gets no delivery);
 *  2. per-user channel preference suppression;
 *  3. recipient address resolution (email / phone / push device tokens / in-app user);
 *  4. tenant provider selection (NotificationProviderConfig, credentials decrypted with
 *     NOTIFICATION_SECRET_KEY) and delivery via the channel adapter;
 *  5. append-only NotificationDeliveryLog row per attempt; status/audit on success or failure.
 *
 * Failure semantics: transient failures (network, 5xx, SMTP 4xx) throw after logging so BullMQ
 * retries the job; permanent failures (4xx, missing address/config) mark the notification
 * FAILED immediately — retrying would change nothing.
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly entitlementGate: EntitlementGate,
    @Optional() private readonly appConfig?: AppConfigService,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const { tenantId, notificationId } = job.data;
    if (!tenantId) {
      throw new Error('Notification job is missing tenantId; refusing to process.');
    }

    const tenantClient = createTenantScopedClient(tenantId);

    const notification = await tenantClient.notification.findFirst({ where: { id: notificationId } });
    if (!notification) {
      // The tenant-scoped lookup found nothing — either the id is wrong, or (defense in depth)
      // it belongs to a different tenant than the job claims. Either way: fail loudly, never
      // fall back to an unscoped lookup to "helpfully" find it elsewhere.
      throw new Error(`Notification ${notificationId} not found for tenant ${tenantId}.`);
    }

    // Entitlement enforcement in a background job: the tenant might have had its
    // plan/subscription downgraded since the job was enqueued. Re-checking the (self-healing)
    // materialized entitlement here means a tenant that no longer holds the notifications module
    // gets no delivery at all — the row is marked FAILED instead of silently skipped.
    if (!(await this.entitlementGate.isFeatureEnabled(tenantId, FEATURE_KEYS.NOTIFICATIONS))) {
      await this.fail(tenantClient, notification, "Tenant's plan no longer includes the notifications module.");
      return;
    }

    // Per-user, per-channel opt-out. Absent row = enabled by default. A suppressed delivery is
    // terminal (no retry) and audited so it shows up in delivery reporting distinct from failures.
    if (notification.recipientUserId) {
      const preference = await tenantClient.notificationPreference.findUnique({
        where: { tenantId_userId_channel: { tenantId, userId: notification.recipientUserId, channel: notification.channel } },
      });
      if (preference && !preference.enabled) {
        await tenantClient.notification.update({
          where: { id: notification.id },
          data: { status: 'SUPPRESSED', lastAttemptAt: new Date() },
        });
        await this.recordDeliveryLog(tenantClient, notification, 'SUPPRESSED', 'preference', null, {
          reason: `User disabled ${notification.channel} channel.`,
        });
        await this.audit(tenantId, notification.id, AUDIT_ACTIONS.NOTIFICATION_SUPPRESSED);
        this.logger.debug(`Suppressed ${notification.channel} notification ${notification.id} per user preference.`);
        return;
      }
    }

    try {
      const { provider, providerName } = await this.resolveProvider(notification);
      const addresses = await this.resolveAddresses(tenantClient, notification);

      this.logger.log(
        `Delivering ${notification.channel} notification ${notification.id} to user ` +
          `${notification.recipientUserId} (tenant ${tenantId}): "${notification.subject}"`,
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
      await this.audit(tenantId, notification.id, AUDIT_ACTIONS.NOTIFICATION_DELIVERED);
    } catch (error) {
      const attemptNumber = notification.attempts + 1;
      const retryable = error instanceof ProviderDeliveryError ? error.retryable : true;
      const message = error instanceof Error ? error.message : 'Unknown delivery error';

      await this.recordDeliveryLog(tenantClient, notification, 'FAILED', notification.provider ?? 'unknown', null, {
        attempt: attemptNumber,
        error: message,
      });

      if (retryable) {
        // Transient: record the failed attempt, keep the row PENDING/QUEUED, and rethrow so
        // BullMQ applies its backoff and re-enqueues the job. The delivery log carries the full
        // per-attempt trail; `attempts` counts every attempt made so far.
        await tenantClient.notification.update({
          where: { id: notification.id },
          data: { attempts: attemptNumber, lastAttemptAt: new Date() },
        });
        throw error;
      }

      await this.fail(tenantClient, notification, message, attemptNumber);
    }
  }

  // ── Pipeline helpers ────────────────────────────────────────────────────────

  /** Picks the tenant's active provider for the notification's channel. No active config ⇒
   *  terminal failure — except in development, where the console provider is used so the
   *  pipeline completes locally without a real gateway. */
  private async resolveProvider(notification: Notification & { tenantId: string }): Promise<{ provider: NotificationProvider; providerName: string }> {
    const tenantClient = createTenantScopedClient(notification.tenantId);
    const row = await tenantClient.notificationProviderConfig.findFirst({
      where: { tenantId: notification.tenantId, channel: notification.channel, isActive: true },
      orderBy: { isDefault: 'desc' },
    });

    if (!row) {
      const isDev = (this.appConfig?.get('NODE_ENV') ?? process.env.NODE_ENV) === 'development';
      if (isDev) {
        return { provider: devConsoleProviderFor(notification.channel), providerName: 'console' };
      }
      throw new ProviderDeliveryError(
        `No active provider configured for ${notification.channel} in this tenant. Set up notification_provider_configs.`,
        false,
      );
    }

    const credentials = this.decryptCredentials(row.credentialsEncrypted);
    const provider = createNotificationProvider(
      {
        channel: notification.channel,
        provider: row.provider,
        config: (row.config as Record<string, unknown> | null) ?? {},
        credentials,
      },
      { allowDevFallback: (this.appConfig?.get('NODE_ENV') ?? process.env.NODE_ENV) === 'development' },
    );
    return { provider, providerName: row.provider };
  }

  private decryptCredentials(credentialsEncrypted: string | null): Record<string, unknown> {
    if (!credentialsEncrypted) return {};
    try {
      const secretKey = this.appConfig?.get('NOTIFICATION_SECRET_KEY') ?? process.env.NOTIFICATION_SECRET_KEY ?? '';
      return JSON.parse(new NotificationSecretCipher(secretKey).decrypt(credentialsEncrypted)) as Record<string, unknown>;
    } catch (error) {
      throw new ProviderDeliveryError(
        `Failed to decrypt provider credentials: ${error instanceof Error ? error.message : 'unknown error'}`,
        false,
        error,
      );
    }
  }

  /** Resolves the concrete address(es) to deliver to from the notification's recipient. A
   *  missing address is a terminal failure — it surfaces clearly instead of being silently
   *  suppressed. PUSH fans out to every registered device token. */
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

  private async fail(tenantClient: TenantClient, notification: Notification, message: string, attempts?: number): Promise<void> {
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
      data: {
        scope: 'TENANT',
        tenantId,
        actorType: 'SYSTEM',
        action,
        entityType: 'Notification',
        entityId,
      },
    });
  }
}

/** Keep PII out of logs: show only the first chars of an address. */
function maskAddress(address: string): string {
  if (address.length <= 4) return '••••';
  return `${address.slice(0, 2)}•••${address.slice(-2)}`;
}