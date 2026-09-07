import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedPlatformUser, AuthenticatedUser } from '@college-erp/auth';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { UpdatePlatformSecuritySettingsDto } from './dto/update-platform-security-settings.dto';
import { UpdateTenantSecuritySettingsDto } from './dto/update-tenant-security-settings.dto';
import { SecuritySettingsService } from './security-settings.service';

@ApiTags('security')
@Controller()
export class SecuritySettingsController {
  constructor(
    private readonly securitySettingsService: SecuritySettingsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // --- Platform level ---------------------------------------------------------------------

  @Get('platform/security-settings')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  getPlatformSettings() {
    return this.securitySettingsService.getPlatformSettings();
  }

  @Patch('platform/security-settings')
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  updatePlatformSettings(
    @Body() dto: UpdatePlatformSecuritySettingsDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.securitySettingsService.updatePlatformSettings(dto, platformUser.id);
  }

  // --- Tenant level -------------------------------------------------------------------------

  @Get('tenant/security-settings')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.SECURITY_SETTINGS_VIEW)
  getTenantSettings() {
    return this.securitySettingsService.getTenantSettings(this.tenantContext.tenantId as string);
  }

  @Patch('tenant/security-settings')
  @UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
  @RequirePermission(PERMISSION_KEYS.SECURITY_SETTINGS_MANAGE)
  updateTenantSettings(@Body() dto: UpdateTenantSecuritySettingsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.securitySettingsService.updateTenantSettings(this.tenantContext.tenantId as string, dto, user.id);
  }
}
