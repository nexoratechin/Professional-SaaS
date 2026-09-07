import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type NotificationJobData } from '@college-erp/types';

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
