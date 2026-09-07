import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';
import { RolesService } from './roles.service';

@ApiTags('roles')
@Controller('roles')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class RolesController {
  constructor(
    private readonly rolesService: RolesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  @RequirePermission(PERMISSION_KEYS.ROLES_VIEW)
  list() {
    return this.rolesService.list();
  }

  @Post()
  @RequirePermission(PERMISSION_KEYS.ROLES_MANAGE)
  create(@Body() dto: CreateRoleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.create(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Patch(':id/permissions')
  @RequirePermission(PERMISSION_KEYS.ROLES_MANAGE)
  setPermissions(@Param('id') id: string, @Body() dto: SetRolePermissionsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.rolesService.setPermissions(this.tenantContext.tenantId as string, id, dto, user.id);
  }
}
