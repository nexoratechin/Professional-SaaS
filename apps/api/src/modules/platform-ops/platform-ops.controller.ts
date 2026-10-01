import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { PlatformOpsService } from './platform-ops.service';

/**
 * Read-only cross-tenant views for the platform admin dashboard — open to any authenticated
 * platform user (PLATFORM_ADMIN or PLATFORM_SUPPORT); nothing here mutates anything.
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
}
