import { Body, Controller, Get, Param, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { CampusPoliciesSectionDto } from '../tenant-configuration/dto/update-tenant-configuration.dto';
import { CampusAccessService } from './campus-access.service';
import { CampusAdminService } from './campus-admin.service';
import { CompareCampusesQueryDto } from './dto/compare-campuses-query.dto';
import { UpdateCampusConfigDto } from './dto/update-campus-config.dto';

/**
 * Multi-campus operations surface: university-level overview/comparison, per-campus configuration
 * documents, and the institution-wide campus policy document.
 *
 * Access model (PermissionsGuard keys + service-level scope checks):
 *  - overview / compare              -> campus.analytics.view, scoped to the caller's campus grants
 *  - GET/PATCH /campuses/:campusId/config -> campus.settings.view / campus.settings.manage, scoped
 *  - GET/PATCH /campuses/policies    -> campus.policies.manage, GLOBAL grant only (an institution-
 *                                      wide policy is never addressable from a campus-scoped grant)
 */
@ApiTags('campuses')
@Controller('campuses')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class CampusController {
  constructor(
    private readonly campusAdmin: CampusAdminService,
    private readonly campusAccess: CampusAccessService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get('overview')
  @RequirePermission(PERMISSION_KEYS.CAMPUS_ANALYTICS_VIEW)
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.campusAdmin.overview(this.tenantContext.tenantId as string, user.id);
  }

  @Get('compare')
  @RequirePermission(PERMISSION_KEYS.CAMPUS_ANALYTICS_VIEW)
  compare(@Query() query: CompareCampusesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.campusAdmin.compare(
      this.tenantContext.tenantId as string,
      user.id,
      query.campusIds as string[],
    );
  }

  @Get('policies')
  @RequirePermission(PERMISSION_KEYS.CAMPUS_POLICIES_MANAGE)
  async getPolicies(@CurrentUser() user: AuthenticatedUser) {
    const tenantId = this.tenantContext.tenantId as string;
    await this.campusAccess.assertGlobalGrant(tenantId, user.id, PERMISSION_KEYS.CAMPUS_POLICIES_MANAGE);
    return this.campusAdmin.getPolicies(tenantId);
  }

  @Patch('policies')
  @RequirePermission(PERMISSION_KEYS.CAMPUS_POLICIES_MANAGE)
  async updatePolicies(
    @Body() dto: CampusPoliciesSectionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantId = this.tenantContext.tenantId as string;
    await this.campusAccess.assertGlobalGrant(tenantId, user.id, PERMISSION_KEYS.CAMPUS_POLICIES_MANAGE);
    return this.campusAdmin.updatePolicies(tenantId, user.id, dto);
  }

  @Get(':campusId/config')
  @RequirePermission(PERMISSION_KEYS.CAMPUS_SETTINGS_VIEW)
  getConfig(@Param('campusId') campusId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.campusAdmin.getConfig(this.tenantContext.tenantId as string, user.id, campusId);
  }

  @Patch(':campusId/config')
  @RequirePermission(PERMISSION_KEYS.CAMPUS_SETTINGS_MANAGE)
  updateConfig(
    @Param('campusId') campusId: string,
    @Body() dto: UpdateCampusConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.campusAdmin.updateConfig(this.tenantContext.tenantId as string, user.id, campusId, dto);
  }
}