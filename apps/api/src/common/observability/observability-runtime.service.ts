import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { setBuildInfo, startRuntimeMetricsCollector } from '@college-erp/observability';
import { AppConfigService } from '../../config/app-config.service';

/**
 * Process-level observability bootstrap registered in the DI container (not only in main.ts) so
 * e2e tests boot the same runtime metrics. Publishes build identity (service/version/env) and
 * samples RSS/heap/uptime/event-loop-lag every 15s into the metrics registry.
 */
@Injectable()
export class ObservabilityRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObservabilityRuntimeService.name);
  private stopCollector?: () => void;

  constructor(private readonly config: AppConfigService) {}

  onModuleInit(): void {
    const nodeEnv = this.config.get('NODE_ENV');
    setBuildInfo({
      service: 'api',
      version: process.env.APP_VERSION ?? 'dev',
      environment: nodeEnv,
    });
    this.stopCollector = startRuntimeMetricsCollector(15_000);
    this.logger.log(`Observability runtime initialized (env=${nodeEnv}).`);
  }

  onModuleDestroy(): void {
    this.stopCollector?.();
  }
}
