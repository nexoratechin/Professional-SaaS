import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { UpdateTenantConfigurationDto } from './dto/update-tenant-configuration.dto';
import { TenantConfigurationService } from './tenant-configuration.service';

/** Tenant self-service configuration engine — read/write the tenant's configuration document
 * (branding, academic calendar, grading, attendance, fees, admissions, numbering, templates). */
@ApiTags('tenant-configuration')
@Controller('tenant/config')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class TenantConfigurationController {
  constructor(
    private readonly tenantConfiguration: TenantConfigurationService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.TENANT_CONFIG_VIEW)
  get() {
    return this.tenantConfiguration.get(this.tenantContext.tenantId as string);
  }

  @Patch()
  @RequirePermission(PERMISSION_KEYS.TENANT_CONFIG_MANAGE)
  update(@Body() dto: UpdateTenantConfigurationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.tenantConfiguration.update(this.tenantContext.tenantId as string, dto, user.id);
  }
}
