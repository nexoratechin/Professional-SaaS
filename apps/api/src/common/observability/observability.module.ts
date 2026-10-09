import { Global, Module } from '@nestjs/common';
import { HealthModule } from '../../modules/health/health.module';
import { AlertingService } from './alerting.service';
import { ErrorTrackerService } from './error-tracker.service';
import { MetricsController } from './metrics.controller';
import { ObservabilityRuntimeService } from './observability-runtime.service';

/**
 * API observability surface. Global so any module can inject the error tracker (the HTTP
 * exception filter does) or the alerting service (platform-ops does) without import churn.
 *
 * Provides: structured runtime metrics, the /metrics scrape endpoint, the error tracker, and the
 * alert engine. The worker runs its own equivalent module (apps/worker/src/common/observability).
 */
@Global()
@Module({
  imports: [HealthModule],
  controllers: [MetricsController],
  providers: [ObservabilityRuntimeService, ErrorTrackerService, AlertingService],
  exports: [ErrorTrackerService, AlertingService],
})
export class ObservabilityModule {}
