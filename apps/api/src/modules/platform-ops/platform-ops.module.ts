import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { PlatformOpsController } from './platform-ops.controller';
import { PlatformOpsService } from './platform-ops.service';

@Module({
  // AnalyticsModule is imported for its exported AnalyticsReadService only, so the platform
  // dashboard and the college dashboard share one implementation of the AnalyticsSnapshot access
  // convention instead of each re-deriving the scope filter (and one of them getting it wrong).
  imports: [CommonGuardsModule, AnalyticsModule],
  controllers: [PlatformOpsController],
  providers: [PlatformOpsService, PlatformAnalyticsService],
})
export class PlatformOpsModule {}
