import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPlatformUser } from '@college-erp/auth';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { BillingConfigService } from './billing-config.service';
import { UpdateBillingConfigDto } from './dto/update-billing-config.dto';

/** SaaS-wide billing configuration (tax, invoice numbering, grace/retry windows). */
@ApiTags('billing')
@Controller('billing/config')
export class BillingConfigController {
  constructor(private readonly billingConfig: BillingConfigService) {}

  @Get()
  @UseGuards(PlatformAuthGuard)
  get() {
    return this.billingConfig.get();
  }

  @Put()
  @UseGuards(PlatformAuthGuard, PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  update(@Body() dto: UpdateBillingConfigDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.billingConfig.update(dto, platformUser.id);
  }
}