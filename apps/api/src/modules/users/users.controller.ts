import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { AssignRoleDto } from './dto/assign-role.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Post()
  @RequirePermission(PERMISSION_KEYS.USERS_MANAGE)
  invite(@Body() dto: InviteUserDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.invite(
      this.tenantContext.tenantId as string,
      this.tenantContext.tenantSlug as string,
      dto,
      user.id,
    );
  }

  @Get()
  @RequirePermission(PERMISSION_KEYS.USERS_VIEW)
  list() {
    return this.usersService.list();
  }

  @Get(':id')
  @RequirePermission(PERMISSION_KEYS.USERS_VIEW)
  get(@Param('id') id: string) {
    return this.usersService.get(id);
  }

  @Patch(':id/status')
  @RequirePermission(PERMISSION_KEYS.USERS_MANAGE)
  updateStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.updateStatus(this.tenantContext.tenantId as string, id, dto, user.id);
  }

  @Post(':id/roles/:roleId')
  @RequirePermission(PERMISSION_KEYS.ROLES_MANAGE)
  assignRole(
    @Param('id') id: string,
    @Param('roleId') roleId: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.assignRole(this.tenantContext.tenantId as string, id, roleId, dto, user.id);
  }

  @Delete(':id/roles/:roleId')
  @RequirePermission(PERMISSION_KEYS.ROLES_MANAGE)
  unassignRole(@Param('id') id: string, @Param('roleId') roleId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.usersService.unassignRole(this.tenantContext.tenantId as string, id, roleId, user.id);
  }
}
