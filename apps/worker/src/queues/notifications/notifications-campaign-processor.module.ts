import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { EntitlementModule } from '../../entitlement/entitlement.module';
import { NotificationsCampaignProcessor } from './notifications-campaign.processor';

@Module({
  imports: [
    EntitlementModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS }),
    BullModule.registerQueue({ name: QUEUE_NAMES.NOTIFICATIONS_CAMPAIGN }),
  ],
  providers: [NotificationsCampaignProcessor],
})
export class NotificationsCampaignProcessorModule {}