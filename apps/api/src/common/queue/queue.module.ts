import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

/** Registers the shared BullMQ Redis connection once, app-wide. Individual queues (e.g.
 * NotificationsModule's `notifications` queue) are registered per-module via
 * BullModule.registerQueue() and inherit this connection automatically. */
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
  exports: [BullModule],
})
export class QueueModule {}
