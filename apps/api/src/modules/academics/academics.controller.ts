/**
 * Academics controller — course catalog (with prerequisites), curricula & curriculum versions,
 * course offerings & faculty assignment, student course registration, academic advising,
 * progression/promotion & backlogs, and the academic calendar. Guards follow the feature-module
 * convention; scope grants (which program/student rows a caller may see) are enforced in the
 * service via academicScopeFilter. Static sub-routes are declared before parameter routes so
 * NestJS never treats 'bulk'/'report'/'clear' etc. as an :id.
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
import { AcademicsService } from './academics.service';
import {
  AddPrerequisiteDto,
  AssignFacultyDto,
  BulkRegisterDto,
  ClearBacklogsDto,
  CreateAdvisingRecordDto,
  CreateBacklogDto,
  CreateCalendarEventDto,
  CreateCourseDto,
  CreateCourseOfferingDto,
  CreateCourseRegistrationDto,
  CreateCurriculumDto,
  CreateCurriculumVersionDto,
  CreateProgressionRecordDto,
  ListAdvisingQueryDto,
  ListBacklogsQueryDto,
  ListCalendarEventQueryDto,
  ListCourseOfferingsQueryDto,
  ListCourseRegistrationsQueryDto,
  ListCoursesQueryDto,
  ListCurriculaQueryDto,
  ListProgressionQueryDto,
  PromoteBatchDto,
  PublishCalendarDto,
  RegistrationReportQueryDto,
  SetCurriculumCoursesDto,
  UpdateAdvisingRecordDto,
  UpdateBacklogDto,
  UpdateCalendarEventDto,
  UpdateCourseDto,
  UpdateCourseOfferingDto,
  UpdateCourseRegistrationDto,
  UpdateCurriculumDto,
  UpdateCurriculumVersionDto,
  UpdateFacultyAssignmentDto,
} from './dto/academics.dto';

@ApiTags('academics')
@Controller('academics')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.ACADEMICS)
export class AcademicsController {
  constructor(
    private readonly academicsService: AcademicsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Course catalog ────────────────────────────────────────────────────────

  @Get('courses')
  @RequirePermission(K.ACADEMICS_VIEW)
  listCourses(@Query() query: ListCoursesQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listCourses(this.tid(), user.id, query);
  }

  @Post('courses')
  @RequirePermission(K.ACADEMICS_CREATE)
  createCourse(@Body() dto: CreateCourseDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.createCourse(this.tid(), user.id, dto);
  }

  @Get('courses/:id')
  @RequirePermission(K.ACADEMICS_VIEW)
  getCourse(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.getCourse(this.tid(), user.id, id);
  }

  @Patch('courses/:id')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateCourse(
    @Param('id') id: string,
    @Body() dto: UpdateCourseDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateCourse(this.tid(), user.id, id, dto);
  }

  @Post('courses/:id/archive')
  @RequirePermission(K.ACADEMICS_MANAGE)
  archiveCourse(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.archiveCourse(this.tid(), user.id, id);
  }

  @Post('courses/:id/prerequisites')
  @RequirePermission(K.ACADEMICS_CREATE)
  addPrerequisite(
    @Param('id') id: string,
    @Body() dto: AddPrerequisiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.addPrerequisite(this.tid(), user.id, id, dto);
  }

  @Delete('courses/:id/prerequisites/:prerequisiteId')
  @RequirePermission(K.ACADEMICS_DELETE)
  removePrerequisite(
    @Param('id') id: string,
    @Param('prerequisiteId') prerequisiteId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.removePrerequisite(this.tid(), user.id, id, prerequisiteId);
  }

  // ── Curricula & versions ──────────────────────────────────────────────────

  @Get('curricula')
  @RequirePermission(K.ACADEMICS_VIEW)
  listCurricula(@Query() query: ListCurriculaQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listCurricula(this.tid(), user.id, query);
  }

  @Post('curricula')
  @RequirePermission(K.ACADEMICS_CREATE)
  createCurriculum(@Body() dto: CreateCurriculumDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.createCurriculum(this.tid(), user.id, dto);
  }

  @Get('curricula/:id')
  @RequirePermission(K.ACADEMICS_VIEW)
  getCurriculum(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.getCurriculum(this.tid(), user.id, id);
  }

  @Patch('curricula/:id')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateCurriculum(
    @Param('id') id: string,
    @Body() dto: UpdateCurriculumDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateCurriculum(this.tid(), user.id, id, dto);
  }

  @Post('curricula/:id/archive')
  @RequirePermission(K.ACADEMICS_MANAGE)
  archiveCurriculum(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.archiveCurriculum(this.tid(), user.id, id);
  }

  @Get('curricula/:id/versions')
  @RequirePermission(K.ACADEMICS_VIEW)
  listCurriculumVersions(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listCurriculumVersions(this.tid(), user.id, id);
  }

  @Post('curricula/:id/versions')
  @RequirePermission(K.ACADEMICS_CREATE)
  createCurriculumVersion(
    @Param('id') id: string,
    @Body() dto: CreateCurriculumVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.createCurriculumVersion(this.tid(), user.id, id, dto);
  }

  @Get('curriculum-versions/:versionId')
  @RequirePermission(K.ACADEMICS_VIEW)
  getCurriculumVersion(@Param('versionId') versionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.getCurriculumVersion(this.tid(), user.id, versionId);
  }

  @Patch('curriculum-versions/:versionId')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateCurriculumVersion(
    @Param('versionId') versionId: string,
    @Body() dto: UpdateCurriculumVersionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateCurriculumVersion(this.tid(), user.id, versionId, dto);
  }

  @Post('curriculum-versions/:versionId/activate')
  @RequirePermission(K.ACADEMICS_MANAGE)
  activateCurriculumVersion(@Param('versionId') versionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.activateCurriculumVersion(this.tid(), user.id, versionId);
  }

  @Post('curriculum-versions/:versionId/archive')
  @RequirePermission(K.ACADEMICS_MANAGE)
  archiveCurriculumVersion(@Param('versionId') versionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.archiveCurriculumVersion(this.tid(), user.id, versionId);
  }

  @Put('curriculum-versions/:versionId/courses')
  @RequirePermission(K.ACADEMICS_MANAGE)
  setCurriculumCourses(
    @Param('versionId') versionId: string,
    @Body() dto: SetCurriculumCoursesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.setCurriculumCourses(this.tid(), user.id, versionId, dto);
  }

  @Get('curriculum-versions/:versionId/validate')
  @RequirePermission(K.ACADEMICS_VIEW)
  validateCurriculumVersion(@Param('versionId') versionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.validateCurriculumVersion(this.tid(), user.id, versionId);
  }

  // ── Course offerings & faculty ────────────────────────────────────────────

  @Get('course-offerings')
  @RequirePermission(K.ACADEMICS_VIEW)
  listCourseOfferings(@Query() query: ListCourseOfferingsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listCourseOfferings(this.tid(), user.id, query);
  }

  @Post('course-offerings')
  @RequirePermission(K.ACADEMICS_CREATE)
  createCourseOffering(@Body() dto: CreateCourseOfferingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.createCourseOffering(this.tid(), user.id, dto);
  }

  @Get('course-offerings/:id')
  @RequirePermission(K.ACADEMICS_VIEW)
  getCourseOffering(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.getCourseOffering(this.tid(), user.id, id);
  }

  @Patch('course-offerings/:id')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateCourseOffering(
    @Param('id') id: string,
    @Body() dto: UpdateCourseOfferingDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateCourseOffering(this.tid(), user.id, id, dto);
  }

  @Post('course-offerings/:id/cancel')
  @RequirePermission(K.ACADEMICS_MANAGE)
  cancelCourseOffering(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.cancelCourseOffering(this.tid(), user.id, id);
  }

  @Get('course-offerings/:id/faculty')
  @RequirePermission(K.ACADEMICS_VIEW)
  listFacultyByOffering(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listFacultyByOffering(this.tid(), user.id, id);
  }

  @Post('course-offerings/:id/faculty')
  @RequirePermission(K.ACADEMICS_MANAGE)
  assignFaculty(
    @Param('id') id: string,
    @Body() dto: AssignFacultyDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.assignFaculty(this.tid(), user.id, id, dto);
  }

  @Patch('course-offerings/faculty/:assignmentId')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateFacultyAssignment(
    @Param('assignmentId') assignmentId: string,
    @Body() dto: UpdateFacultyAssignmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateFacultyAssignment(this.tid(), user.id, assignmentId, dto);
  }

  @Delete('course-offerings/faculty/:assignmentId')
  @RequirePermission(K.ACADEMICS_DELETE)
  removeFacultyAssignment(@Param('assignmentId') assignmentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.removeFacultyAssignment(this.tid(), user.id, assignmentId);
  }

  @Get('my-offerings')
  @RequirePermission(K.ACADEMICS_VIEW)
  myOfferings(@Query() query: ListCourseOfferingsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.myOfferings(this.tid(), user.id, query);
  }

  // ── Course registration ───────────────────────────────────────────────────

  @Get('registrations')
  @RequirePermission(K.ACADEMICS_VIEW)
  listRegistrations(@Query() query: ListCourseRegistrationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listRegistrations(this.tid(), user.id, query);
  }

  @Get('registrations/report')
  @RequirePermission(K.ACADEMICS_VIEW)
  registrationReport(@Query() query: RegistrationReportQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.registrationReport(this.tid(), user.id, query);
  }

  @Post('registrations')
  @RequirePermission(K.ACADEMICS_CREATE)
  registerStudent(@Body() dto: CreateCourseRegistrationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.registerStudent(this.tid(), user.id, dto);
  }

  @Post('registrations/bulk')
  @RequirePermission(K.ACADEMICS_MANAGE)
  bulkRegister(@Body() dto: BulkRegisterDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.bulkRegister(this.tid(), user.id, dto);
  }

  @Patch('registrations/:registrationId')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateRegistration(
    @Param('registrationId') registrationId: string,
    @Body() dto: UpdateCourseRegistrationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateRegistration(this.tid(), user.id, registrationId, dto);
  }

  // ── Academic advising ─────────────────────────────────────────────────────

  @Get('advising')
  @RequirePermission(K.ACADEMICS_VIEW)
  listAdvising(@Query() query: ListAdvisingQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listAdvisingRecords(this.tid(), user.id, query);
  }

  @Post('advising')
  @RequirePermission(K.ACADEMICS_CREATE)
  createAdvisingRecord(@Body() dto: CreateAdvisingRecordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.createAdvisingRecord(this.tid(), user.id, dto);
  }

  @Patch('advising/:id')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateAdvisingRecord(
    @Param('id') id: string,
    @Body() dto: UpdateAdvisingRecordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateAdvisingRecord(this.tid(), user.id, id, dto);
  }

  @Post('advising/:id/resolve')
  @RequirePermission(K.ACADEMICS_UPDATE)
  resolveAdvisingRecord(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.resolveAdvisingRecord(this.tid(), user.id, id);
  }

  // ── Progression / promotion ───────────────────────────────────────────────

  @Get('progression')
  @RequirePermission(K.ACADEMICS_VIEW)
  listProgression(@Query() query: ListProgressionQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listProgressionRecords(this.tid(), user.id, query);
  }

  @Get('progression/students/:studentId')
  @RequirePermission(K.ACADEMICS_VIEW)
  studentProgressionSummary(@Param('studentId') studentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.studentProgressionSummary(this.tid(), user.id, studentId);
  }

  @Post('progression')
  @RequirePermission(K.ACADEMICS_CREATE)
  recordProgression(@Body() dto: CreateProgressionRecordDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.recordProgression(this.tid(), user.id, dto);
  }

  @Post('progression/promote-batch')
  @RequirePermission(K.ACADEMICS_MANAGE)
  promoteBatch(@Body() dto: PromoteBatchDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.promoteBatch(this.tid(), user.id, dto);
  }

  // ── Backlogs ──────────────────────────────────────────────────────────────

  @Get('backlogs')
  @RequirePermission(K.ACADEMICS_VIEW)
  listBacklogs(@Query() query: ListBacklogsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.listBacklogs(this.tid(), user.id, query);
  }

  @Post('backlogs')
  @RequirePermission(K.ACADEMICS_CREATE)
  createBacklog(@Body() dto: CreateBacklogDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.createBacklog(this.tid(), user.id, dto);
  }

  @Patch('backlogs/:id')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateBacklog(
    @Param('id') id: string,
    @Body() dto: UpdateBacklogDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateBacklog(this.tid(), user.id, id, dto);
  }

  @Post('backlogs/clear')
  @RequirePermission(K.ACADEMICS_MANAGE)
  clearBacklogs(@Body() dto: ClearBacklogsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.clearBacklogs(this.tid(), user.id, dto);
  }

  // ── Academic calendar ─────────────────────────────────────────────────────

  @Get('calendar')
  @RequirePermission(K.ACADEMICS_VIEW)
  listCalendar(@Query() query: ListCalendarEventQueryDto, @CurrentUser() _user: AuthenticatedUser) {
    return this.academicsService.listCalendarEvents(this.tid(), query);
  }

  @Post('calendar')
  @RequirePermission(K.ACADEMICS_CREATE)
  createCalendarEvent(@Body() dto: CreateCalendarEventDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.createCalendarEvent(this.tid(), user.id, dto);
  }

  @Patch('calendar/:id')
  @RequirePermission(K.ACADEMICS_UPDATE)
  updateCalendarEvent(
    @Param('id') id: string,
    @Body() dto: UpdateCalendarEventDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.academicsService.updateCalendarEvent(this.tid(), user.id, id, dto);
  }

  @Delete('calendar/:id')
  @RequirePermission(K.ACADEMICS_DELETE)
  deleteCalendarEvent(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.deleteCalendarEvent(this.tid(), user.id, id);
  }

  @Post('calendar/publish')
  @RequirePermission(K.ACADEMICS_MANAGE)
  publishCalendar(@Body() dto: PublishCalendarDto, @CurrentUser() user: AuthenticatedUser) {
    return this.academicsService.publishCalendar(this.tid(), user.id, dto);
  }
}