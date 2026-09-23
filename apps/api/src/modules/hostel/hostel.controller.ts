/**
 * Hostel controller — hostel/buildings/floors/rooms/beds catalog, warden assignments, the
 * booking lifecycle (allocate → check-in → check-out / transfer / cancel), rent charges on the
 * shared student fee ledger, complaints, a visitor logbook, and reports. Guards follow the
 * feature-module convention; static sub-routes are declared before parameter routes so NestJS
 * never treats 'lookups'/'reports' etc. as an :id.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { HostelService } from './hostel.service';
import {
  AddHostelBedsDto,
  AllocateHostelBookingDto,
  AssignHostelComplaintDto,
  AssignHostelWardenDto,
  CancelHostelBookingDto,
  CheckInHostelBookingDto,
  CheckOutHostelBookingDto,
  CheckOutHostelVisitorDto,
  CloseHostelComplaintDto,
  ComplaintsReportQueryDto,
  CreateHostelBookingDto,
  CreateHostelBuildingDto,
  CreateHostelChargeDto,
  CreateHostelComplaintDto,
  CreateHostelFloorDto,
  CreateHostelDto,
  CreateHostelRoomDto,
  CreateHostelVisitorDto,
  HostelDuesQueryDto,
  ListHostelBookingsQueryDto,
  ListHostelChargesQueryDto,
  ListHostelComplaintsQueryDto,
  ListHostelsQueryDto,
  ListHostelVisitorsQueryDto,
  OccupancyReportQueryDto,
  ResolveHostelComplaintDto,
  RoomHistoryQueryDto,
  SetHostelBedStatusDto,
  StudentHistoryQueryDto,
  TransferHostelBookingDto,
  UpdateHostelBedDto,
  UpdateHostelBookingDto,
  UpdateHostelBuildingDto,
  UpdateHostelComplaintDto,
  UpdateHostelDto,
  UpdateHostelFloorDto,
  UpdateHostelRoomDto,
  UpdateHostelVisitorDto,
  UpdateHostelWardenDto,
  VacancyReportQueryDto,
  WaiveHostelChargeDto,
} from './dto/hostel.dto';

@ApiTags('hostel')
@Controller('hostel')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.HOSTEL)
export class HostelController {
  constructor(
    private readonly hostelService: HostelService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  @Get('lookups')
  @RequirePermission(K.HOSTEL_VIEW)
  lookups() {
    return this.hostelService.lookups(this.tid());
  }

  @Get('users')
  @RequirePermission(K.HOSTEL_MANAGE)
  searchUsers(@Query('search') search?: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.hostelService.searchUsers(this.tid(), (user as AuthenticatedUser).id, search);
  }

  @Get('students')
  @RequirePermission(K.HOSTEL_VIEW)
  searchStudents(@Query('search') search?: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.hostelService.searchStudents(this.tid(), (user as AuthenticatedUser).id, search);
  }

  // ── Hostels ───────────────────────────────────────────────────────────────

  @Get('hostels')
  @RequirePermission(K.HOSTEL_VIEW)
  listHostels(@Query() query: ListHostelsQueryDto) {
    return this.hostelService.listHostels(this.tid(), query);
  }

  @Post('hostels')
  @RequirePermission(K.HOSTEL_CREATE)
  createHostel(@Body() dto: CreateHostelDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.createHostel(this.tid(), user.id, dto);
  }

  @Get('hostels/:id')
  @RequirePermission(K.HOSTEL_VIEW)
  getHostel(@Param('id') id: string) {
    return this.hostelService.getHostel(this.tid(), id);
  }

  @Patch('hostels/:id')
  @RequirePermission(K.HOSTEL_UPDATE)
  updateHostel(@Param('id') id: string, @Body() dto: UpdateHostelDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateHostel(this.tid(), user.id, id, dto);
  }

  @Delete('hostels/:id')
  @RequirePermission(K.HOSTEL_DELETE)
  deleteHostel(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.deleteHostel(this.tid(), user.id, id);
  }

  // ── Buildings ─────────────────────────────────────────────────────────────

  @Get('buildings')
  @RequirePermission(K.HOSTEL_VIEW)
  listBuildings(@Query('hostelId') hostelId?: string) {
    return this.hostelService.listBuildings(this.tid(), hostelId);
  }

  @Post('buildings')
  @RequirePermission(K.HOSTEL_CREATE)
  createBuilding(@Body() dto: CreateHostelBuildingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.createBuilding(this.tid(), user.id, dto);
  }

  @Patch('buildings/:id')
  @RequirePermission(K.HOSTEL_UPDATE)
  updateBuilding(@Param('id') id: string, @Body() dto: UpdateHostelBuildingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateBuilding(this.tid(), user.id, id, dto);
  }

  @Delete('buildings/:id')
  @RequirePermission(K.HOSTEL_DELETE)
  deleteBuilding(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.deleteBuilding(this.tid(), user.id, id);
  }

  // ── Floors ────────────────────────────────────────────────────────────────

  @Get('floors')
  @RequirePermission(K.HOSTEL_VIEW)
  listFloors(@Query('buildingId') buildingId?: string) {
    return this.hostelService.listFloors(this.tid(), buildingId);
  }

  @Post('floors')
  @RequirePermission(K.HOSTEL_CREATE)
  createFloor(@Body() dto: CreateHostelFloorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.createFloor(this.tid(), user.id, dto);
  }

  @Patch('floors/:id')
  @RequirePermission(K.HOSTEL_UPDATE)
  updateFloor(@Param('id') id: string, @Body() dto: UpdateHostelFloorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateFloor(this.tid(), user.id, id, dto);
  }

  @Delete('floors/:id')
  @RequirePermission(K.HOSTEL_DELETE)
  deleteFloor(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.deleteFloor(this.tid(), user.id, id);
  }

  // ── Rooms ─────────────────────────────────────────────────────────────────

  @Get('rooms')
  @RequirePermission(K.HOSTEL_VIEW)
  listRooms(@Query('floorId') floorId?: string) {
    return this.hostelService.listRooms(this.tid(), floorId);
  }

  @Post('rooms')
  @RequirePermission(K.HOSTEL_CREATE)
  createRoom(@Body() dto: CreateHostelRoomDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.createRoom(this.tid(), user.id, dto);
  }

  @Patch('rooms/:id')
  @RequirePermission(K.HOSTEL_UPDATE)
  updateRoom(@Param('id') id: string, @Body() dto: UpdateHostelRoomDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateRoom(this.tid(), user.id, id, dto);
  }

  @Delete('rooms/:id')
  @RequirePermission(K.HOSTEL_DELETE)
  deleteRoom(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.deleteRoom(this.tid(), user.id, id);
  }

  // ── Beds ──────────────────────────────────────────────────────────────────

  @Get('beds')
  @RequirePermission(K.HOSTEL_VIEW)
  listBeds(@Query('roomId') roomId?: string) {
    return this.hostelService.listBeds(this.tid(), roomId);
  }

  @Post('rooms/:roomId/beds')
  @RequirePermission(K.HOSTEL_CREATE)
  addBeds(@Param('roomId') roomId: string, @Body() dto: AddHostelBedsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.addBeds(this.tid(), user.id, roomId, dto);
  }

  @Patch('beds/:id')
  @RequirePermission(K.HOSTEL_UPDATE)
  updateBed(@Param('id') id: string, @Body() dto: UpdateHostelBedDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateBed(this.tid(), user.id, id, dto);
  }

  @Post('beds/:id/status')
  @RequirePermission(K.HOSTEL_MANAGE)
  setBedStatus(@Param('id') id: string, @Body() dto: SetHostelBedStatusDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.setBedStatus(this.tid(), user.id, id, dto);
  }

  @Delete('beds/:id')
  @RequirePermission(K.HOSTEL_DELETE)
  deleteBed(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.deleteBed(this.tid(), user.id, id);
  }

  // ── Wardens ───────────────────────────────────────────────────────────────

  @Get('wardens')
  @RequirePermission(K.HOSTEL_VIEW)
  listWardens(@Query('hostelId') hostelId?: string) {
    return this.hostelService.listWardens(this.tid(), hostelId);
  }

  @Post('wardens')
  @RequirePermission(K.HOSTEL_MANAGE)
  assignWarden(@Body() dto: AssignHostelWardenDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.assignWarden(this.tid(), user.id, dto);
  }

  @Patch('wardens/:id')
  @RequirePermission(K.HOSTEL_MANAGE)
  updateWarden(@Param('id') id: string, @Body() dto: UpdateHostelWardenDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateWarden(this.tid(), user.id, id, dto);
  }

  @Delete('wardens/:id')
  @RequirePermission(K.HOSTEL_MANAGE)
  removeWarden(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.removeWarden(this.tid(), user.id, id);
  }

  // ── Bookings ──────────────────────────────────────────────────────────────

  @Get('bookings')
  @RequirePermission(K.HOSTEL_VIEW)
  listBookings(@Query() query: ListHostelBookingsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.listBookings(this.tid(), user.id, query);
  }

  @Get('bookings/:id')
  @RequirePermission(K.HOSTEL_VIEW)
  getBooking(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.getBooking(this.tid(), user.id, id);
  }

  @Post('bookings')
  @RequirePermission(K.HOSTEL_CREATE)
  createBooking(@Body() dto: CreateHostelBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.createBooking(this.tid(), user.id, dto);
  }

  @Patch('bookings/:id')
  @RequirePermission(K.HOSTEL_UPDATE)
  updateBooking(@Param('id') id: string, @Body() dto: UpdateHostelBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateBooking(this.tid(), user.id, id, dto);
  }

  @Post('bookings/:id/allocate')
  @RequirePermission(K.HOSTEL_MANAGE)
  allocateBooking(@Param('id') id: string, @Body() dto: AllocateHostelBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.allocateBooking(this.tid(), user.id, id, dto);
  }

  @Post('bookings/:id/check-in')
  @RequirePermission(K.HOSTEL_MANAGE)
  checkInBooking(@Param('id') id: string, @Body() dto: CheckInHostelBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.checkInBooking(this.tid(), user.id, id, dto);
  }

  @Post('bookings/:id/check-out')
  @RequirePermission(K.HOSTEL_MANAGE)
  checkOutBooking(@Param('id') id: string, @Body() dto: CheckOutHostelBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.checkOutBooking(this.tid(), user.id, id, dto);
  }

  @Post('bookings/:id/transfer')
  @RequirePermission(K.HOSTEL_MANAGE)
  transferBooking(@Param('id') id: string, @Body() dto: TransferHostelBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.transferBooking(this.tid(), user.id, id, dto);
  }

  @Post('bookings/:id/cancel')
  @RequirePermission(K.HOSTEL_MANAGE)
  cancelBooking(@Param('id') id: string, @Body() dto: CancelHostelBookingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.cancelBooking(this.tid(), user.id, id, dto);
  }

  // ── Rent charges ──────────────────────────────────────────────────────────

  @Get('charges')
  @RequirePermission(K.HOSTEL_VIEW)
  listCharges(@Query() query: ListHostelChargesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.listCharges(this.tid(), user.id, query);
  }

  @Post('bookings/:id/charge')
  @RequirePermission(K.HOSTEL_MANAGE)
  createCharge(@Param('id') id: string, @Body() dto: CreateHostelChargeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.createCharge(this.tid(), user.id, id, dto);
  }

  @Patch('charges/:id/waive')
  @RequirePermission(K.HOSTEL_MANAGE)
  waiveCharge(@Param('id') id: string, @Body() dto: WaiveHostelChargeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.waiveCharge(this.tid(), user.id, id, dto);
  }

  // ── Complaints ────────────────────────────────────────────────────────────

  @Get('complaints')
  @RequirePermission(K.HOSTEL_VIEW)
  listComplaints(@Query() query: ListHostelComplaintsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.listComplaints(this.tid(), user.id, query);
  }

  @Post('complaints')
  @RequirePermission(K.HOSTEL_CREATE)
  createComplaint(@Body() dto: CreateHostelComplaintDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.createComplaint(this.tid(), user.id, dto);
  }

  @Patch('complaints/:id')
  @RequirePermission(K.HOSTEL_UPDATE)
  updateComplaint(@Param('id') id: string, @Body() dto: UpdateHostelComplaintDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateComplaint(this.tid(), user.id, id, dto);
  }

  @Post('complaints/:id/assign')
  @RequirePermission(K.HOSTEL_MANAGE)
  assignComplaint(@Param('id') id: string, @Body() dto: AssignHostelComplaintDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.assignComplaint(this.tid(), user.id, id, dto);
  }

  @Post('complaints/:id/resolve')
  @RequirePermission(K.HOSTEL_MANAGE)
  resolveComplaint(@Param('id') id: string, @Body() dto: ResolveHostelComplaintDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.resolveComplaint(this.tid(), user.id, id, dto);
  }

  @Post('complaints/:id/close')
  @RequirePermission(K.HOSTEL_MANAGE)
  closeComplaint(@Param('id') id: string, @Body() dto: CloseHostelComplaintDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.closeComplaint(this.tid(), user.id, id, dto);
  }

  // ── Visitors ──────────────────────────────────────────────────────────────

  @Get('visitors')
  @RequirePermission(K.HOSTEL_VIEW)
  listVisitors(@Query() query: ListHostelVisitorsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.listVisitors(this.tid(), user.id, query);
  }

  @Post('visitors')
  @RequirePermission(K.HOSTEL_CREATE)
  createVisitor(@Body() dto: CreateHostelVisitorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.createVisitor(this.tid(), user.id, dto);
  }

  @Patch('visitors/:id')
  @RequirePermission(K.HOSTEL_UPDATE)
  updateVisitor(@Param('id') id: string, @Body() dto: UpdateHostelVisitorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.updateVisitor(this.tid(), user.id, id, dto);
  }

  @Post('visitors/:id/checkout')
  @RequirePermission(K.HOSTEL_MANAGE)
  checkoutVisitor(@Param('id') id: string, @Body() dto: CheckOutHostelVisitorDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.checkoutVisitor(this.tid(), user.id, id, dto);
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  @Get('reports/summary')
  @RequirePermission(K.HOSTEL_VIEW)
  reportSummary(@Query('hostelId') hostelId?: string, @CurrentUser() user?: AuthenticatedUser) {
    return this.hostelService.reportSummary(this.tid(), (user as AuthenticatedUser).id, hostelId);
  }

  @Get('reports/occupancy')
  @RequirePermission(K.HOSTEL_VIEW)
  reportOccupancy(@Query() query: OccupancyReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.reportOccupancy(this.tid(), user.id, query);
  }

  @Get('reports/vacancy')
  @RequirePermission(K.HOSTEL_VIEW)
  reportVacancy(@Query() query: VacancyReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.reportVacancy(this.tid(), user.id, query);
  }

  @Get('reports/rooms/:roomId/history')
  @RequirePermission(K.HOSTEL_VIEW)
  roomHistory(@Param('roomId') roomId: string, @Query() query: RoomHistoryQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.roomHistory(this.tid(), user.id, roomId, query.take);
  }

  @Get('reports/students/:studentId/history')
  @RequirePermission(K.HOSTEL_VIEW)
  studentHistory(@Param('studentId') studentId: string, @Query() query: StudentHistoryQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.studentHistory(this.tid(), user.id, studentId, query.take);
  }

  @Get('reports/dues')
  @RequirePermission(K.HOSTEL_VIEW)
  reportDues(@Query() query: HostelDuesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.reportDues(this.tid(), user.id, query);
  }

  @Get('reports/complaints')
  @RequirePermission(K.HOSTEL_VIEW)
  reportComplaints(@Query() query: ComplaintsReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.hostelService.reportComplaints(this.tid(), user.id, query.hostelId);
  }
}