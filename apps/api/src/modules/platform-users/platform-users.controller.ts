import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPlatformUser } from '@college-erp/auth';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { CreatePlatformUserDto } from './dto/create-platform-user.dto';
import { ResetPlatformUserPasswordDto } from './dto/reset-platform-user-password.dto';
import { UpdatePlatformUserDto } from './dto/update-platform-user.dto';
import { PlatformUsersService } from './platform-users.service';

/**
 * Operator directory for the platform realm ("User Management" in the superadmin console).
 * Unlike every tenant-users endpoint, this has no tenant context at all — these accounts are the
 * people who administer tenants. Admin-only end to end: a support operator can triage colleges,
 * but must not be able to create or promote another platform admin.
 */
@ApiTags('platform-users')
@Controller('platform/users')
@UseGuards(PlatformAuthGuard, PlatformRoleGuard)
@RequirePlatformRole('PLATFORM_ADMIN')
export class PlatformUsersController {
  constructor(private readonly platformUsers: PlatformUsersService) {}

  @Get()
  list() {
    return this.platformUsers.list();
  }

  @Post()
  create(@Body() dto: CreatePlatformUserDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.platformUsers.create(dto, platformUser.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePlatformUserDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.platformUsers.update(id, dto, platformUser.id);
  }

  @Post(':id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @Body() dto: ResetPlatformUserPasswordDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    await this.platformUsers.resetPassword(id, dto.password, platformUser.id);
    return { ok: true };
  }
}
