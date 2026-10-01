import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { EntitlementModule } from '../../entitlement/entitlement.module';
import { AnalyticsRefreshSchedulerService } from './analytics-refresh-scheduler.service';
import { AnalyticsRefreshProcessor } from './analytics-refresh.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.ANALYTICS_REFRESH }), EntitlementModule],
  providers: [AnalyticsRefreshProcessor, AnalyticsRefreshSchedulerService],
})
export class AnalyticsRefreshProcessorModule {}
