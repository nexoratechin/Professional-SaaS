/**
 * Integrations admin API — tenant-facing CRUD, testing, dispatch, sync and log reads.
 *
 * Guarded by JWT + tenant match + permission + entitlement exactly like every other tenant feature
 * module. The public inbound surface lives in IntegrationWebhooksController, which is deliberately
 * unauthenticated and excluded from TenantResolutionMiddleware.
 *
 * Two permissions, matching the existing catalog rather than adding new keys:
 * `integrations.view` for every read, `integrations.manage` for every mutation. Credentials are
 * write-only — there is no endpoint that returns a decrypted secret, by design.
 */

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
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
import { IntegrationsDispatchService } from './integrations-dispatch.service';
import { IntegrationsService } from './integrations.service';
import {
  ChangeIntegrationStatusDto,
  CreateIntegrationDto,
  CreateWebhookEndpointDto,
  DispatchOperationDto,
  FailureFilterDto,
  IntegrationFilterDto,
  OperationFilterDto,
  ResolveFailureDto,
  StartSyncRunDto,
  SyncRunFilterDto,
  UpdateIntegrationDto,
  UpdateWebhookEndpointDto,
  WebhookEventFilterDto,
} from './dto/integrations.dto';

@ApiTags('integrations')
@Controller('integrations')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.INTEGRATIONS)
export class IntegrationsController {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly dispatchService: IntegrationsDispatchService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tenantId(): string {
    const tenantId = this.tenantContext.tenantId;
    if (!tenantId) {
      throw new Error('Tenant context missing on an integrations route.');
    }
    return tenantId;
  }

  // ── Catalog + reads ─────────────────────────────────────────────────────────

  /** Drives the configuration form. Requires only `view`, since rendering a form reads nothing. */
  @Get('catalog')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  catalog() {
    return this.integrationsService.catalog();
  }

  @Get()
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  list(@Query() query: IntegrationFilterDto) {
    return this.integrationsService.list(query);
  }

  @Get('summary')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  summary() {
    return this.integrationsService.summary();
  }

  @Get('operations')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  listOperations(@Query() query: OperationFilterDto) {
    return this.integrationsService.listOperations(query);
  }

  @Get('webhook-events')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  listWebhookEvents(@Query() query: WebhookEventFilterDto) {
    return this.integrationsService.listWebhookEvents(query);
  }

  @Get('failures')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  listFailures(@Query() query: FailureFilterDto) {
    return this.integrationsService.listFailures(query);
  }

  @Get('sync-runs')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  listSyncRuns(@Query() query: SyncRunFilterDto) {
    return this.integrationsService.listSyncRuns(query);
  }

  @Get('sync-runs/:id')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  getSyncRun(@Param('id') id: string) {
    return this.integrationsService.getSyncRun(id);
  }

  // Static segments are declared before `:id` so "operations/retry" is never parsed as an id.
  @Get('operations/retry/:id')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  retryOperation(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.retryOperation(id, user.id);
  }

  @Get(':id')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  get(@Param('id') id: string) {
    return this.integrationsService.get(id);
  }

  // ── Integration mutations ───────────────────────────────────────────────────

  @Post()
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  create(@Body() dto: CreateIntegrationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.create(dto, user.id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  update(@Param('id') id: string, @Body() dto: UpdateIntegrationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.update(id, dto, user.id);
  }

  @Post(':id/status')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeIntegrationStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrationsService.changeStatus(id, dto.status, user.id);
  }

  @Delete(':id')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.remove(id, user.id);
  }

  @Post(':id/test')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  testConnection(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.testConnection(id, user.id);
  }

  // ── Outbound dispatch ───────────────────────────────────────────────────────

  @Post(':id/dispatch')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  dispatch(
    @Param('id') id: string,
    @Body() dto: DispatchOperationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.dispatchService.dispatch(id, dto, this.tenantId(), user.id);
  }

  // ── Sync ────────────────────────────────────────────────────────────────────

  @Post(':id/sync')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  startSync(@Param('id') id: string, @Body() dto: StartSyncRunDto, @CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.startSync(
      id,
      dto.entityType,
      dto.mode ?? 'PULL_SYNC',
      dto.scope,
      dto.pageSize,
      user.id,
    );
  }

  @Post('sync-runs/:id/cancel')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  cancelSync(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.cancelSyncRun(id, user.id);
  }

  // ── Webhook endpoints ───────────────────────────────────────────────────────

  @Get(':id/webhook-endpoints')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_VIEW)
  listWebhookEndpoints(@Param('id') id: string) {
    return this.integrationsService.listWebhookEndpoints(id);
  }

  @Post(':id/webhook-endpoints')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  createWebhookEndpoint(
    @Param('id') id: string,
    @Body() dto: CreateWebhookEndpointDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrationsService.createWebhookEndpoint(id, dto, user.id);
  }

  @Patch(':id/webhook-endpoints/:endpointId')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  updateWebhookEndpoint(
    @Param('id') id: string,
    @Param('endpointId') endpointId: string,
    @Body() dto: UpdateWebhookEndpointDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrationsService.updateWebhookEndpoint(id, endpointId, dto, user.id);
  }

  @Post(':id/webhook-endpoints/:endpointId/rotate')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  rotateEndpoint(@Param('id') id: string, @Param('endpointId') endpointId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.integrationsService.rotateWebhookEndpointSecret(id, endpointId, user.id);
  }

  @Delete(':id/webhook-endpoints/:endpointId')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  removeWebhookEndpoint(
    @Param('id') id: string,
    @Param('endpointId') endpointId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrationsService.removeWebhookEndpoint(id, endpointId, user.id);
  }

  // ── Failure triage ─────────────────────────────────────────────────────────

  @Post('failures/:id/resolve')
  @RequirePermission(PERMISSION_KEYS.INTEGRATIONS_MANAGE)
  resolveFailure(
    @Param('id') id: string,
    @Body() dto: ResolveFailureDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.integrationsService.resolveFailure(id, dto.resolved ?? true, dto.note, user.id);
  }
}
