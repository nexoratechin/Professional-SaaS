/**
 * Attendance controller — complete attendance management: sessions with bulk marking, correction
 * requests with an approval workflow, faculty/staff daily logs, and percentage/shortage/summary
 * reports. Guards follow the feature-module convention (JwtAuth + TenantMatch + Permissions +
 * FeatureFlags) with per-route @RequirePermission; row-level scope (which sessions/sections a
 * caller may touch) is enforced in AttendanceService via attendanceScopeFilter plus the students
 * module's student-scope guard. Static sub-routes ('lookups') are declared before parameter
 * routes so NestJS never treats them as an :id.
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
import {
  CreateCorrectionDto,
  CreateSessionDto,
  DecideCorrectionDto,
  ListCorrectionsQueryDto,
  ListFacultyQueryDto,
  ListSessionsQueryDto,
  MarkSessionDto,
  PercentageQueryDto,
  ScopeReportQueryDto,
  UpdateCorrectionDto,
  UpdateFacultyAttendanceDto,
  UpdateSessionDto,
  UpsertFacultyAttendanceDto,
} from './attendance.dto';
import { AttendanceService } from './attendance.service';

@ApiTags('attendance')
@Controller('attendance')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.ATTENDANCE)
export class AttendanceController {
  constructor(
    private readonly attendanceService: AttendanceService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  @Get('lookups')
  @RequirePermission(K.ATTENDANCE_VIEW)
  lookups(@CurrentUser() _user: AuthenticatedUser) {
    return this.attendanceService.lookups(this.tid());
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  @Get('sessions')
  @RequirePermission(K.ATTENDANCE_VIEW)
  listSessions(@Query() query: ListSessionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.listSessions(this.tid(), user.id, query);
  }

  @Post('sessions')
  @RequirePermission(K.ATTENDANCE_CREATE)
  createSession(@Body() dto: CreateSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.createSession(this.tid(), user.id, dto);
  }

  @Get('sessions/:id')
  @RequirePermission(K.ATTENDANCE_VIEW)
  getSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.getSession(this.tid(), user.id, id);
  }

  @Patch('sessions/:id')
  @RequirePermission(K.ATTENDANCE_UPDATE)
  updateSession(@Param('id') id: string, @Body() dto: UpdateSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.updateSession(this.tid(), user.id, id, dto);
  }

  @Post('sessions/:id/close')
  @RequirePermission(K.ATTENDANCE_UPDATE)
  closeSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.closeSession(this.tid(), user.id, id);
  }

  @Post('sessions/:id/mark')
  @RequirePermission(K.ATTENDANCE_CREATE)
  markSession(@Param('id') id: string, @Body() dto: MarkSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.markSession(this.tid(), user.id, id, dto);
  }

  @Delete('sessions/:id')
  @RequirePermission(K.ATTENDANCE_MANAGE)
  removeSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.removeSession(this.tid(), user.id, id);
  }

  // ── Corrections ───────────────────────────────────────────────────────────

  @Get('corrections')
  @RequirePermission(K.ATTENDANCE_VIEW)
  listCorrections(@Query() query: ListCorrectionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.listCorrections(this.tid(), user.id, query);
  }

  @Post('corrections')
  @RequirePermission(K.ATTENDANCE_VIEW)
  createCorrection(@Body() dto: CreateCorrectionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.createCorrection(this.tid(), user.id, dto);
  }

  @Get('corrections/:id')
  @RequirePermission(K.ATTENDANCE_VIEW)
  getCorrection(@Param('id') id: string, @CurrentUser() _user: AuthenticatedUser) {
    return this.attendanceService.getCorrection(this.tid(), id);
  }

  @Patch('corrections/:id')
  @RequirePermission(K.ATTENDANCE_UPDATE)
  updateCorrection(@Param('id') id: string, @Body() dto: UpdateCorrectionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.updateCorrection(this.tid(), user.id, id, dto);
  }

  @Post('corrections/:id/approve')
  @RequirePermission(K.ATTENDANCE_UPDATE)
  approveCorrection(@Param('id') id: string, @Body() dto: DecideCorrectionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.decideCorrection(this.tid(), user.id, id, 'APPROVE', dto);
  }

  @Post('corrections/:id/reject')
  @RequirePermission(K.ATTENDANCE_UPDATE)
  rejectCorrection(@Param('id') id: string, @Body() dto: DecideCorrectionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.decideCorrection(this.tid(), user.id, id, 'REJECT', dto);
  }

  // ── Faculty / staff attendance ────────────────────────────────────────────

  @Get('faculty')
  @RequirePermission(K.ATTENDANCE_VIEW)
  listFaculty(@Query() query: ListFacultyQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.listFacultyAttendance(this.tid(), user.id, query);
  }

  @Post('faculty')
  @RequirePermission(K.ATTENDANCE_CREATE)
  upsertFaculty(@Body() dto: UpsertFacultyAttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.upsertFacultyAttendance(this.tid(), user.id, dto);
  }

  @Patch('faculty/:id')
  @RequirePermission(K.ATTENDANCE_UPDATE)
  updateFaculty(@Param('id') id: string, @Body() dto: UpdateFacultyAttendanceDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.updateFacultyAttendance(this.tid(), user.id, id, dto);
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  @Get('percentage')
  @RequirePermission(K.ATTENDANCE_VIEW)
  percentage(@Query() query: PercentageQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.percentage(this.tid(), user.id, query);
  }

  @Get('shortages')
  @RequirePermission(K.ATTENDANCE_VIEW)
  shortages(@Query() query: ScopeReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.shortages(this.tid(), user.id, query);
  }

  @Get('summary')
  @RequirePermission(K.ATTENDANCE_VIEW)
  summary(@Query() query: ScopeReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.attendanceService.summary(this.tid(), user.id, query);
  }
}