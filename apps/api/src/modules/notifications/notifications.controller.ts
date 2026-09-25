import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS } from '@college-erp/auth';
import type { AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { NotificationAudienceFilter } from '@college-erp/types';
import {
  CampaignAudiencePreviewDto,
  CreateNotificationCampaignDto,
  CreateNotificationEventTriggerDto,
  CreateNotificationProviderConfigDto,
  CreateNotificationTemplateDto,
  NotificationsPaginationDto,
  RegisterPushDeviceDto,
  UpdateNotificationCampaignDto,
  UpdateNotificationPreferenceDto,
  UpdateNotificationProviderConfigDto,
  UpdateNotificationTemplateDto,
} from './dto/notifications.dto';
import { SendNotificationDto } from './dto/send-notification.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@Controller('notifications')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.NOTIFICATIONS)
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ── Direct send / inbox ─────────────────────────────────────────────────────

  @Post()
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_SEND)
  send(@Body() dto: SendNotificationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.send(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Get()
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  list(@Query() query: NotificationsPaginationDto & { status?: string; channel?: string }) {
    return this.notificationsService.list(query);
  }

  @Get('summary')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  summary() {
    return this.notificationsService.summary();
  }

  @Get('templates')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  listTemplates() {
    return this.notificationsService.listTemplates();
  }

  @Post('templates')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_TEMPLATES_MANAGE)
  createTemplate(@Body() dto: CreateNotificationTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.createTemplate(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Get('templates/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  getTemplate(@Param('id') id: string) {
    return this.notificationsService.getTemplate(id);
  }

  @Patch('templates/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_TEMPLATES_MANAGE)
  updateTemplate(@Param('id') id: string, @Body() dto: UpdateNotificationTemplateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.updateTemplate(id, dto, user.id);
  }

  @Delete('templates/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_TEMPLATES_MANAGE)
  deleteTemplate(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.deleteTemplate(id, user.id);
  }

  // ── Campaigns ───────────────────────────────────────────────────────────────

  @Get('campaigns')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  listCampaigns() {
    return this.notificationsService.listCampaigns();
  }

  @Post('campaigns')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CAMPAIGNS_MANAGE)
  createCampaign(@Body() dto: CreateNotificationCampaignDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.createCampaign(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Post('campaigns/preview')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CAMPAIGNS_MANAGE)
  previewAudience(@Body() dto: CampaignAudiencePreviewDto) {
    return this.notificationsService.previewAudience(dto as NotificationAudienceFilter);
  }

  @Get('campaigns/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  getCampaign(@Param('id') id: string) {
    return this.notificationsService.getCampaign(id);
  }

  @Patch('campaigns/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CAMPAIGNS_MANAGE)
  updateCampaign(@Param('id') id: string, @Body() dto: UpdateNotificationCampaignDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.updateCampaign(id, dto, user.id);
  }

  @Post('campaigns/:id/launch')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CAMPAIGNS_MANAGE)
  launchCampaign(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.launchCampaign(id, user.id);
  }

  @Post('campaigns/:id/cancel')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CAMPAIGNS_MANAGE)
  cancelCampaign(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.cancelCampaign(id, user.id);
  }

  @Get('campaigns/:id/deliveries')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  campaignDeliveries(@Param('id') id: string, @Query() query: NotificationsPaginationDto) {
    return this.notificationsService.campaignDeliveries(id, query.skip ?? 0, query.take ?? 50);
  }

  // ── Provider configs ────────────────────────────────────────────────────────

  @Get('provider-configs')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CONFIG_MANAGE)
  listProviderConfigs() {
    return this.notificationsService.listProviderConfigs();
  }

  @Post('provider-configs')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CONFIG_MANAGE)
  createProviderConfig(@Body() dto: CreateNotificationProviderConfigDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.createProviderConfig(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Get('provider-configs/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CONFIG_MANAGE)
  getProviderConfig(@Param('id') id: string) {
    return this.notificationsService.getProviderConfig(id);
  }

  @Patch('provider-configs/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CONFIG_MANAGE)
  updateProviderConfig(@Param('id') id: string, @Body() dto: UpdateNotificationProviderConfigDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.updateProviderConfig(id, dto, user.id);
  }

  @Delete('provider-configs/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_CONFIG_MANAGE)
  deleteProviderConfig(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.deleteProviderConfig(id, user.id);
  }

  // ── Event triggers ──────────────────────────────────────────────────────────

  @Get('triggers')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  listTriggers() {
    return this.notificationsService.listTriggers();
  }

  @Post('triggers')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_TRIGGERS_MANAGE)
  createTrigger(@Body() dto: CreateNotificationEventTriggerDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.createTrigger(this.tenantContext.tenantId as string, dto, user.id);
  }

  @Delete('triggers/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_TRIGGERS_MANAGE)
  deleteTrigger(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.deleteTrigger(id, user.id);
  }

  // ── Preferences / push devices (current user's own) ─────────────────────────

  @Get('preferences')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  listPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listPreferences(user.id);
  }

  @Put('preferences')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  upsertPreference(@Body() dto: UpdateNotificationPreferenceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.upsertPreference(user.id, dto.channel, dto.enabled);
  }

  @Get('push-devices')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  listPushDevices(@CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.listPushDevices(user.id);
  }

  @Post('push-devices')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  registerPushDevice(@Body() dto: RegisterPushDeviceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.registerPushDevice(this.tenantContext.tenantId as string, user.id, dto.deviceToken, dto.platform);
  }

  @Delete('push-devices/:id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  unregisterPushDevice(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notificationsService.unregisterPushDevice(id, user.id);
  }

  // ── Single notification actions ─────────────────────────────────────────────

  @Get(':id')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  getOne(@Param('id') id: string) {
    return this.notificationsService.getOne(id);
  }

  @Post(':id/read')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  markRead(@Param('id') id: string) {
    return this.notificationsService.markRead(id);
  }

  @Post(':id/retry')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_SEND)
  retry(@Param('id') id: string) {
    return this.notificationsService.retry(id);
  }

  @Get(':id/delivery-logs')
  @RequirePermission(PERMISSION_KEYS.NOTIFICATIONS_VIEW)
  deliveryLogs(@Param('id') id: string) {
    return this.notificationsService.deliveryLogs(id);
  }
}