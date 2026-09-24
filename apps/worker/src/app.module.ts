import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfigService } from './config/app-config.service';
import { ConfigModule } from './config/config.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { NotificationsProcessorModule } from './queues/notifications/notifications-processor.module';
import { SubscriptionLifecycleProcessorModule } from './queues/subscription-lifecycle/subscription-lifecycle-processor.module';
import { TransportGpsSweepProcessorModule } from './queues/transport-gps/transport-gps-sweep-processor.module';
import { WorkflowEscalationProcessorModule } from './queues/workflow-escalation/workflow-escalation-processor.module';

@Module({
  imports: [
    ConfigModule,
    EntitlementModule,
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
    WorkflowEscalationProcessorModule,
    SubscriptionLifecycleProcessorModule,
    TransportGpsSweepProcessorModule,
  ],
})
export class AppModule {}
