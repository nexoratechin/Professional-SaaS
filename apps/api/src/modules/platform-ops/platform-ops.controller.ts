import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AlertSeverity, AlertStatus, BackgroundJobStatus } from '@college-erp/database';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { AlertingService } from '../../common/observability/alerting.service';
import { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { PlatformOpsService } from './platform-ops.service';

/**
 * Cross-tenant views for the platform admin dashboard. Read-only GETs are open to any authenticated
 * platform user (PLATFORM_ADMIN or PLATFORM_SUPPORT, for support triage); every MUTATING route
 * (alert lifecycle, payment reconciliation) additionally requires PLATFORM_ADMIN via
 * @RequirePlatformRole — those endpoints change state, so a support account must not reach them.
 *
 * No `@RequirePermission`/`@RequireFeature`/`@RequireEntitlement`: these are operator views, not
 * tenant features, and the existing platform routes are gated purely on "is a platform user". The
 * analytics routes in particular must NOT be gated on `analytics.advanced` — that entitlement is
 * bought per college, and the platform operator who has to see why a college is not paying for it
 * does not hold the tenant's entitlements.
 */
@ApiTags('platform-ops')
@Controller('platform')
@UseGuards(PlatformAuthGuard)
export class PlatformOpsController {
  constructor(
    private readonly platformOps: PlatformOpsService,
    private readonly platformAnalytics: PlatformAnalyticsService,
    private readonly alerting: AlertingService,
  ) {}

  @Get('system/health')
  getHealth() {
    return this.platformOps.getSystemHealth();
  }

  @Get('dashboard/summary')
  getDashboardSummary() {
    return this.platformOps.getDashboardSummary();
  }

  @Get('system/storage-usage')
  getStorageUsage() {
    return this.platformOps.getStorageUsageByTenant();
  }

  /** MRR/ARR, tenants, subscriptions, churn, revenue, usage and metered students. */
  @Get('analytics/overview')
  analyticsOverview(@Query() query: AnalyticsQueryDto) {
    return this.platformAnalytics.overview(query);
  }

  /** Metered-usage drill-down, by event type and by tenant. */
  @Get('analytics/usage')
  analyticsUsage(@Query() query: AnalyticsQueryDto) {
    return this.platformAnalytics.usage(query);
  }

  // ── System observability (health, alerts, errors) ─────────────────────────

  /** One payload for the platform observability dashboard: dependency health, queue overview,
   *  firing alerts and the most recent tracked errors. */
  @Get('system/observability')
  async observabilityOverview() {
    const [health, queues, alerts, errors] = await Promise.all([
      this.platformOps.getSystemHealth(),
      this.platformOps.getJobQueues().catch(() => undefined),
      this.alerting.listAlerts({ take: 50 }),
      this.platformOps.listErrors({ take: 10 }),
    ]);
    return {
      health,
      queues: queues ?? null,
      alerts,
      recentErrors: errors,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Alert history/lifecycle: filter by status (FIRING/ACKNOWLEDGED/RESOLVED) and severity. */
  @Get('system/alerts')
  listAlerts(
    @Query('status') status?: AlertStatus,
    @Query('severity') severity?: AlertSeverity,
    @Query('take') take?: string,
  ) {
    return this.alerting.listAlerts({ status, severity, take: take ? Number(take) : undefined });
  }

  /** Runs one alert-evaluation pass synchronously — useful right after a deploy or incident. */
  @Post('system/alerts/evaluate')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  evaluateAlerts() {
    return this.alerting.evaluate();
  }

  @Post('system/alerts/:id/acknowledge')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  acknowledgeAlert(@Param('id') id: string, @CurrentPlatformUser() platformUser: { id: string }) {
    return this.alerting.acknowledgeAlert(id, platformUser.id);
  }

  @Post('system/alerts/:id/resolve')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  resolveAlert(@Param('id') id: string) {
    return this.alerting.resolveAlert(id);
  }

  /** Deduplicated error-tracking ledger (one row per fingerprint, newest activity first). */
  @Get('system/errors')
  listErrors(@Query('source') source?: string, @Query('take') take?: string) {
    return this.platformOps.listErrors({ source, take: take ? Number(take) : undefined });
  }

  // ── Background jobs (monitoring) ──────────────────────────────────────────

  /** Per-queue backlog/health, registry status totals and the dead-letter backlog. */
  @Get('jobs/queues')
  jobQueues() {
    return this.platformOps.getJobQueues();
  }

  /** Recent registered background jobs, most recent first. */
  @Get('jobs')
  listJobs(
    @Query('queue') queue?: string,
    @Query('status') status?: BackgroundJobStatus,
    @Query('tenantId') tenantId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.platformOps.listJobs({
      ...(queue ? { queue } : {}),
      ...(status ? { status } : {}),
      ...(tenantId ? { tenantId } : {}),
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
  }

  // ── Payments (reconciliation) ─────────────────────────────────────────────

  /** Manually reconcile one recorded gateway payment against the provider's current status. */
  @Post('payments/:id/reconcile')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  reconcilePayment(@Param('id') id: string) {
    return this.platformOps.reconcilePayment(id);
  }
}
