/**
 * Tenant-scoped analytics endpoints.
 *
 * Guard stack mirrors the reporting module (JwtAuth -> TenantMatch -> Permissions -> FeatureFlags
 * -> EntitlementFlags) so an analytics caller is held to exactly the same tenancy, RBAC and
 * plan-entitlement rules as a report caller. `analytics.advanced` is a *plan entitlement*, not a
 * permission: a college on a plan without the BI module gets a 402/403 here even with a valid
 * `analytics.view` grant, which is what makes it sellable.
 *
 * `POST /analytics/refresh` additionally requires `analytics.refresh` (MANAGE) - view rights must
 * not imply the ability to make the database do 20 aggregates per bucket.
 */

import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ENTITLEMENT_KEYS, FEATURE_KEYS, PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireEntitlement } from '../../common/decorators/require-entitlement.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { EntitlementFlagsGuard } from '../../common/guards/entitlement-flag.guard';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { CollegeAnalyticsService } from './college-analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';

@ApiTags('analytics')
@Controller('analytics')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard, EntitlementFlagsGuard)
@RequireFeature(FEATURE_KEYS.REPORTS)
@RequirePermission(PERMISSION_KEYS.ANALYTICS_VIEW)
@RequireEntitlement(ENTITLEMENT_KEYS.ANALYTICS_ADVANCED)
export class AnalyticsController {
  constructor(private readonly collegeAnalytics: CollegeAnalyticsService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsQueryDto) {
    return this.collegeAnalytics.overview(user, query);
  }

  @Post('refresh')
  @RequirePermission(PERMISSION_KEYS.ANALYTICS_REFRESH)
  @Audit('ANALYTICS_REFRESH_REQUESTED', 'Tenant', 'analytics')
  refresh(@CurrentUser() user: AuthenticatedUser, @Body() body: AnalyticsQueryDto) {
    return this.collegeAnalytics.requestRefresh(user, body);
  }
}
