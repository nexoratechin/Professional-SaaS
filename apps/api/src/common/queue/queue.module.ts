import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { QueueMonitoringService } from './queue-monitoring.service';

/** Registers the shared BullMQ Redis connection once, app-wide. Individual queues (e.g.
 * NotificationsModule's `notifications` queue) are registered per-module via
 * BullModule.registerQueue() and inherit this connection automatically. QueueMonitoringService
 * exposes queue/job telemetry to the platform-ops endpoints. */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const redisUrl = new URL(config.get('REDIS_URL'));
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
  ],
  providers: [QueueMonitoringService],
  exports: [BullModule, QueueMonitoringService],
})
export class QueueModule {}
