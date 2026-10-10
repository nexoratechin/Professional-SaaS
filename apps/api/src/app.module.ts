import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { TenantResolutionMiddleware } from './common/middleware/tenant-resolution.middleware';
import { ObservabilityModule } from './common/observability/observability.module';
import { CacheModule } from './common/cache/cache.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantConnectionModule } from './common/tenant/tenant-connection.module';
import { QueueModule } from './common/queue/queue.module';
import { RedisModule } from './common/redis/redis.module';
import { StorageModule } from './common/storage/storage.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ApiLoggingInterceptor } from './common/interceptors/api-logging.interceptor';
import { IdempotencyInterceptor } from './common/interceptors/idempotency.interceptor';
import { ConfigModule } from './config/config.module';
import { AppConfigService } from './config/app-config.service';
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
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { IdentityModule } from './modules/identity/identity.module';
import { TimetableModule } from './modules/timetable/timetable.module';
import { AttendanceModule } from './modules/attendance/attendance.module';
import { FeesModule } from './modules/fees/fees.module';
import { CertificatesModule } from './modules/certificates/certificates.module';
import { TenantConfigurationModule } from './modules/tenant-configuration/tenant-configuration.module';
import { BrandingModule } from './modules/branding/branding.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { CampusModule } from './modules/campus/campus.module';
import { ResultsModule } from './modules/results/results.module';
import { TenantsModule } from './modules/tenants/tenants.module';
import { UsersModule } from './modules/users/users.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { HrModule } from './modules/hr/hr.module';
import { PlacementsModule } from './modules/placements/placements.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { HelpdeskModule } from './modules/helpdesk/helpdesk.module';
import { ReportsModule } from './modules/reports/reports.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module';
import { StudentPortalModule } from './modules/student-portal/student-portal.module';
import { ParentPortalModule } from './modules/parent-portal/parent-portal.module';
import { FacultyPortalModule } from './modules/faculty-portal/faculty-portal.module';
import { ImportExportModule } from './modules/import-export/import-export.module';
import { GlobalSearchModule } from './modules/global-search/global-search.module';

@Module({
  imports: [
    ConfigModule,
    RedisModule,
    CacheModule,
    PrismaModule,
    QueueModule,
    StorageModule,
    TenantConnectionModule,
    // Global rate limiting: per-IP window for every route, configured via env
    // (THROTTLE_TTL / THROTTLE_LIMIT). Per-endpoint overrides use @Throttle() — see the strict
    // 5/min window on /auth/login. @nestjs/throttler keys by client IP/route at the guard level.
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => [
        { ttl: config.get('THROTTLE_TTL'), limit: config.get('THROTTLE_LIMIT') },
      ],
    }),
    AuditModule,
    HealthModule,
    ObservabilityModule,
    AuthModule,
    TenantsModule,
    UsersModule,
    OrganizationModule,
    SaasModule,
    DocumentsModule,
    NotificationsModule,
    IntegrationsModule,
    IdentityModule,
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
    AnalyticsModule,
    AiAssistantModule,
    StudentPortalModule,
    ParentPortalModule,
    FacultyPortalModule,
    ImportExportModule,
    GlobalSearchModule,
    BillingModule,
    SupportModule,
    PlatformOpsModule,
    TenantConfigurationModule,
    BrandingModule,
    CampusModule,
  ],
  providers: [
    // Platform-wide cross-cutting concerns, registered here (not main.ts) so e2e tests boot the
    // same behavior the production bootstrap has:
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ApiLoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
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
        { path: 'health/(.*)', method: RequestMethod.ALL },
        { path: 'metrics', method: RequestMethod.ALL },
        { path: 'api/docs', method: RequestMethod.ALL },
        { path: 'api/docs/(.*)', method: RequestMethod.ALL },
        { path: 'public/(.*)', method: RequestMethod.ALL },
        { path: 'platform/(.*)', method: RequestMethod.ALL },
        { path: 'plans', method: RequestMethod.ALL },
        { path: 'plans/(.*)', method: RequestMethod.ALL },
        { path: 'feature-flags', method: RequestMethod.ALL },
        { path: 'feature-flags/(.*)', method: RequestMethod.ALL },
        { path: 'attendance/devices/ingest/(.*)', method: RequestMethod.ALL },
        // Inbound provider callbacks carry no tenant header/subdomain — the endpoint's random
        // path token identifies the tenant. Same reasoning as the attendance device gateway above.
        { path: 'integrations/webhooks/(.*)', method: RequestMethod.ALL },
        // The IdP redirects the browser here with no tenant header/subdomain — the tenant is
        // carried inside the Redis state minted by POST /auth/sso/:key/start. Same reasoning as the
        // webhook callback above.
        { path: 'auth/sso/callback', method: RequestMethod.ALL },
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
