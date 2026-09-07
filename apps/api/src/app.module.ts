import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { QueueModule } from './common/queue/queue.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { ConfigModule } from './config/config.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { HealthModule } from './modules/health/health.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { SaasModule } from './modules/saas/saas.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    PrismaModule,
    QueueModule,
    StorageModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    AuditModule,
    HealthModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    SaasModule,
    DocumentsModule,
    NotificationsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(TenantResolutionMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'api/docs', method: RequestMethod.ALL },
        { path: 'api/docs/(.*)', method: RequestMethod.ALL },
        { path: 'platform/(.*)', method: RequestMethod.ALL },
        { path: 'plans', method: RequestMethod.ALL },
        { path: 'subscriptions', method: RequestMethod.ALL },
        { path: 'tenants', method: RequestMethod.ALL },
        { path: 'tenants/(.*)', method: RequestMethod.ALL },
        { path: 'usage', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
