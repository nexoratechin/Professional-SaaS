/**
 * Transport controller — fleet & documents, drivers + assignments, routes & ordered stops,
 * student passes/route allocation with ledger fees, trip runs with per-stop checkpoints,
 * maintenance, alerts, the GPS config/poll/ingest surface, and reports. Guards follow the
 * feature-module convention; static sub-routes are declared before parameter routes so NestJS
 * never treats 'lookups'/'reports'/'maintenance'/'passes'/'trips' etc. as an :id.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  ENTITLEMENT_KEYS,
  FEATURE_KEYS,
  PERMISSION_KEYS as K,
  type AuthenticatedUser,
} from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireEntitlement } from '../../common/decorators/require-entitlement.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { EntitlementFlagsGuard } from '../../common/guards/entitlement-flag.guard';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TransportService } from './transport.service';
import {
  AcknowledgeAlertDto,
  AssignDriverDto,
  CancelTripDto,
  ChargePassDto,
  CreateAlertDto,
  CreateDriverDto,
  CreateMaintenanceDto,
  CreatePassDto,
  CreateRouteDto,
  CreateStopDto,
  CreateTripDto,
  CreateVehicleDocumentDto,
  CreateVehicleDto,
  DuesReportQueryDto,
  GpsPositionIngestDto,
  ListAlertsQueryDto,
  ListDriversQueryDto,
  ListMaintenanceQueryDto,
  ListPassesQueryDto,
  ListRoutesQueryDto,
  ListTripsQueryDto,
  ListVehiclesQueryDto,
  ReorderStopsDto,
  ResolveAlertDto,
  RouteLoadReportQueryDto,
  SetMaintenanceStatusDto,
  SetPassStatusDto,
  SetVehicleStatusDto,
  TripStopCheckpointDto,
  UpdateDriverDto,
  UpdateGpsConfigDto,
  UpdateMaintenanceDto,
  UpdatePassDto,
  UpdateRouteDto,
  UpdateStopDto,
  UpdateVehicleDocumentDto,
  UpdateVehicleDto,
  VehicleUtilizationReportQueryDto,
  WaiveTransportChargeDto,
} from './dto/transport.dto';

@ApiTags('transport')
@Controller('transport')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard, EntitlementFlagsGuard)
@RequireFeature(FEATURE_KEYS.TRANSPORT)
export class TransportController {
  constructor(
    private readonly transportService: TransportService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  @Get('lookups')
  @RequirePermission(K.TRANSPORT_VIEW)
  lookups() {
    return this.transportService.lookups(this.tid());
  }

  @Get('users')
  @RequirePermission(K.TRANSPORT_MANAGE)
  searchUsers(@Query('search') search?: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.transportService.searchUsers(this.tid(), (user as AuthenticatedUser).id, search);
  }

  @Get('students')
  @RequirePermission(K.TRANSPORT_VIEW)
  searchStudents(@Query('search') search?: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.transportService.searchStudents(this.tid(), (user as AuthenticatedUser).id, search);
  }

  // ── Vehicles ──────────────────────────────────────────────────────────────

  @Get('vehicles')
  @RequirePermission(K.TRANSPORT_VIEW)
  listVehicles(@Query() query: ListVehiclesQueryDto) {
    return this.transportService.listVehicles(this.tid(), query);
  }

  @Post('vehicles')
  @RequirePermission(K.TRANSPORT_CREATE)
  createVehicle(@Body() dto: CreateVehicleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createVehicle(this.tid(), user.id, dto);
  }

  @Get('vehicles/:id')
  @RequirePermission(K.TRANSPORT_VIEW)
  getVehicle(@Param('id') id: string) {
    return this.transportService.getVehicle(this.tid(), id);
  }

  @Get('vehicles/:id/positions')
  @RequirePermission(K.TRANSPORT_VIEW)
  @RequireEntitlement(ENTITLEMENT_KEYS.TRANSPORT_GPS)
  listVehiclePositions(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.transportService.listVehiclePositions(this.tid(), id, Number(limit) || 100);
  }

  @Patch('vehicles/:id')
  @RequirePermission(K.TRANSPORT_UPDATE)
  updateVehicle(@Param('id') id: string, @Body() dto: UpdateVehicleDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.updateVehicle(this.tid(), user.id, id, dto);
  }

  @Delete('vehicles/:id')
  @RequirePermission(K.TRANSPORT_DELETE)
  deleteVehicle(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.deleteVehicle(this.tid(), user.id, id);
  }

  @Post('vehicles/:id/status')
  @RequirePermission(K.TRANSPORT_UPDATE)
  setVehicleStatus(@Param('id') id: string, @Body() dto: SetVehicleStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.setVehicleStatus(this.tid(), user.id, id, dto);
  }

  @Get('vehicles/:id/documents')
  @RequirePermission(K.TRANSPORT_VIEW)
  listVehicleDocuments(@Param('id') id: string) {
    return this.transportService.listVehicleDocuments(this.tid(), id);
  }

  @Post('vehicles/:id/documents')
  @RequirePermission(K.TRANSPORT_CREATE)
  createVehicleDocument(@Param('id') id: string, @Body() dto: CreateVehicleDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createVehicleDocument(this.tid(), user.id, id, dto);
  }

  @Patch('vehicle-documents/:id')
  @RequirePermission(K.TRANSPORT_UPDATE)
  updateVehicleDocument(@Param('id') id: string, @Body() dto: UpdateVehicleDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.updateVehicleDocument(this.tid(), user.id, id, dto);
  }

  @Delete('vehicle-documents/:id')
  @RequirePermission(K.TRANSPORT_DELETE)
  deleteVehicleDocument(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.deleteVehicleDocument(this.tid(), user.id, id);
  }

  // ── Drivers ───────────────────────────────────────────────────────────────

  @Get('drivers')
  @RequirePermission(K.TRANSPORT_VIEW)
  listDrivers(@Query() query: ListDriversQueryDto) {
    return this.transportService.listDrivers(this.tid(), query);
  }

  @Post('drivers')
  @RequirePermission(K.TRANSPORT_CREATE)
  createDriver(@Body() dto: CreateDriverDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createDriver(this.tid(), user.id, dto);
  }

  @Get('drivers/:id')
  @RequirePermission(K.TRANSPORT_VIEW)
  getDriver(@Param('id') id: string) {
    return this.transportService.getDriver(this.tid(), id);
  }

  @Patch('drivers/:id')
  @RequirePermission(K.TRANSPORT_UPDATE)
  updateDriver(@Param('id') id: string, @Body() dto: UpdateDriverDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.updateDriver(this.tid(), user.id, id, dto);
  }

  @Delete('drivers/:id')
  @RequirePermission(K.TRANSPORT_DELETE)
  deleteDriver(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.deleteDriver(this.tid(), user.id, id);
  }

  @Post('drivers/:id/assign')
  @RequirePermission(K.TRANSPORT_UPDATE)
  assignDriver(@Param('id') id: string, @Body() dto: AssignDriverDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.assignDriver(this.tid(), user.id, id, dto);
  }

  @Post('drivers/:id/release')
  @RequirePermission(K.TRANSPORT_UPDATE)
  releaseDriver(@Param('id') id: string, @Body() dto: AssignDriverDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.releaseDriver(this.tid(), user.id, id, dto);
  }

  // ── Routes & stops ────────────────────────────────────────────────────────

  @Get('routes')
  @RequirePermission(K.TRANSPORT_VIEW)
  listRoutes(@Query() query: ListRoutesQueryDto) {
    return this.transportService.listRoutes(this.tid(), query);
  }

  @Post('routes')
  @RequirePermission(K.TRANSPORT_CREATE)
  createRoute(@Body() dto: CreateRouteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createRoute(this.tid(), user.id, dto);
  }

  @Get('routes/:id')
  @RequirePermission(K.TRANSPORT_VIEW)
  getRoute(@Param('id') id: string) {
    return this.transportService.getRoute(this.tid(), id);
  }

  @Patch('routes/:id')
  @RequirePermission(K.TRANSPORT_UPDATE)
  updateRoute(@Param('id') id: string, @Body() dto: UpdateRouteDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.updateRoute(this.tid(), user.id, id, dto);
  }

  @Delete('routes/:id')
  @RequirePermission(K.TRANSPORT_DELETE)
  deleteRoute(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.deleteRoute(this.tid(), user.id, id);
  }

  @Post('routes/:id/stops')
  @RequirePermission(K.TRANSPORT_CREATE)
  createStop(@Param('id') id: string, @Body() dto: CreateStopDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createStop(this.tid(), user.id, id, dto);
  }

  @Post('routes/:id/stops/reorder')
  @RequirePermission(K.TRANSPORT_UPDATE)
  reorderStops(@Param('id') id: string, @Body() dto: ReorderStopsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.reorderStops(this.tid(), user.id, id, dto);
  }

  @Patch('routes/stops/:id')
  @RequirePermission(K.TRANSPORT_UPDATE)
  updateStop(@Param('id') id: string, @Body() dto: UpdateStopDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.updateStop(this.tid(), user.id, id, dto);
  }

  @Delete('routes/stops/:id')
  @RequirePermission(K.TRANSPORT_DELETE)
  deleteStop(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.deleteStop(this.tid(), user.id, id);
  }

  // ── Passes (student route allocation) ─────────────────────────────────────

  @Get('passes')
  @RequirePermission(K.TRANSPORT_VIEW)
  listPasses(@Query() query: ListPassesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.listPasses(this.tid(), user.id, query);
  }

  @Post('passes')
  @RequirePermission(K.TRANSPORT_CREATE)
  createPass(@Body() dto: CreatePassDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createPass(this.tid(), user.id, dto);
  }

  @Get('passes/:id')
  @RequirePermission(K.TRANSPORT_VIEW)
  getPass(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.getPass(this.tid(), user.id, id);
  }

  @Patch('passes/:id')
  @RequirePermission(K.TRANSPORT_UPDATE)
  updatePass(@Param('id') id: string, @Body() dto: UpdatePassDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.updatePass(this.tid(), user.id, id, dto);
  }

  @Post('passes/:id/status')
  @RequirePermission(K.TRANSPORT_UPDATE)
  setPassStatus(@Param('id') id: string, @Body() dto: SetPassStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.setPassStatus(this.tid(), user.id, id, dto);
  }

  @Post('passes/:id/charge')
  @RequirePermission(K.TRANSPORT_MANAGE)
  chargePass(@Param('id') id: string, @Body() dto: ChargePassDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createCharge(this.tid(), user.id, id, dto);
  }

  @Get('charges')
  @RequirePermission(K.TRANSPORT_VIEW)
  listCharges(@Query() query: DuesReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.listCharges(this.tid(), user.id, query);
  }

  @Post('charges/:id/waive')
  @RequirePermission(K.TRANSPORT_MANAGE)
  waiveCharge(@Param('id') id: string, @Body() dto: WaiveTransportChargeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.waiveCharge(this.tid(), user.id, id, dto);
  }

  // ── Trips ─────────────────────────────────────────────────────────────────

  @Get('trips')
  @RequirePermission(K.TRANSPORT_VIEW)
  listTrips(@Query() query: ListTripsQueryDto) {
    return this.transportService.listTrips(this.tid(), query);
  }

  @Post('trips')
  @RequirePermission(K.TRANSPORT_CREATE)
  createTrip(@Body() dto: CreateTripDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createTrip(this.tid(), user.id, dto);
  }

  @Get('trips/:id')
  @RequirePermission(K.TRANSPORT_VIEW)
  getTrip(@Param('id') id: string) {
    return this.transportService.getTrip(this.tid(), id);
  }

  @Post('trips/:id/start')
  @RequirePermission(K.TRANSPORT_UPDATE)
  startTrip(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.startTrip(this.tid(), user.id, id);
  }

  @Post('trips/:id/complete')
  @RequirePermission(K.TRANSPORT_UPDATE)
  completeTrip(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.completeTrip(this.tid(), user.id, id);
  }

  @Post('trips/:id/cancel')
  @RequirePermission(K.TRANSPORT_UPDATE)
  cancelTrip(@Param('id') id: string, @Body() dto: CancelTripDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.cancelTrip(this.tid(), user.id, id, dto);
  }

  @Post('trip-stops/:id/checkpoint')
  @RequirePermission(K.TRANSPORT_UPDATE)
  checkpointTripStop(@Param('id') id: string, @Body() dto: TripStopCheckpointDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.checkpointTripStop(this.tid(), user.id, id, dto);
  }

  // ── Maintenance ───────────────────────────────────────────────────────────

  @Get('maintenance')
  @RequirePermission(K.TRANSPORT_VIEW)
  listMaintenance(@Query() query: ListMaintenanceQueryDto) {
    return this.transportService.listMaintenance(this.tid(), query);
  }

  @Post('maintenance')
  @RequirePermission(K.TRANSPORT_CREATE)
  createMaintenance(@Body() dto: CreateMaintenanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createMaintenance(this.tid(), user.id, dto);
  }

  @Patch('maintenance/:id')
  @RequirePermission(K.TRANSPORT_UPDATE)
  updateMaintenance(@Param('id') id: string, @Body() dto: UpdateMaintenanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.updateMaintenance(this.tid(), user.id, id, dto);
  }

  @Post('maintenance/:id/status')
  @RequirePermission(K.TRANSPORT_UPDATE)
  setMaintenanceStatus(@Param('id') id: string, @Body() dto: SetMaintenanceStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.setMaintenanceStatus(this.tid(), user.id, id, dto);
  }

  // ── Alerts ────────────────────────────────────────────────────────────────

  @Get('alerts')
  @RequirePermission(K.TRANSPORT_VIEW)
  listAlerts(@Query() query: ListAlertsQueryDto) {
    return this.transportService.listAlerts(this.tid(), query);
  }

  @Post('alerts')
  @RequirePermission(K.TRANSPORT_CREATE)
  createAlert(@Body() dto: CreateAlertDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.createAlert(this.tid(), user.id, dto);
  }

  @Post('alerts/:id/acknowledge')
  @RequirePermission(K.TRANSPORT_UPDATE)
  acknowledgeAlert(@Param('id') id: string, @Body() dto: AcknowledgeAlertDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.acknowledgeAlert(this.tid(), user.id, id, dto);
  }

  @Post('alerts/:id/resolve')
  @RequirePermission(K.TRANSPORT_UPDATE)
  resolveAlert(@Param('id') id: string, @Body() dto: ResolveAlertDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.resolveAlert(this.tid(), user.id, id, dto);
  }

  // ── GPS config / poll / ingest ────────────────────────────────────────────

  @Get('gps/config')
  @RequirePermission(K.TRANSPORT_VIEW)
  @RequireEntitlement(ENTITLEMENT_KEYS.TRANSPORT_GPS)
  gpsConfig() {
    return this.transportService.gpsConfig(this.tid());
  }

  @Put('gps/config')
  @RequirePermission(K.TRANSPORT_MANAGE)
  @RequireEntitlement(ENTITLEMENT_KEYS.TRANSPORT_GPS)
  updateGpsConfig(@Body() dto: UpdateGpsConfigDto, @CurrentUser() user: AuthenticatedUser) {
    return this.transportService.updateGpsConfig(this.tid(), user.id, dto);
  }

  @Post('gps/poll')
  @RequirePermission(K.TRANSPORT_MANAGE)
  @RequireEntitlement(ENTITLEMENT_KEYS.TRANSPORT_GPS)
  pollGps(@CurrentUser() user: AuthenticatedUser) {
    return this.transportService.pollGps(this.tid(), user.id);
  }

  @Post('gps/positions')
  @RequirePermission(K.TRANSPORT_MANAGE)
  @RequireEntitlement(ENTITLEMENT_KEYS.TRANSPORT_GPS)
  ingestGps(@Body() dto: GpsPositionIngestDto) {
    return this.transportService.ingestGps(this.tid(), dto);
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  @Get('reports/summary')
  @RequirePermission(K.TRANSPORT_VIEW)
  summary() {
    return this.transportService.summary(this.tid());
  }

  @Get('reports/route-load')
  @RequirePermission(K.TRANSPORT_VIEW)
  routeLoadReport(@Query() query: RouteLoadReportQueryDto) {
    return this.transportService.routeLoadReport(this.tid(), query);
  }

  @Get('reports/vehicle-utilization')
  @RequirePermission(K.TRANSPORT_VIEW)
  vehicleUtilizationReport(@Query() query: VehicleUtilizationReportQueryDto) {
    return this.transportService.vehicleUtilizationReport(this.tid(), query);
  }

  @Get('reports/alerts')
  @RequirePermission(K.TRANSPORT_VIEW)
  alertsReport() {
    return this.transportService.alertsReport(this.tid());
  }
}