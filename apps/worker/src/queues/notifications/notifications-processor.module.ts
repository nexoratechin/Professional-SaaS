import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { NotificationsProcessor } from './notifications.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS })],
  providers: [NotificationsProcessor],
})
export class NotificationsProcessorModule {}
