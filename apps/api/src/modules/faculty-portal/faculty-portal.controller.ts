/**
 * Faculty Portal self-service API. Every route is anchored to the authenticated user's own
 * Employee record (Employee.userId) and, for teaching data, to the course offerings they are
 * assigned to via CourseOfferingFaculty — there is no :employeeId path parameter to tamper with.
 * Guards: JwtAuthGuard + TenantMatchGuard on the class; FeatureFlagsGuard on each route via
 * @RequireFeature so a tenant plan without a module never exposes that module's data here either.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { FacultyPortalService } from './faculty-portal.service';
import {
  FacultyAttendanceQueryDto,
  FacultyAttendanceReportQueryDto,
  FacultyBulkMarksDto,
  FacultyCreateAttendanceSessionDto,
  FacultyLeaveApplicationDto,
  FacultyLeaveQueryDto,
  FacultyMarkAttendanceDto,
  FacultyMarksQueryDto,
  FacultyNoticesQueryDto,
  FacultyReportQueryDto,
  FacultyStudentsQueryDto,
  UpdateFacultyProfileDto,
} from './dto/faculty-portal.dto';

@ApiTags('faculty-portal')
@Controller('faculty-portal')
@UseGuards(JwtAuthGuard, TenantMatchGuard, FeatureFlagsGuard)
export class FacultyPortalController {
  constructor(private readonly portal: FacultyPortalService) {}

  // ── Dashboard & profile ────────────────────────────────────────────────────

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.dashboard(user);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getProfile(user);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateFacultyProfileDto) {
    return this.portal.updateProfile(user, dto);
  }

  // ── Assigned courses & student lists ───────────────────────────────────────

  @Get('courses')
  @RequireFeature(FEATURE_KEYS.ACADEMICS)
  courses(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.courses(user);
  }

  @Get('students')
  @RequireFeature(FEATURE_KEYS.STUDENTS)
  students(@CurrentUser() user: AuthenticatedUser, @Query() query: FacultyStudentsQueryDto) {
    return this.portal.students(user, query);
  }

  // ── Timetable ──────────────────────────────────────────────────────────────

  @Get('timetable')
  @RequireFeature(FEATURE_KEYS.TIMETABLE)
  timetable(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.timetable(user);
  }

  // ── Attendance ─────────────────────────────────────────────────────────────

  @Get('attendance/sessions')
  @RequireFeature(FEATURE_KEYS.ATTENDANCE)
  attendanceSessions(@CurrentUser() user: AuthenticatedUser, @Query() query: FacultyAttendanceQueryDto) {
    return this.portal.attendanceSessions(user, query);
  }

  @Post('attendance/sessions')
  @RequireFeature(FEATURE_KEYS.ATTENDANCE)
  createAttendanceSession(@CurrentUser() user: AuthenticatedUser, @Body() dto: FacultyCreateAttendanceSessionDto) {
    return this.portal.createAttendanceSession(user, dto);
  }

  @Get('attendance/sessions/:id')
  @RequireFeature(FEATURE_KEYS.ATTENDANCE)
  getAttendanceSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.getAttendanceSession(user, id);
  }

  @Post('attendance/sessions/:id/mark')
  @RequireFeature(FEATURE_KEYS.ATTENDANCE)
  markAttendanceSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: FacultyMarkAttendanceDto,
  ) {
    return this.portal.markAttendanceSession(user, id, dto);
  }

  @Post('attendance/sessions/:id/close')
  @RequireFeature(FEATURE_KEYS.ATTENDANCE)
  closeAttendanceSession(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.closeAttendanceSession(user, id);
  }

  @Get('attendance/report')
  @RequireFeature(FEATURE_KEYS.ATTENDANCE)
  attendanceReport(@CurrentUser() user: AuthenticatedUser, @Query() query: FacultyAttendanceReportQueryDto) {
    return this.portal.attendanceReport(user, query);
  }

  // ── Marks entry ────────────────────────────────────────────────────────────

  @Get('marks/subjects')
  @RequireFeature(FEATURE_KEYS.EXAMS)
  marksSubjects(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.marksSubjects(user);
  }

  @Get('marks/subjects/:subjectId')
  @RequireFeature(FEATURE_KEYS.EXAMS)
  marksForSubject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectId') subjectId: string,
    @Query() query: FacultyMarksQueryDto,
  ) {
    return this.portal.marksForSubject(user, subjectId, query);
  }

  @Post('marks/subjects/:subjectId/bulk')
  @RequireFeature(FEATURE_KEYS.EXAMS)
  bulkMarks(
    @CurrentUser() user: AuthenticatedUser,
    @Param('subjectId') subjectId: string,
    @Body() dto: FacultyBulkMarksDto,
  ) {
    return this.portal.bulkMarks(user, subjectId, dto);
  }

  @Post('marks/subjects/:subjectId/submit')
  @RequireFeature(FEATURE_KEYS.EXAMS)
  submitMarks(@CurrentUser() user: AuthenticatedUser, @Param('subjectId') subjectId: string) {
    return this.portal.submitMarks(user, subjectId);
  }

  // ── Assignments & academic information ─────────────────────────────────────

  @Get('academics')
  @RequireFeature(FEATURE_KEYS.ACADEMICS)
  academics(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.academics(user);
  }

  // ── Leave ──────────────────────────────────────────────────────────────────

  @Get('leave')
  @RequireFeature(FEATURE_KEYS.HR)
  leave(@CurrentUser() user: AuthenticatedUser, @Query() query: FacultyLeaveQueryDto) {
    return this.portal.leave(user, query);
  }

  @Post('leave')
  @RequireFeature(FEATURE_KEYS.HR)
  applyLeave(@CurrentUser() user: AuthenticatedUser, @Body() dto: FacultyLeaveApplicationDto) {
    return this.portal.applyLeave(user, dto);
  }

  @Post('leave/:id/cancel')
  @RequireFeature(FEATURE_KEYS.HR)
  cancelLeave(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.cancelLeave(user, id);
  }

  // ── Workload ───────────────────────────────────────────────────────────────

  @Get('workload')
  @RequireFeature(FEATURE_KEYS.HR)
  workload(@CurrentUser() user: AuthenticatedUser, @Query() query: FacultyReportQueryDto) {
    return this.portal.workload(user, query);
  }

  // ── Notifications ──────────────────────────────────────────────────────────

  @Get('notifications')
  @RequireFeature(FEATURE_KEYS.NOTIFICATIONS)
  notifications(@CurrentUser() user: AuthenticatedUser, @Query() query: FacultyNoticesQueryDto) {
    return this.portal.notices(user, query);
  }

  @Post('notifications/:id/read')
  @RequireFeature(FEATURE_KEYS.NOTIFICATIONS)
  markNotificationRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.markNoticeRead(user, id);
  }

  // ── Reports ────────────────────────────────────────────────────────────────

  @Get('reports/overview')
  @RequireFeature(FEATURE_KEYS.REPORTS)
  reports(@CurrentUser() user: AuthenticatedUser, @Query() query: FacultyReportQueryDto) {
    return this.portal.reportsOverview(user, query);
  }
}
