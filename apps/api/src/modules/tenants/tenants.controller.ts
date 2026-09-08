import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PERMISSION_KEYS, FEATURE_KEYS, ENTITLEMENT_KEYS } from '@college-erp/auth';
import type { AuthenticatedPlatformUser, AuthenticatedUser } from '@college-erp/auth';
import type { EffectiveEntitlementsResponseDto, FeatureFlagsResponseDto } from '@college-erp/types';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../../common/decorators/require-entitlement.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { EntitlementFlagsGuard } from '../../common/guards/entitlement-flag.guard';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { ListTenantsDto } from './dto/list-tenants.dto';
import { SetEntitlementOverrideDto } from './dto/set-entitlement-override.dto';
import { SetTenantFeatureOverrideDto } from './dto/set-tenant-feature-override.dto';
import { TransitionTenantStatusDto } from './dto/transition-tenant-status.dto';
import { UpdateTenantSettingsDto } from './dto/update-tenant-settings.dto';
import { UpdateTenantStatusDto } from './dto/update-tenant-status.dto';
import { TenantsService } from './tenants.service';

@ApiTags('tenants')
@Controller()
export class TenantsController {
  constructor(
    private readonly tenantsService: TenantsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // --- Platform control plane: tenant lifecycle -----------------------------------------

  @Post('tenants')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  create(@Body() dto: CreateTenantDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.tenantsService.createTenant(dto, platformUser.id);
  }

  // Any authenticated platform user (PLATFORM_ADMIN or PLATFORM_SUPPORT) may search/view tenant
  // data — support staff need this to triage tickets. Only PLATFORM_ADMIN may change a tenant's
  // lifecycle status or feature overrides (below).
  @Get('tenants')
  @UseGuards(PlatformAuthGuard)
  async list(@Query() query: ListTenantsDto, @Res({ passthrough: true }) res: Response) {
    const { data, total } = await this.tenantsService.listTenants(query);
    res.setHeader('X-Total-Count', String(total));
    return data;
  }

  @Get('tenants/:id')
  @UseGuards(PlatformAuthGuard)
  get(@Param('id') id: string) {
    return this.tenantsService.getTenant(id);
  }

  @Get('tenants/:id/usage')
  @UseGuards(PlatformAuthGuard)
  getUsage(@Param('id') id: string) {
    return this.tenantsService.getUsage(id);
  }

  @Patch('tenants/:id/status')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTenantStatusDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.tenantsService.updateStatus(id, dto, platformUser.id);
  }

  @Post('tenants/:id/activate')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  activate(
    @Param('id') id: string,
    @Body() dto: TransitionTenantStatusDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.tenantsService.activate(id, dto, platformUser.id);
  }

  @Post('tenants/:id/suspend')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  suspend(
    @Param('id') id: string,
    @Body() dto: TransitionTenantStatusDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.tenantsService.suspend(id, dto, platformUser.id);
  }

  @Post('tenants/:id/deactivate')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  deactivate(
    @Param('id') id: string,
    @Body() dto: TransitionTenantStatusDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.tenantsService.deactivate(id, dto, platformUser.id);
  }

  @Patch('tenants/:id/features')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  setFeatureOverride(
    @Param('id') id: string,
    @Body() dto: SetTenantFeatureOverrideDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.tenantsService.setFeatureOverride(id, dto, platformUser.id);
  }

  @Get('tenants/:id/entitlements')
  @UseGuards(PlatformAuthGuard)
  listEntitlements(@Param('id') id: string) {
    return this.tenantsService.listEntitlements(id);
  }

  @Patch('tenants/:id/entitlements')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  setEntitlementOverride(
    @Param('id') id: string,
    @Body() dto: SetEntitlementOverrideDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.tenantsService.setEntitlementOverride(id, dto, platformUser.id);
  }

  @Post('tenants/:id/entitlements/:key/remove-override')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  removeEntitlementOverride(
    @Param('id') id: string,
    @Param('key') key: string,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.tenantsService.removeEntitlementOverride(id, key, platformUser.id);
  }

  // --- Tenant self-service ---------------------------------------------------------------

  @Get('tenant/settings')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.TENANT_SETTINGS_MANAGE)
  getSettings() {
    return this.tenantsService.getSelfServiceSettings(this.tenantContext.tenantId as string);
  }

  @Patch('tenant/settings')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.TENANT_SETTINGS_MANAGE)
  updateSettings(@Body() dto: UpdateTenantSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenantsService.updateSelfServiceSettings(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Get('tenant/features')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.TENANT_FEATURES_VIEW)
  async getFeatures(): Promise<FeatureFlagsResponseDto> {
    const features = await this.tenantsService.getEffectiveFeatures(this.tenantContext.tenantId as string);
    return { features };
  }

  /** Effective entitlements for the tenant, resolved through the single EntitlementsGatewayService
   * — module flags + granular capabilities. Unlike /tenant/features, this requires only an
   * authenticated tenant user (not the tenant.features.view RBAC permission), because navigation
   * and feature-aware UI must be able to render for every role. */
  @Get('tenant/entitlements/effective')
  @UseGuards(JwtAuthGuard, TenantMatchGuard)
  async getEffectiveEntitlements(): Promise<EffectiveEntitlementsResponseDto> {
    return this.tenantsService.getEffectiveEntitlements(this.tenantContext.tenantId as string);
  }

  @Get('tenant/entitlements')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.TENANT_FEATURES_VIEW)
  getEntitlements() {
    return this.tenantsService.listEntitlements(this.tenantContext.tenantId as string);
  }

  // --- Demo route proving @RequireFeature() gating end-to-end (Phase 1 definition-of-done) --

  @Get('tenant/demo/admissions-gate')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, FeatureFlagsGuard)
  @RequireFeature(FEATURE_KEYS.ADMISSIONS)
  admissionsGateDemo() {
    return { ok: true, message: 'This tenant plan includes the admissions module.' };
  }

  // --- Demo route proving granular @RequireEntitlement() gating end-to-end ---

  @Get('tenant/demo/qr-attendance-gate')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, EntitlementFlagsGuard)
  @RequireEntitlement(ENTITLEMENT_KEYS.ATTENDANCE_QR)
  qrAttendanceGateDemo() {
    return { ok: true, message: 'This tenant plan includes the attendance.qr entitlement.' };
  }
}
