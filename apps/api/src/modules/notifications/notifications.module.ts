import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS }), CommonGuardsModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
