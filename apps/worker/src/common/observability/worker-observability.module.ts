import { Global, Module } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { WORKER_REDIS_CLIENT } from './redis.constants';
import { WorkerErrorTrackerService } from './worker-error-tracker.service';
import { WorkerHealthServerService } from './worker-health-server.service';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

/**
 * Worker observability surface (global): a dedicated Redis connection, the Redis heartbeat, the
 * HTTP health/metrics server and the error tracker. Registered before the queue modules so
 * processors and the queue-events bridge can inject these services.
 */
@Global()
@Module({
  providers: [
    {
      provide: WORKER_REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new Redis(config.get('REDIS_URL'), { maxRetriesPerRequest: null }),
    },
    WorkerHeartbeatService,
    WorkerHealthServerService,
    WorkerErrorTrackerService,
  ],
  exports: [WORKER_REDIS_CLIENT, WorkerHeartbeatService, WorkerErrorTrackerService],
})
export class WorkerObservabilityModule {}
