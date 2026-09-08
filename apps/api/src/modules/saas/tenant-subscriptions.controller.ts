import { Body, Controller, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { CancelAtPeriodEndDto } from './dto/cancel-at-period-end.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { SaasService } from './saas.service';

/** Tenant self-service subscription billing — change-plan (upgrade/downgrade with prorated
 *  adjustment), and cancel/reinstate at the end of the current period. Gated by BILLING_UPDATE
 *  (seeded to accountants alongside FEES_MANAGE). The tenant's own subscription + invoices +
 *  payments read view lives in the billing module (GET /tenant/billing). */
@ApiTags('tenant-subscriptions')
@Controller('tenant/subscription')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
@RequirePermission(PERMISSION_KEYS.BILLING_UPDATE)
export class TenantSubscriptionsController {
  constructor(
    private readonly saasService: SaasService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private async getOwnChangeableSubscription() {
    const subscription = await this.saasService.getTenantActiveSubscription(this.tenantContext.tenantId as string);
    if (!subscription) {
      throw new NotFoundException('Your tenant has no changeable subscription (trial/active/past-due).');
    }
    return subscription;
  }

  @Post('preview-change')
  async preview(@Body() dto: ChangePlanDto) {
    const subscription = await this.getOwnChangeableSubscription();
    return this.saasService.previewPlanChange(subscription.id, dto.planCode);
  }

  @Post('change-plan')
  async changePlan(@Body() dto: ChangePlanDto, @CurrentUser() user: AuthenticatedUser) {
    const subscription = await this.getOwnChangeableSubscription();
    return this.saasService.changePlan(subscription.id, dto.planCode, { type: 'USER', userId: user.id });
  }

  @Post('cancel-at-period-end')
  async setCancelAtPeriodEnd(@Body() dto: CancelAtPeriodEndDto, @CurrentUser() user: AuthenticatedUser) {
    const subscription = await this.getOwnChangeableSubscription();
    return this.saasService.setCancelAtPeriodEnd(subscription.id, dto, { type: 'USER', userId: user.id });
  }
}