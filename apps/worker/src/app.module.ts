import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfigService } from './config/app-config.service';
import { ConfigModule } from './config/config.module';
import { NotificationsProcessorModule } from './queues/notifications/notifications-processor.module';

@Module({
  imports: [
    ConfigModule,
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
    NotificationsProcessorModule,
  ],
})
export class AppModule {}
