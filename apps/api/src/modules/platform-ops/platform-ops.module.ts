import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { PlatformOpsController } from './platform-ops.controller';
import { PlatformOpsService } from './platform-ops.service';

@Module({
  // AnalyticsModule is imported for its exported AnalyticsReadService only, so the platform
  // dashboard and the college dashboard share one implementation of the AnalyticsSnapshot access
  // convention instead of each re-deriving the scope filter (and one of them getting it wrong).
  // The payment-reconciliation queue is registered here because this module is the only API surface
  // that enqueues reconciliation work (QueueMonitoringService comes from the global QueueModule).
  imports: [
    CommonGuardsModule,
    AnalyticsModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.PAYMENT_RECONCILIATION }),
  ],
  controllers: [PlatformOpsController],
  providers: [PlatformOpsService, PlatformAnalyticsService],
})
export class PlatformOpsModule {}
