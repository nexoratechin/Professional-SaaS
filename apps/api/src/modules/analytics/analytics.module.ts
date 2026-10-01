import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AnalyticsReadService } from './analytics-read.service';
import { AnalyticsController } from './analytics.controller';
import { CollegeAnalyticsService } from './college-analytics.service';

/**
 * AnalyticsModule owns the *tenant* dashboards. The SaaS (control-plane) side deliberately lives in
 * PlatformOpsModule instead: it authenticates with PlatformAuthGuard, reads through the unscoped
 * client, and has no tenant context at all - the same reason the existing platform dashboard does not
 * live in a domain module. What the two share is AnalyticsReadService, exported from here so the
 * snapshot/freshness policy has exactly one implementation.
 */
@Module({
  imports: [CommonGuardsModule, BullModule.registerQueue({ name: QUEUE_NAMES.ANALYTICS_REFRESH })],
  controllers: [AnalyticsController],
  providers: [AnalyticsReadService, CollegeAnalyticsService],
  // CollegeAnalyticsService is exported so the AI assistant's ANALYTICS_OVERVIEW answer can reuse the
  // exact same rollup rather than keeping a second copy of it — see AiAssistantService.execute.
  exports: [AnalyticsReadService, CollegeAnalyticsService],
})
export class AnalyticsModule {}
