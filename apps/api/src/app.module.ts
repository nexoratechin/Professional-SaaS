import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';
import { PrismaModule } from './common/prisma/prisma.module';
import { QueueModule } from './common/queue/queue.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { ConfigModule } from './config/config.module';
import { AcademicsModule } from './modules/academics/academics.module';
import { AdmissionsModule } from './modules/admissions/admissions.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { BillingModule } from './modules/billing/billing.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { ExamsModule } from './modules/exams/exams.module';
import { HealthModule } from './modules/health/health.module';
import { LibraryModule } from './modules/library/library.module';
import { HostelModule } from './modules/hostel/hostel.module';
import { TransportModule } from './modules/transport/transport.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PlatformOpsModule } from './modules/platform-ops/platform-ops.module';
import { SaasModule } from './modules/saas/saas.module';
import { SupportModule } from './modules/support/support.module';
import { StudentsModule } from './modules/students/students.module';
import { TimetableModule } from './modules/timetable/timetable.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { FeesModule } from './modules/fees/fees.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { TenantConfigurationModule } from './modules/tenant-configuration/tenant-configuration.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { ResultsModule } from './modules/results/results.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { HrModule } from './modules/hr/hr.module';
import { PlacementsModule } from './modules/placements/placements.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { HelpdeskModule } from './modules/helpdesk/helpdesk.module';
import { ReportsModule } from './modules/reports/reports.module';

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
    OrganizationModule,
    SaasModule,
    DocumentsModule,
    NotificationsModule,
    WorkflowModule,
    StudentsModule,
    AcademicsModule,
    ExamsModule,
    ResultsModule,
    TimetableModule,
    AttendanceModule,
    FeesModule,
    CertificatesModule,
    LibraryModule,
    HostelModule,
    TransportModule,
    AdmissionsModule,
    HrModule,
    PlacementsModule,
    InventoryModule,
    HelpdeskModule,
    ReportsModule,
    BillingModule,
    SupportModule,
    PlatformOpsModule,
    TenantConfigurationModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Applies to every route, including /health, /api/docs, and /platform/** — unlike
    // TenantResolutionMiddleware below, correlation ids have nothing to do with tenancy.
    consumer.apply(RequestIdMiddleware).forRoutes('*');

    consumer
      .apply(TenantResolutionMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.ALL },
        { path: 'api/docs', method: RequestMethod.ALL },
        { path: 'api/docs/(.*)', method: RequestMethod.ALL },
        { path: 'public/(.*)', method: RequestMethod.ALL },
        { path: 'platform/(.*)', method: RequestMethod.ALL },
        { path: 'plans', method: RequestMethod.ALL },
        { path: 'plans/(.*)', method: RequestMethod.ALL },
        { path: 'feature-flags', method: RequestMethod.ALL },
        { path: 'feature-flags/(.*)', method: RequestMethod.ALL },
        { path: 'attendance/devices/ingest/(.*)', method: RequestMethod.ALL },
        { path: 'subscriptions', method: RequestMethod.ALL },
        { path: 'subscriptions/(.*)', method: RequestMethod.ALL },
        { path: 'subscription-items/(.*)', method: RequestMethod.ALL },
        { path: 'invoices/(.*)', method: RequestMethod.ALL },
        { path: 'tenants', method: RequestMethod.ALL },
        { path: 'tenants/(.*)', method: RequestMethod.ALL },
        { path: 'usage', method: RequestMethod.ALL },
      )
      .forRoutes('*');
  }
}
