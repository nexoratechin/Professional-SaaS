import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { EmailsProcessor, SmsProcessor, WhatsAppProcessor } from './channel-delivery.processor';
import { NotificationDeliveryModule } from './notification-delivery.module';

/**
 * Dedicated transport workers. Each processor shares the delivery pipeline but only ever handles
 * its own channel, so a slow/failing SMS gateway cannot starve email delivery (separate queues,
 * separate concurrency, separate retry budgets).
 */
@Module({
  imports: [
    NotificationDeliveryModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.EMAILS },
      { name: QUEUE_NAMES.SMS },
      { name: QUEUE_NAMES.WHATSAPP },
    ),
  ],
  providers: [EmailsProcessor, SmsProcessor, WhatsAppProcessor],
})
export class ChannelDeliveryProcessorModule {}
