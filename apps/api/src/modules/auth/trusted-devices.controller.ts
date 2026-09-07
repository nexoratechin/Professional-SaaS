import { Controller, Delete, Get, HttpCode, HttpStatus, Param, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TrustedDevicesService } from './trusted-devices.service';

@ApiTags('auth')
@Controller('auth/trusted-devices')
@UseGuards(JwtAuthGuard, TenantMatchGuard)
export class TrustedDevicesController {
  constructor(
    private readonly trustedDevicesService: TrustedDevicesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.trustedDevicesService.list(this.tenantContext.tenantId as string, user.id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  revoke(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser): Promise<void> {
    return this.trustedDevicesService.revoke(this.tenantContext.tenantId as string, user.id, id);
  }
}
