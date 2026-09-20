import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { AuthenticatedPlatformUser } from '@college-erp/auth';
import { CurrentPlatformUser } from '../../common/decorators/current-platform-user.decorator';
import { RequirePlatformRole } from '../../common/decorators/require-platform-role.decorator';
import { PlatformAuthGuard } from '../../common/guards/platform-auth.guard';
import { PlatformRoleGuard } from '../../common/guards/platform-role.guard';
import { AddSubscriptionItemDto } from './dto/add-subscription-item.dto';
import { CancelAtPeriodEndDto } from './dto/cancel-at-period-end.dto';
import { ChangePlanDto } from './dto/change-plan.dto';
import { CreateFeatureFlagDto } from './dto/create-feature-flag.dto';
import { CreatePlanDto } from './dto/create-plan.dto';
import { CreateSubscriptionDto } from './dto/create-subscription.dto';
import { RecordUsageEventDto } from './dto/record-usage-event.dto';
import { SetPlanModulesDto } from './dto/set-plan-modules.dto';
import { TransitionSubscriptionStatusDto } from './dto/transition-subscription-status.dto';
import { UpdateFeatureFlagDto } from './dto/update-feature-flag.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { UpdateSubscriptionItemDto } from './dto/update-subscription-item.dto';
import { SaasService } from './saas.service';

/** Every route here requires an authenticated platform user; catalog/lifecycle MUTATIONS
 * (plans, feature flags, subscriptions) are further restricted to PLATFORM_ADMIN via the
 * per-method decorator below — PLATFORM_SUPPORT can read but never change billing/entitlements. */
@ApiTags('saas')
@Controller()
@UseGuards(PlatformAuthGuard)
export class SaasController {
  constructor(private readonly saasService: SaasService) {}

  @Get('plans')
  listPlans(@Query('includeInactive') includeInactive?: string) {
    return this.saasService.listPlans(includeInactive === 'true');
  }

  @Get('plans/:id')
  getPlan(@Param('id') id: string) {
    return this.saasService.getPlan(id);
  }

  @Get('plans/:id/modules')
  listPlanModules(@Param('id') id: string) {
    return this.saasService.listPlanModules(id);
  }

  @Patch('plans/:id/modules')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  setPlanModules(
    @Param('id') id: string,
    @Body() dto: SetPlanModulesDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.setPlanModules(id, dto, platformUser.id);
  }

  @Post('plans')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  createPlan(@Body() dto: CreatePlanDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.saasService.createPlan(dto, platformUser.id);
  }

  @Patch('plans/:id')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  updatePlan(
    @Param('id') id: string,
    @Body() dto: UpdatePlanDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.updatePlan(id, dto, platformUser.id);
  }

  @Get('feature-flags')
  listFeatureFlags() {
    return this.saasService.listFeatureFlags();
  }

  @Post('feature-flags')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  createFeatureFlag(@Body() dto: CreateFeatureFlagDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.saasService.createFeatureFlag(dto, platformUser.id);
  }

  @Patch('feature-flags/:id')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  updateFeatureFlag(
    @Param('id') id: string,
    @Body() dto: UpdateFeatureFlagDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.updateFeatureFlag(id, dto, platformUser.id);
  }

  @Post('subscriptions')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  createSubscription(@Body() dto: CreateSubscriptionDto, @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser) {
    return this.saasService.createSubscription(dto, platformUser.id);
  }

  @Get('tenants/:tenantId/subscriptions')
  listSubscriptionsForTenant(@Param('tenantId') tenantId: string) {
    return this.saasService.listSubscriptionsForTenant(tenantId);
  }

  @Get('subscriptions/:id')
  getSubscription(@Param('id') id: string) {
    return this.saasService.getSubscription(id);
  }

  @Post('subscriptions/:id/activate')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  activateSubscription(
    @Param('id') id: string,
    @Body() dto: TransitionSubscriptionStatusDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.activateSubscription(id, dto, platformUser.id);
  }

  @Post('subscriptions/:id/suspend')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  suspendSubscription(
    @Param('id') id: string,
    @Body() dto: TransitionSubscriptionStatusDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.suspendSubscription(id, dto, platformUser.id);
  }

  @Post('subscriptions/:id/cancel')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  cancelSubscription(
    @Param('id') id: string,
    @Body() dto: TransitionSubscriptionStatusDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.cancelSubscription(id, dto, platformUser.id);
  }

  @Post('subscriptions/:id/change-plan')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  changePlan(
    @Param('id') id: string,
    @Body() dto: ChangePlanDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.changePlan(id, dto.planCode, { type: 'PLATFORM_USER', platformUserId: platformUser.id });
  }

  @Post('subscriptions/:id/cancel-at-period-end')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  setCancelAtPeriodEnd(
    @Param('id') id: string,
    @Body() dto: CancelAtPeriodEndDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.setCancelAtPeriodEnd(id, dto, { type: 'PLATFORM_USER', platformUserId: platformUser.id });
  }

  @Post('subscriptions/:id/recalculate-usage')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  recalculateUsageBasedQuantities(@Param('id') id: string) {
    return this.saasService.recalculateUsageBasedQuantities(id);
  }

  @Get('subscriptions/:id/items')
  listSubscriptionItems(@Param('id') id: string) {
    return this.saasService.listSubscriptionItems(id);
  }

  @Post('subscriptions/:id/items')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  addSubscriptionItem(
    @Param('id') id: string,
    @Body() dto: AddSubscriptionItemDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.addSubscriptionItem(id, dto, platformUser.id);
  }

  @Patch('subscription-items/:itemId')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  updateSubscriptionItem(
    @Param('itemId') itemId: string,
    @Body() dto: UpdateSubscriptionItemDto,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.updateSubscriptionItem(itemId, dto, platformUser.id);
  }

  @Delete('subscription-items/:itemId')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  removeSubscriptionItem(
    @Param('itemId') itemId: string,
    @CurrentPlatformUser() platformUser: AuthenticatedPlatformUser,
  ) {
    return this.saasService.removeSubscriptionItem(itemId, platformUser.id);
  }

  @Post('usage')
  @UseGuards(PlatformRoleGuard)
  @RequirePlatformRole('PLATFORM_ADMIN')
  recordUsage(@Body() dto: RecordUsageEventDto) {
    return this.saasService.recordUsageEvent(dto);
  }
}
