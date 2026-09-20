import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { SubscriptionLifecycleSchedulerService } from './subscription-lifecycle-scheduler.service';
import { SubscriptionLifecycleProcessor } from './subscription-lifecycle.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.SUBSCRIPTION_LIFECYCLE })],
  providers: [SubscriptionLifecycleProcessor, SubscriptionLifecycleSchedulerService],
})
export class SubscriptionLifecycleProcessorModule {}
