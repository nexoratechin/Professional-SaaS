import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { FEATURE_KEYS } from '@college-erp/auth';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type NotificationJobData } from '@college-erp/types';
import { EntitlementGate } from '../../entitlement/entitlement-gate';

/**
 * Tenant-aware background job processing: an HTTP request gets its tenant context from
 * TenantResolutionMiddleware + TenantMatchGuard, but there is no request and no guard here —
 * the job payload (tenantId) is the only carrier. This processor refuses to run without one,
 * and rebuilds a tenant-scoped Prisma client from it for the entire job — never the raw
 * unscoped client — so a notification job can only ever read/update the tenant it was
 * enqueued for, exactly like an HTTP request can only ever touch its own tenant.
 *
 * No real email/SMS provider integration yet (that's Phase 8+ Integrations) — "delivering" here
 * means logging and marking the row SENT, which is enough to prove the queue/tenant-isolation
 * plumbing end to end.
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(private readonly entitlementGate: EntitlementGate) {
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

    try {
      // Entitlement enforcement in a background job: notification delivery is one of the last
      // steps of the pipeline and the tenant might have had its plan/subscription downgraded
      // since the job was enqueued. Re-checking the (self-healing) materialized entitlement here
      // means a tenant that no longer holds the notifications module gets no delivery at all —
      // the row is marked FAILED instead of silently skipped, so it surfaces in the audit trail.
      if (!(await this.entitlementGate.isFeatureEnabled(tenantId, FEATURE_KEYS.NOTIFICATIONS))) {
        await tenantClient.notification.update({
          where: { id: notification.id },
          data: { status: 'FAILED', error: "Tenant's plan no longer includes the notifications module." },
        });
        this.logger.debug(`Skipped notification ${notification.id}: tenant ${tenantId} lost notifications entitlement.`);
        return;
      }

      this.logger.log(
        `Delivering ${notification.channel} notification ${notification.id} to user ` +
          `${notification.recipientUserId} (tenant ${tenantId}): "${notification.subject}"`,
      );

      await tenantClient.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: new Date() },
      });

      await platformPrismaClient.platformAuditLog.create({
        data: {
          scope: 'TENANT',
          tenantId,
          actorType: 'SYSTEM',
          action: 'NOTIFICATION_DELIVERED',
          entityType: 'Notification',
          entityId: notification.id,
        },
      });
    } catch (error) {
      await tenantClient.notification.update({
        where: { id: notification.id },
        data: { status: 'FAILED', error: error instanceof Error ? error.message : 'Unknown error' },
      });
      throw error;
    }
  }
}
