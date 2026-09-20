/**
 * Exams controller — sessions, papers, eligibility, registration, hall tickets, seating,
 * invigilation, marks entry (DRAFT → SUBMITTED → MODERATED → APPROVED), revaluation and result
 * publication. Guards follow the feature-module convention; scope grants (which program/student
 * rows a caller may see) are enforced in the service via the exams scope filters. Static
 * sub-routes are declared before parameter routes so NestJS never treats 'bulk'/'generate'/
 * 'allocate'/'resolve' etc. as an :id.
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
import { ExamsService } from './exams.service';
import {
  AssignInvigilatorDto,
  BulkMarksDto,
  BulkRegisterDto,
  CheckEligibilityDto,
  CreateExamSessionDto,
  CreateExamSubjectDto,
  CreateRegistrationDto,
  CreateRevaluationDto,
  CreateSeatingPlanDto,
  GenerateHallTicketsDto,
  ListHallTicketsQueryDto,
  ListMarksQueryDto,
  ListRegistrationsQueryDto,
  ListRevaluationQueryDto,
  ListSeatingPlansQueryDto,
  ListSessionsQueryDto,
  ListSubjectsQueryDto,
  ResolveRevaluationDto,
  SetEligibilityRulesDto,
  SessionStatusDto,
  SubjectStatusDto,
  UpdateExamSessionDto,
  UpdateExamSubjectDto,
  UpdateInvigilatorDto,
  UpdateRegistrationStatusDto,
  UpdateSeatAllocationDto,
  UpdateSeatingPlanDto,
  UpsertMarksEntryDto,
} from './dto/exams.dto';

@ApiTags('exams')
@Controller('exams')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.EXAMS)
export class ExamsController {
  constructor(
    private readonly examsService: ExamsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Exam sessions ─────────────────────────────────────────────────────────

  @Get('sessions')
  @RequirePermission(K.EXAMS_VIEW)
  listSessions(@Query() query: ListSessionsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.listSessions(this.tid(), user.id, query);
  }

  @Post('sessions')
  @RequirePermission(K.EXAMS_CREATE)
  createSession(@Body() dto: CreateExamSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.createSession(this.tid(), user.id, dto);
  }

  @Get('sessions/:id')
  @RequirePermission(K.EXAMS_VIEW)
  getSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.getSession(this.tid(), user.id, id);
  }

  @Patch('sessions/:id')
  @RequirePermission(K.EXAMS_UPDATE)
  updateSession(
    @Param('id') id: string,
    @Body() dto: UpdateExamSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.updateSession(this.tid(), user.id, id, dto);
  }

  @Post('sessions/:id/publish-results')
  @RequirePermission(K.EXAMS_PUBLISH)
  publishResults(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.publishResults(this.tid(), user.id, id);
  }

  @Post('sessions/:id/unpublish-results')
  @RequirePermission(K.EXAMS_PUBLISH)
  unpublishResults(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.unpublishResults(this.tid(), user.id, id);
  }

  @Post('sessions/:id/status')
  @RequirePermission(K.EXAMS_UPDATE)
  changeSessionStatus(
    @Param('id') id: string,
    @Body() dto: SessionStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.changeSessionStatus(this.tid(), user.id, id, dto);
  }

  @Delete('sessions/:id')
  @RequirePermission(K.EXAMS_MANAGE)
  deleteSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.deleteSession(this.tid(), user.id, id);
  }

  // ── Subjects (papers) ─────────────────────────────────────────────────────

  @Get('sessions/:sessionId/subjects')
  @RequirePermission(K.EXAMS_VIEW)
  listSubjectsBySession(
    @Param('sessionId') sessionId: string,
    @Query() query: ListSubjectsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.listSubjectsBySession(this.tid(), user.id, sessionId, query);
  }

  @Post('sessions/:sessionId/subjects')
  @RequirePermission(K.EXAMS_CREATE)
  createSubject(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateExamSubjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.createSubject(this.tid(), user.id, sessionId, dto);
  }

  @Post('subjects/:id/invigilators')
  @RequirePermission(K.EXAMS_MANAGE)
  assignInvigilator(
    @Param('id') id: string,
    @Body() dto: AssignInvigilatorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.assignInvigilator(this.tid(), user.id, id, dto);
  }

  @Patch('subjects/:id')
  @RequirePermission(K.EXAMS_UPDATE)
  updateSubject(
    @Param('id') id: string,
    @Body() dto: UpdateExamSubjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.updateSubject(this.tid(), user.id, id, dto);
  }

  @Post('subjects/:id/status')
  @RequirePermission(K.EXAMS_UPDATE)
  changeSubjectStatus(
    @Param('id') id: string,
    @Body() dto: SubjectStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.changeSubjectStatus(this.tid(), user.id, id, dto);
  }

  // ── Marks entry (per subject) ─────────────────────────────────────────────

  @Get('subjects/:subjectId/marks')
  @RequirePermission(K.EXAMS_VIEW)
  listMarks(
    @Param('subjectId') subjectId: string,
    @Query() query: ListMarksQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.listMarks(this.tid(), user.id, subjectId, query);
  }

  @Post('subjects/:subjectId/marks')
  @RequirePermission(K.EXAMS_CREATE)
  upsertMarksEntry(
    @Param('subjectId') subjectId: string,
    @Body() dto: UpsertMarksEntryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.upsertMarksEntry(this.tid(), user.id, subjectId, dto);
  }

  @Post('subjects/:subjectId/marks/bulk')
  @RequirePermission(K.EXAMS_CREATE)
  bulkMarks(
    @Param('subjectId') subjectId: string,
    @Body() dto: BulkMarksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.bulkMarks(this.tid(), user.id, subjectId, dto);
  }

  @Post('subjects/:subjectId/marks/submit-all')
  @RequirePermission(K.EXAMS_UPDATE)
  bulkSubmitMarks(@Param('subjectId') subjectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.bulkSubmitMarks(this.tid(), user.id, subjectId);
  }

  @Post('subjects/:subjectId/marks/moderate-all')
  @RequirePermission(K.EXAMS_APPROVE)
  bulkModerateMarks(@Param('subjectId') subjectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.bulkModerateMarks(this.tid(), user.id, subjectId);
  }

  @Post('marks/:id/submit')
  @RequirePermission(K.EXAMS_UPDATE)
  submitMarks(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.submitMarks(this.tid(), user.id, id);
  }

  @Post('marks/:id/moderate')
  @RequirePermission(K.EXAMS_APPROVE)
  moderateMarks(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.moderateMarks(this.tid(), user.id, id);
  }

  @Post('marks/:id/approve')
  @RequirePermission(K.EXAMS_APPROVE)
  approveMarks(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.approveMarks(this.tid(), user.id, id);
  }

  @Post('marks/:id/reject')
  @RequirePermission(K.EXAMS_APPROVE)
  rejectMarks(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.rejectMarks(this.tid(), user.id, id);
  }

  // ── Eligibility rules ─────────────────────────────────────────────────────

  @Get('sessions/:sessionId/eligibility-rules')
  @RequirePermission(K.EXAMS_VIEW)
  getEligibilityRules(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.getEligibilityRules(this.tid(), user.id, sessionId);
  }

  @Put('sessions/:sessionId/eligibility-rules')
  @RequirePermission(K.EXAMS_MANAGE)
  setEligibilityRules(
    @Param('sessionId') sessionId: string,
    @Body() dto: SetEligibilityRulesDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.setEligibilityRules(this.tid(), user.id, sessionId, dto);
  }

  @Post('sessions/:sessionId/eligibility/check')
  @RequirePermission(K.EXAMS_VIEW)
  checkEligibility(
    @Param('sessionId') sessionId: string,
    @Body() dto: CheckEligibilityDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.checkEligibility(this.tid(), user.id, sessionId, dto);
  }

  // ── Registrations ─────────────────────────────────────────────────────────

  @Get('registrations')
  @RequirePermission(K.EXAMS_VIEW)
  listRegistrations(@Query() query: ListRegistrationsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.listRegistrations(this.tid(), user.id, query);
  }

  @Post('registrations')
  @RequirePermission(K.EXAMS_CREATE)
  createRegistration(@Body() dto: CreateRegistrationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.createRegistration(this.tid(), user.id, dto);
  }

  @Post('registrations/bulk')
  @RequirePermission(K.EXAMS_MANAGE)
  bulkRegister(@Body() dto: BulkRegisterDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.bulkRegister(this.tid(), user.id, dto);
  }

  @Get('registrations/:id')
  @RequirePermission(K.EXAMS_VIEW)
  getRegistration(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.getRegistration(this.tid(), user.id, id);
  }

  @Post('registrations/:id/status')
  @RequirePermission(K.EXAMS_UPDATE)
  updateRegistrationStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRegistrationStatusDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.updateRegistrationStatus(this.tid(), user.id, id, dto);
  }

  // ── Hall tickets ──────────────────────────────────────────────────────────

  @Get('hall-tickets')
  @RequirePermission(K.EXAMS_VIEW)
  listHallTickets(@Query() query: ListHallTicketsQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.listHallTickets(this.tid(), user.id, query);
  }

  @Post('hall-tickets/generate')
  @RequirePermission(K.EXAMS_PUBLISH)
  generateHallTickets(@Body() dto: GenerateHallTicketsDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.generateHallTickets(this.tid(), user.id, dto);
  }

  @Get('hall-tickets/:id')
  @RequirePermission(K.EXAMS_VIEW)
  getHallTicket(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.getHallTicket(this.tid(), user.id, id);
  }

  @Post('hall-tickets/:id/recall')
  @RequirePermission(K.EXAMS_PUBLISH)
  recallHallTicket(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.recallHallTicket(this.tid(), user.id, id);
  }

  // ── Seating plans & allocation ────────────────────────────────────────────

  @Get('seating-plans')
  @RequirePermission(K.EXAMS_VIEW)
  listSeatingPlans(@Query() query: ListSeatingPlansQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.listSeatingPlans(this.tid(), user.id, query);
  }

  @Post('seating-plans')
  @RequirePermission(K.EXAMS_CREATE)
  createSeatingPlan(@Body() dto: CreateSeatingPlanDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.createSeatingPlan(this.tid(), user.id, dto);
  }

  @Get('seating-plans/:id')
  @RequirePermission(K.EXAMS_VIEW)
  getSeatingPlan(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.getSeatingPlan(this.tid(), user.id, id);
  }

  @Patch('seating-plans/:id')
  @RequirePermission(K.EXAMS_UPDATE)
  updateSeatingPlan(
    @Param('id') id: string,
    @Body() dto: UpdateSeatingPlanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.updateSeatingPlan(this.tid(), user.id, id, dto);
  }

  @Post('seating-plans/:id/allocate')
  @RequirePermission(K.EXAMS_MANAGE)
  allocateSeating(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.allocateSeating(this.tid(), user.id, id);
  }

  @Delete('seating-plans/:id')
  @RequirePermission(K.EXAMS_MANAGE)
  deleteSeatingPlan(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.deleteSeatingPlan(this.tid(), user.id, id);
  }

  @Patch('seat-allocations/:id')
  @RequirePermission(K.EXAMS_UPDATE)
  updateSeatAllocation(
    @Param('id') id: string,
    @Body() dto: UpdateSeatAllocationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.updateSeatAllocation(this.tid(), user.id, id, dto);
  }

  // ── Invigilators ──────────────────────────────────────────────────────────

  @Patch('invigilators/:id')
  @RequirePermission(K.EXAMS_MANAGE)
  updateInvigilator(
    @Param('id') id: string,
    @Body() dto: UpdateInvigilatorDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.updateInvigilator(this.tid(), user.id, id, dto);
  }

  @Delete('invigilators/:id')
  @RequirePermission(K.EXAMS_MANAGE)
  removeInvigilator(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.removeInvigilator(this.tid(), user.id, id);
  }

  // ── Revaluation ───────────────────────────────────────────────────────────

  @Get('revaluations')
  @RequirePermission(K.EXAMS_VIEW)
  listRevaluation(@Query() query: ListRevaluationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.listRevaluation(this.tid(), user.id, query);
  }

  @Post('revaluations')
  @RequirePermission(K.EXAMS_CREATE)
  requestRevaluation(@Body() dto: CreateRevaluationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.examsService.requestRevaluation(this.tid(), user.id, dto);
  }

  @Post('revaluations/:id/resolve')
  @RequirePermission(K.EXAMS_APPROVE)
  resolveRevaluation(
    @Param('id') id: string,
    @Body() dto: ResolveRevaluationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.examsService.resolveRevaluation(this.tid(), user.id, id, dto);
  }
}