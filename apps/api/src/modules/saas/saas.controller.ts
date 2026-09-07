import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPlatformUser } from '@college-erp/auth';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { RecordUsageEventDto } from './dto/record-usage-event.dto';
import { SaasService } from './saas.service';

@ApiTags('saas')
@Controller()
@UseGuards(PlatformAuthGuard, PlatformRoleGuard)
@RequirePlatformRole('PLATFORM_ADMIN')
export class SaasController {
  constructor(private readonly saasService: SaasService) {}

  @Get('plans')
  listPlans() {
    return this.saasService.listPlans();
  }

  @Post('subscriptions')
  createSubscription(@Body() dto: CreateSubscriptionDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.saasService.createSubscription(dto, platformUser.id);
  }

  @Get('tenants/:tenantId/subscriptions')
  listSubscriptionsForTenant(@Param('tenantId') tenantId: string) {
    return this.saasService.listSubscriptionsForTenant(tenantId);
  }

  @Post('usage')
  recordUsage(@Body() dto: RecordUsageEventDto) {
    return this.saasService.recordUsageEvent(dto);
  }
}
