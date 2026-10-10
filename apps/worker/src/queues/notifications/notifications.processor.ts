import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { createTenantScopedClient, type Notification } from '@college-erp/database';
import { defaultJobOptions, processorOptions, requireTenantId } from '@college-erp/queue';
import { QUEUE_NAMES, type NotificationJobData, type QueueName } from '@college-erp/types';
import { NotificationDeliveryService } from './notification-delivery.service';

/**
 * Notification orchestrator. One job per Notification row. It:
 *  1. re-checks entitlement + the recipient's channel preference (via NotificationDeliveryService);
 *  2. routes EMAIL / SMS / WHATSAPP rows onto their dedicated transport queues (emails / sms /
 *     whatsapp), so provider sends are retried and isolated per channel; and
 *  3. delivers IN_APP / PUSH inline (no external transport).
 *
 * Tenant context comes only from the job payload (there is no request/guard here); every read and
 * write rides a tenant-scoped client built from tenantId.
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS, processorOptions(QUEUE_NAMES.NOTIFICATIONS))
export class NotificationsProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsProcessor.name);

  constructor(
    private readonly delivery: NotificationDeliveryService,
    @InjectQueue(QUEUE_NAMES.EMAILS) private readonly emails: Queue,
    @InjectQueue(QUEUE_NAMES.SMS) private readonly sms: Queue,
    @InjectQueue(QUEUE_NAMES.WHATSAPP) private readonly whatsapp: Queue,
  ) {
    super();
  }

  async process(job: Job<NotificationJobData>): Promise<void> {
    const tenantId = requireTenantId(job);
    const { notificationId } = job.data;

    const tenantClient = createTenantScopedClient(tenantId);
    const notification = await tenantClient.notification.findFirst({ where: { id: notificationId } });
    if (!notification) {
      throw new Error(`Notification ${notificationId} not found for tenant ${tenantId}.`);
    }
    if (notification.status === 'SENT' || notification.status === 'SUPPRESSED' || notification.status === 'FAILED') {
      this.logger.debug(`Notification ${notificationId} already ${notification.status}; skipping.`);
      return;
    }

    const evaluation = await this.delivery.evaluate(tenantClient, notification);
    if (!evaluation.deliver) return;

    const transport = this.transportFor(notification.channel);
    if (transport) {
      await transport.queue.add(
        'deliver',
        { tenantId, notificationId: notification.id },
        defaultJobOptions(transport.name, { jobId: `notify-${notification.id}` }),
      );
      this.logger.debug(
        `Routed ${notification.channel} notification ${notification.id} to the ${transport.name} queue (tenant ${tenantId}).`,
      );
      return;
    }

    await this.delivery.deliver(tenantClient, notification);
  }

  private transportFor(channel: Notification['channel']): { queue: Queue; name: QueueName } | null {
    switch (channel) {
      case 'EMAIL':
        return { queue: this.emails, name: QUEUE_NAMES.EMAILS };
      case 'SMS':
        return { queue: this.sms, name: QUEUE_NAMES.SMS };
      case 'WHATSAPP':
        return { queue: this.whatsapp, name: QUEUE_NAMES.WHATSAPP };
      default:
        return null;
    }
  }
}
