import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS, FEATURE_KEYS } from '@college-erp/auth';
import type { AuthenticatedPlatformUser, AuthenticatedUser } from '@college-erp/auth';
import type { FeatureFlagsResponseDto } from '@college-erp/types';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { SetTenantFeatureOverrideDto } from './dto/set-tenant-feature-override.dto';
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

  @Get('tenants')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  list() {
    return this.tenantsService.listTenants();
  }

  @Get('tenants/:id')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  get(@Param('id') id: string) {
    return this.tenantsService.getTenant(id);
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

  // --- Demo route proving @RequireFeature() gating end-to-end (Phase 1 definition-of-done) --

  @Get('tenant/demo/admissions-gate')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, FeatureFlagsGuard)
  @RequireFeature(FEATURE_KEYS.ADMISSIONS)
  admissionsGateDemo() {
    return { ok: true, message: 'This tenant plan includes the admissions module.' };
  }
}
