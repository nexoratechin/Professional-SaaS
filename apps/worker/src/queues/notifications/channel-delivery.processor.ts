import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';
import { createTenantScopedClient, type Notification } from '@college-erp/database';
import { processorOptions, requireTenantId } from '@college-erp/queue';
import { QUEUE_NAMES, type ChannelDeliveryJobData } from '@college-erp/types';
import { NotificationDeliveryService } from './notification-delivery.service';

type NotificationChannel = Notification['channel'];

/**
 * Base for the dedicated transport processors (emails / sms / whatsapp). Each job carries only
 * `{ tenantId, notificationId }`; the processor re-loads the Notification through a tenant-scoped
 * client so a tampered payload cannot reach another tenant's row, verifies the row's channel
 * matches the queue (a misrouted job fails hard), and then runs the shared delivery pipeline.
 *
 * A duplicate delivery after the row is already terminal (SENT/DELIVERED/SUPPRESSED) is a no-op.
 */
export abstract class ChannelDeliveryProcessor extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);

  constructor(private readonly delivery: NotificationDeliveryService) {
    super();
  }

  protected abstract get expectedChannel(): NotificationChannel;

  async process(job: Job<ChannelDeliveryJobData>): Promise<void> {
    const tenantId = requireTenantId(job);
    const tenantClient = createTenantScopedClient(tenantId);
    const notification = await tenantClient.notification.findFirst({ where: { id: job.data.notificationId } });
    if (!notification) {
      throw new UnrecoverableError(`Notification ${job.data.notificationId} not found for tenant ${tenantId}.`);
    }
    if (notification.channel !== this.expectedChannel) {
      throw new UnrecoverableError(
        `Notification ${notification.id} is ${notification.channel} but arrived on the ${this.expectedChannel} queue.`,
      );
    }
    if (notification.status === 'SENT' || notification.status === 'SUPPRESSED' || notification.status === 'FAILED') {
      this.logger.debug(`Notification ${notification.id} already ${notification.status}; skipping duplicate delivery.`);
      return;
    }

    const evaluation = await this.delivery.evaluate(tenantClient, notification);
    if (!evaluation.deliver) return;
    await this.delivery.deliver(tenantClient, notification);
  }
}

@Processor(QUEUE_NAMES.EMAILS, processorOptions(QUEUE_NAMES.EMAILS))
export class EmailsProcessor extends ChannelDeliveryProcessor {
  constructor(delivery: NotificationDeliveryService) {
    super(delivery);
  }
  protected get expectedChannel(): NotificationChannel {
    return 'EMAIL';
  }
}

@Processor(QUEUE_NAMES.SMS, processorOptions(QUEUE_NAMES.SMS))
export class SmsProcessor extends ChannelDeliveryProcessor {
  constructor(delivery: NotificationDeliveryService) {
    super(delivery);
  }
  protected get expectedChannel(): NotificationChannel {
    return 'SMS';
  }
}

@Processor(QUEUE_NAMES.WHATSAPP, processorOptions(QUEUE_NAMES.WHATSAPP))
export class WhatsAppProcessor extends ChannelDeliveryProcessor {
  constructor(delivery: NotificationDeliveryService) {
    super(delivery);
  }
  protected get expectedChannel(): NotificationChannel {
    return 'WHATSAPP';
  }
}
