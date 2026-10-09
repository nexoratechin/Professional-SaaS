import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import {
  configureObservability,
  parseLogFormat,
  parseLogLevel,
  setBuildInfo,
  startRuntimeMetricsCollector,
} from '@college-erp/observability';
import { QUEUE_NAMES } from '@college-erp/types';
import { AppModule } from './app.module';
import { WorkerErrorTrackerService } from './common/observability/worker-error-tracker.service';

async function bootstrap() {
  // Structured logging is configured before the context is created so module init logs are JSON
  // in production, matching the API.
  const logger = configureObservability({
    service: 'worker',
    level: parseLogLevel(process.env.LOG_LEVEL, process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
    format: parseLogFormat(process.env.LOG_FORMAT),
    version: process.env.APP_VERSION ?? 'dev',
    environment: process.env.NODE_ENV ?? 'development',
  });
  setBuildInfo({
    service: 'worker',
    version: process.env.APP_VERSION ?? 'dev',
    environment: process.env.NODE_ENV ?? 'development',
  });
  const stopRuntimeMetrics = startRuntimeMetricsCollector(15_000);

  const app = await NestFactory.createApplicationContext(AppModule, { logger });

  // Process-level failures go through the same error tracker as queue failures, so a crash loop
  // is visible in SystemErrorEvent and the tracked_errors alert window.
  const errorTracker = app.get(WorkerErrorTrackerService);
  process.on('unhandledRejection', (reason: unknown) => {
    errorTracker.capture(reason, { source: 'worker', context: { origin: 'unhandledRejection' } });
  });
  process.on('uncaughtException', (error: Error) => {
    errorTracker.capture(error, { source: 'worker', context: { origin: 'uncaughtException' } });
    logger.emit('error', 'Uncaught exception — exiting', {
      error: { name: error.name, message: error.message, stack: error.stack },
    });
    setTimeout(() => process.exit(1), 250).unref();
  });

  const shutdown = async () => {
    stopRuntimeMetrics();
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  logger.emit('info', 'College ERP worker started', {
    queues: Object.values(QUEUE_NAMES).length,
  });
}

bootstrap();
