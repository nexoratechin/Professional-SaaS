/**
 * Attendance device controller — authenticated device-registry management for admin/faculty:
 * device CRUD, device↔person mappings, the normalized device-event log, manual ingest, on-demand
 * pull synchronization and reconciliation. Row-level permission checks follow the module
 * convention (@RequirePermission on each route); device-level capability gating (which capture
 * channel a tenant is entitled to) happens in the services via EntitlementsGatewayService.
 *
 * The device self-service/hardware push entry point lives in AttendanceDeviceGatewayController
 * (public, token/HMAC authenticated, no user session).
 */
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import {
  CreateDeviceDto,
  IngestEventsDto,
  ListDeviceLogsQueryDto,
  ListDevicesQueryDto,
  ReconcileDto,
  SyncDeviceDto,
  UpdateDeviceDto,
  UpsertDeviceMappingDto,
} from './attendance-device.dto';
import { AttendanceDevicesService } from './devices/attendance-devices.service';

@ApiTags('attendance')
@Controller('attendance')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.ATTENDANCE)
export class AttendanceDevicesController {
  constructor(
    private readonly devicesService: AttendanceDevicesService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Registry ─────────────────────────────────────────────────────────────

  @Get('devices')
  @RequirePermission(K.ATTENDANCE_VIEW)
  listDevices(@Query() query: ListDevicesQueryDto, @CurrentUser() _user: AuthenticatedUser) {
    return this.devicesService.listDevices(this.tid(), query);
  }

  @Post('devices')
  @RequirePermission(K.ATTENDANCE_MANAGE)
  createDevice(@Body() dto: CreateDeviceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.createDevice(this.tid(), user.id, dto);
  }

  @Post('devices/:id/sync')
  @RequirePermission(K.ATTENDANCE_MANAGE)
  syncDevice(@Param('id') id: string, @Body() dto: SyncDeviceDto, @CurrentUser() _user: AuthenticatedUser) {
    return this.devicesService.syncDevice(this.tid(), id, dto);
  }

  @Post('devices/:id/ingest')
  @RequirePermission(K.ATTENDANCE_CREATE)
  ingestRows(@Param('id') id: string, @Body() dto: IngestEventsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.ingestRows(this.tid(), user.id, id, dto.events);
  }

  @Get('devices/:id/mappings')
  @RequirePermission(K.ATTENDANCE_VIEW)
  listMappings(@Param('id') id: string, @CurrentUser() _user: AuthenticatedUser) {
    return this.devicesService.listMappings(this.tid(), id);
  }

  @Post('devices/:id/mappings')
  @RequirePermission(K.ATTENDANCE_UPDATE)
  upsertMapping(@Param('id') id: string, @Body() dto: UpsertDeviceMappingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.upsertMapping(this.tid(), user.id, id, dto);
  }

  @Delete('devices/mappings/:mappingId')
  @RequirePermission(K.ATTENDANCE_UPDATE)
  removeMapping(@Param('mappingId') mappingId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.removeMapping(this.tid(), user.id, mappingId);
  }

  @Get('devices/:id')
  @RequirePermission(K.ATTENDANCE_VIEW)
  getDevice(@Param('id') id: string, @CurrentUser() _user: AuthenticatedUser) {
    return this.devicesService.getDevice(this.tid(), id);
  }

  @Patch('devices/:id')
  @RequirePermission(K.ATTENDANCE_MANAGE)
  updateDevice(@Param('id') id: string, @Body() dto: UpdateDeviceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.updateDevice(this.tid(), user.id, id, dto);
  }

  @Delete('devices/:id')
  @RequirePermission(K.ATTENDANCE_MANAGE)
  removeDevice(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.removeDevice(this.tid(), user.id, id);
  }

  // ── Device event log ─────────────────────────────────────────────────────

  @Get('device-logs')
  @RequirePermission(K.ATTENDANCE_VIEW)
  listLogs(@Query() query: ListDeviceLogsQueryDto, @CurrentUser() _user: AuthenticatedUser) {
    return this.devicesService.listLogs(this.tid(), query);
  }

  // ── Reconciliation ───────────────────────────────────────────────────────

  @Post('reconcile')
  @RequirePermission(K.ATTENDANCE_MANAGE)
  reconcile(@Body() dto: ReconcileDto, @CurrentUser() user: AuthenticatedUser) {
    return this.devicesService.reconcile(this.tid(), user.id, dto);
  }
}