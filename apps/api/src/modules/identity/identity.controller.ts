import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ENTITLEMENT_KEYS, FEATURE_KEYS, PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../../common/decorators/require-entitlement.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { EntitlementFlagsGuard } from '../../common/guards/entitlement-flag.guard';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import {
  ChangeIdentityProviderStatusDto,
  CreateIdentityProviderDto,
  CreateIdentityProviderRoleMappingDto,
  SetIdentityProviderSecretDto,
  UpdateIdentityProviderDto,
} from './dto/identity.dto';
import { IdentityService } from './identity.service';

/**
 * Admin API for enterprise identity (SSO). Guarded by JWT + tenant match + permission +
 * entitlement + feature, exactly like the other tenant feature modules. The client secret is
 * write-only; no endpoint ever returns it.
 */
@ApiTags('identity')
@Controller('identity')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard, EntitlementFlagsGuard)
@RequireFeature(FEATURE_KEYS.INTEGRATIONS)
@RequireEntitlement(ENTITLEMENT_KEYS.SSO_ENABLED)
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Get('providers')
  @RequirePermission(PERMISSION_KEYS.IDENTITY_VIEW)
  list() {
    return this.identityService.list();
  }

  @Post('providers')
  @RequirePermission(PERMISSION_KEYS.IDENTITY_MANAGE)
  create(@Body() dto: CreateIdentityProviderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.identityService.create(dto, user.id);
  }

  @Get('providers/:id')
  @RequirePermission(PERMISSION_KEYS.IDENTITY_VIEW)
  get(@Param('id') id: string) {
    return this.identityService.get(id);
  }

  @Patch('providers/:id')
  @RequirePermission(PERMISSION_KEYS.IDENTITY_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateIdentityProviderDto, @CurrentUser() user: AuthenticatedUser) {
    return this.identityService.update(id, dto, user.id);
  }

  @Patch('providers/:id/secret')
  @RequirePermission(PERMISSION_KEYS.IDENTITY_MANAGE)
  setSecret(
    @Param('id') id: string,
    @Body() dto: SetIdentityProviderSecretDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.identityService.setSecret(id, dto, user.id);
  }

  @Patch('providers/:id/status')
  @RequirePermission(PERMISSION_KEYS.IDENTITY_MANAGE)
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeIdentityProviderStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.identityService.changeStatus(id, dto.status, user.id);
  }

  @Delete('providers/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSION_KEYS.IDENTITY_MANAGE)
  async remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    await this.identityService.remove(id, user.id);
  }

  @Get('providers/:id/role-mappings')
  @RequirePermission(PERMISSION_KEYS.IDENTITY_VIEW)
  listRoleMappings(@Param('id') id: string) {
    return this.identityService.listRoleMappings(id);
  }

  @Post('providers/:id/role-mappings')
  @RequirePermission(PERMISSION_KEYS.IDENTITY_MANAGE)
  createRoleMapping(
    @Param('id') id: string,
    @Body() dto: CreateIdentityProviderRoleMappingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.identityService.createRoleMapping(id, dto, user.id);
  }

  @Delete('providers/:id/role-mappings/:mappingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PERMISSION_KEYS.IDENTITY_MANAGE)
  async deleteRoleMapping(
    @Param('id') id: string,
    @Param('mappingId') mappingId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.identityService.deleteRoleMapping(id, mappingId, user.id);
  }
}
