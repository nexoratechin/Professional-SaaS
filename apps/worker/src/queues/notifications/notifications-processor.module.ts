import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { NotificationDeliveryModule } from './notification-delivery.module';
import { NotificationsProcessor } from './notifications.processor';

@Module({
  imports: [
    NotificationDeliveryModule,
    BullModule.registerQueue(
      { name: QUEUE_NAMES.NOTIFICATIONS },
      { name: QUEUE_NAMES.EMAILS },
      { name: QUEUE_NAMES.SMS },
      { name: QUEUE_NAMES.WHATSAPP },
    ),
  ],
  providers: [NotificationsProcessor],
  exports: [NotificationDeliveryModule],
})
export class NotificationsProcessorModule {}
