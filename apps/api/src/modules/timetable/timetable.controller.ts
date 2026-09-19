/**
 * Timetable controller — weekly timetable construction for a term + campus: headers & period
 * grids, conflict-free manual entries, greedy generation from active course offerings, a
 * conflict recheck sweep, holidays, faculty availability, date-specific substitutions, and a
 * per‑timetable change log. Guards follow the feature-module convention; scope grants (which
 * campus/term/own rows a caller may see) are enforced in the service via timetableScopeFilter.
 * Static sub-routes ('lookups', 'availability') are declared before parameter routes so NestJS
 * never treats them as an :id.
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
  CreateAvailabilityDto,
  CreateEntryDto,
  CreateHolidayDto,
  CreateTimetableDto,
  DecideSubstitutionDto,
  GenerateDto,
  ListAvailabilityQueryDto,
  ListEntriesQueryDto,
  ListSubstitutionsQueryDto,
  ListTimetablesQueryDto,
  ReplacePeriodsDto,
  RequestSubstitutionDto,
  TimetablePaginationDto,
  UpdateAvailabilityDto,
  UpdateEntryDto,
  UpdateTimetableDto,
} from './dto/timetable.dto';
import { TimetableService } from './timetable.service';

@ApiTags('timetable')
@Controller('timetable')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.TIMETABLE)
export class TimetableController {
  constructor(
    private readonly timetableService: TimetableService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups (static routes declared before :id) ───────────────────────────

  @Get('lookups')
  @RequirePermission(K.TIMETABLE_VIEW)
  lookups() {
    return this.timetableService.lookups(this.tid());
  }

  @Get('availability')
  @RequirePermission(K.TIMETABLE_VIEW)
  listAvailability(@Query() query: ListAvailabilityQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.listAvailability(this.tid(), user.id, query);
  }

  @Post('availability')
  @RequirePermission(K.TIMETABLE_CREATE)
  createAvailability(@Body() dto: CreateAvailabilityDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.createAvailability(this.tid(), user.id, dto);
  }

  @Patch('availability/:blockId')
  @RequirePermission(K.TIMETABLE_UPDATE)
  updateAvailability(
    @Param('blockId') blockId: string,
    @Body() dto: UpdateAvailabilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timetableService.updateAvailability(this.tid(), user.id, blockId, dto);
  }

  @Delete('availability/:blockId')
  @RequirePermission(K.TIMETABLE_UPDATE)
  deleteAvailability(@Param('blockId') blockId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.deleteAvailability(this.tid(), user.id, blockId);
  }

  // ── Timetable headers ─────────────────────────────────────────────────────

  @Get()
  @RequirePermission(K.TIMETABLE_VIEW)
  list(@Query() query: ListTimetablesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.listTimetables(this.tid(), user.id, query);
  }

  @Post()
  @RequirePermission(K.TIMETABLE_CREATE)
  create(@Body() dto: CreateTimetableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.createTimetable(this.tid(), user.id, dto);
  }

  @Get(':id')
  @RequirePermission(K.TIMETABLE_VIEW)
  detail(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.detail(this.tid(), user.id, id);
  }

  @Patch(':id')
  @RequirePermission(K.TIMETABLE_UPDATE)
  update(@Param('id') id: string, @Body() dto: UpdateTimetableDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.updateTimetable(this.tid(), user.id, id, dto);
  }

  @Post(':id/generate')
  @RequirePermission(K.TIMETABLE_MANAGE)
  generate(@Param('id') id: string, @Body() dto: GenerateDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.generate(this.tid(), user.id, id, dto);
  }

  @Post(':id/publish')
  @RequirePermission(K.TIMETABLE_PUBLISH)
  publish(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.publish(this.tid(), user.id, id);
  }

  @Post(':id/archive')
  @RequirePermission(K.TIMETABLE_UPDATE)
  archive(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.archive(this.tid(), user.id, id);
  }

  // ── Period grid ───────────────────────────────────────────────────────────

  @Get(':id/periods')
  @RequirePermission(K.TIMETABLE_VIEW)
  listPeriods(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.listPeriods(this.tid(), user.id, id);
  }

  @Put(':id/periods')
  @RequirePermission(K.TIMETABLE_UPDATE)
  replacePeriods(@Param('id') id: string, @Body() dto: ReplacePeriodsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.replacePeriods(this.tid(), user.id, id, dto);
  }

  // ── Entries ───────────────────────────────────────────────────────────────

  @Get(':id/entries')
  @RequirePermission(K.TIMETABLE_VIEW)
  listEntries(@Param('id') id: string, @Query() query: ListEntriesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.listEntries(this.tid(), user.id, id, query);
  }

  @Post(':id/entries')
  @RequirePermission(K.TIMETABLE_CREATE)
  createEntry(@Param('id') id: string, @Body() dto: CreateEntryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.createEntry(this.tid(), user.id, id, dto);
  }

  @Patch(':id/entries/:entryId')
  @RequirePermission(K.TIMETABLE_UPDATE)
  updateEntry(
    @Param('id') id: string,
    @Param('entryId') entryId: string,
    @Body() dto: UpdateEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timetableService.updateEntry(this.tid(), user.id, id, entryId, dto);
  }

  @Delete(':id/entries/:entryId')
  @RequirePermission(K.TIMETABLE_UPDATE)
  deleteEntry(@Param('id') id: string, @Param('entryId') entryId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.deleteEntry(this.tid(), user.id, id, entryId);
  }

  // ── Holidays ──────────────────────────────────────────────────────────────

  @Get(':id/holidays')
  @RequirePermission(K.TIMETABLE_VIEW)
  listHolidays(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.listHolidays(this.tid(), user.id, id);
  }

  @Post(':id/holidays')
  @RequirePermission(K.TIMETABLE_CREATE)
  createHoliday(@Param('id') id: string, @Body() dto: CreateHolidayDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.createHoliday(this.tid(), user.id, id, dto);
  }

  @Delete(':id/holidays/:holidayId')
  @RequirePermission(K.TIMETABLE_UPDATE)
  deleteHoliday(
    @Param('id') id: string,
    @Param('holidayId') holidayId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timetableService.deleteHoliday(this.tid(), user.id, id, holidayId);
  }

  // ── Conflicts & history ───────────────────────────────────────────────────

  @Get(':id/conflicts')
  @RequirePermission(K.TIMETABLE_VIEW)
  listConflicts(@Param('id') id: string, @Query() query: TimetablePaginationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.listConflicts(this.tid(), user.id, id, query);
  }

  @Post(':id/conflicts/recheck')
  @RequirePermission(K.TIMETABLE_MANAGE)
  recheckConflicts(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.recheckConflicts(this.tid(), user.id, id);
  }

  @Get(':id/history')
  @RequirePermission(K.TIMETABLE_VIEW)
  listHistory(@Param('id') id: string, @Query() query: TimetablePaginationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.listHistory(this.tid(), user.id, id, query);
  }

  @Get(':id/availability')
  @RequirePermission(K.TIMETABLE_VIEW)
  listAvailabilityForTimetable(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.listAvailabilityForTimetable(this.tid(), user.id, id);
  }

  // ── Substitutions ─────────────────────────────────────────────────────────

  @Get(':id/substitutions')
  @RequirePermission(K.TIMETABLE_VIEW)
  listSubstitutions(
    @Param('id') id: string,
    @Query() query: ListSubstitutionsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timetableService.listSubstitutions(this.tid(), user.id, id, query);
  }

  @Post(':id/substitutions')
  @RequirePermission(K.TIMETABLE_CREATE)
  requestSubstitution(@Param('id') id: string, @Body() dto: RequestSubstitutionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.timetableService.requestSubstitution(this.tid(), user.id, id, dto);
  }

  @Patch(':id/substitutions/:subId')
  @RequirePermission(K.TIMETABLE_UPDATE)
  decideSubstitution(
    @Param('id') id: string,
    @Param('subId') subId: string,
    @Body() dto: DecideSubstitutionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.timetableService.decideSubstitution(this.tid(), user.id, id, subId, dto);
  }
}