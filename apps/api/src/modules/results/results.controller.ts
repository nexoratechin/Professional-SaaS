/**
 * Results controller — configurable grading schemes, assessment components, component marks,
 * session calculation, per-student approval/publish/lock lifecycle, bulk actions, history and
 * exports. Guards follow the feature-module convention; scope grants are enforced in the service.
 * Static sub-routes (bulk) are declared before parameter routes so NestJS never treats 'bulk'
 * as a :studentId, and 'default' before :schemeId.
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
import { ResultsService } from './results.service';
import {
  BulkProcessActionDto,
  CalculateSessionDto,
  CreateComponentDto,
  CreateGradingSchemeDto,
  ListComponentsQueryDto,
  ListMarksEntriesQueryDto,
  ListProcessesQueryDto,
  ReplaceGradeScaleDto,
  ResultsPaginationDto,
  SaveComponentMarksDto,
  SessionResultConfigDto,
  UpdateComponentDto,
  UpdateGradingSchemeDto,
} from './dto/results.dto';

@ApiTags('results')
@Controller('results')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.RESULTS)
export class ResultsController {
  constructor(
    private readonly resultsService: ResultsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Grading schemes ───────────────────────────────────────────────────────

  @Get('grading-schemes')
  @RequirePermission(K.RESULTS_VIEW)
  listSchemes(@Query() query: ResultsPaginationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.listSchemes(this.tid(), user.id, query);
  }

  @Post('grading-schemes')
  @RequirePermission(K.RESULTS_MANAGE)
  createScheme(@Body() dto: CreateGradingSchemeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.createScheme(this.tid(), user.id, dto);
  }

  @Get('grading-schemes/default')
  @RequirePermission(K.RESULTS_MANAGE)
  ensureDefaultScheme() {
    return this.resultsService.ensureDefaultScheme(this.tid());
  }

  @Get('grading-schemes/:id')
  @RequirePermission(K.RESULTS_VIEW)
  getScheme(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.getScheme(this.tid(), user.id, id);
  }

  @Patch('grading-schemes/:id')
  @RequirePermission(K.RESULTS_MANAGE)
  updateScheme(
    @Param('id') id: string,
    @Body() dto: UpdateGradingSchemeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.updateScheme(this.tid(), user.id, id, dto);
  }

  @Put('grading-schemes/:id/scale')
  @RequirePermission(K.RESULTS_MANAGE)
  replaceSchemeScale(
    @Param('id') id: string,
    @Body() dto: ReplaceGradeScaleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.replaceSchemeScale(this.tid(), user.id, id, dto);
  }

  @Post('grading-schemes/:id/default')
  @RequirePermission(K.RESULTS_MANAGE)
  makeDefaultScheme(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.makeDefaultScheme(this.tid(), user.id, id);
  }

  @Delete('grading-schemes/:id')
  @RequirePermission(K.RESULTS_MANAGE)
  deleteScheme(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.deleteScheme(this.tid(), user.id, id);
  }

  // ── Session result configuration ──────────────────────────────────────────

  @Get('sessions/:sessionId/config')
  @RequirePermission(K.RESULTS_VIEW)
  getSessionConfig(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.getSessionConfig(this.tid(), user.id, sessionId);
  }

  @Patch('sessions/:sessionId/config')
  @RequirePermission(K.RESULTS_MANAGE)
  updateSessionConfig(
    @Param('sessionId') sessionId: string,
    @Body() dto: SessionResultConfigDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.updateSessionConfig(this.tid(), user.id, sessionId, dto);
  }

  @Post('sessions/:sessionId/results-lock')
  @RequirePermission(K.RESULTS_PUBLISH)
  lockSessionResults(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.lockSessionResults(this.tid(), user.id, sessionId);
  }

  @Post('sessions/:sessionId/results-unlock')
  @RequirePermission(K.RESULTS_PUBLISH)
  unlockSessionResults(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.unlockSessionResults(this.tid(), user.id, sessionId);
  }

  // ── Assessment components & component marks ───────────────────────────────

  @Get('sessions/:sessionId/components')
  @RequirePermission(K.RESULTS_VIEW)
  listComponents(
    @Param('sessionId') sessionId: string,
    @Query() query: ListComponentsQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.listComponents(this.tid(), user.id, sessionId, query);
  }

  @Post('sessions/:sessionId/components')
  @RequirePermission(K.RESULTS_MANAGE)
  createComponent(
    @Param('sessionId') sessionId: string,
    @Body() dto: CreateComponentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.createComponent(this.tid(), user.id, sessionId, dto);
  }

  @Patch('components/:componentId')
  @RequirePermission(K.RESULTS_MANAGE)
  updateComponent(
    @Param('componentId') componentId: string,
    @Body() dto: UpdateComponentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.updateComponent(this.tid(), user.id, componentId, dto);
  }

  @Delete('components/:componentId')
  @RequirePermission(K.RESULTS_MANAGE)
  deleteComponent(@Param('componentId') componentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.deleteComponent(this.tid(), user.id, componentId);
  }

  @Get('subjects/:subjectId/component-marks')
  @RequirePermission(K.RESULTS_VIEW)
  listComponentMarks(@Param('subjectId') subjectId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.listComponentMarks(this.tid(), user.id, subjectId);
  }

  @Get('sessions/:sessionId/marks-entries')
  @RequirePermission(K.RESULTS_VIEW)
  listMarksEntries(
    @Param('sessionId') sessionId: string,
    @Query() query: ListMarksEntriesQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.listMarksEntries(this.tid(), user.id, sessionId, query);
  }

  @Put('subjects/:subjectId/component-marks')
  @RequirePermission(K.RESULTS_MANAGE)
  saveComponentMarks(
    @Param('subjectId') subjectId: string,
    @Body() dto: SaveComponentMarksDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.saveComponentMarks(this.tid(), user.id, subjectId, dto);
  }

  // ── Calculation & lifecycle ───────────────────────────────────────────────

  @Post('sessions/:sessionId/calculate')
  @RequirePermission(K.RESULTS_MANAGE)
  calculateSession(
    @Param('sessionId') sessionId: string,
    @Body() dto: CalculateSessionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.calculateSession(this.tid(), user.id, sessionId, dto);
  }

  @Get('sessions/:sessionId/processes')
  @RequirePermission(K.RESULTS_VIEW)
  listProcesses(
    @Param('sessionId') sessionId: string,
    @Query() query: ListProcessesQueryDto & ResultsPaginationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.listProcesses(this.tid(), user.id, sessionId, query);
  }

  @Post('sessions/:sessionId/processes/bulk')
  @RequirePermission(K.RESULTS_PUBLISH)
  bulkAction(
    @Param('sessionId') sessionId: string,
    @Body() dto: BulkProcessActionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.bulkAction(this.tid(), user.id, sessionId, dto);
  }

  @Get('sessions/:sessionId/processes/:studentId')
  @RequirePermission(K.RESULTS_VIEW)
  getProcess(
    @Param('sessionId') sessionId: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.getProcess(this.tid(), user.id, sessionId, studentId);
  }

  @Post('sessions/:sessionId/processes/:studentId/approve')
  @RequirePermission(K.RESULTS_PUBLISH)
  approveProcess(
    @Param('sessionId') sessionId: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.approveProcess(this.tid(), user.id, sessionId, studentId);
  }

  @Post('sessions/:sessionId/processes/:studentId/publish')
  @RequirePermission(K.RESULTS_PUBLISH)
  publishProcess(
    @Param('sessionId') sessionId: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.publishProcess(this.tid(), user.id, sessionId, studentId);
  }

  @Post('sessions/:sessionId/processes/:studentId/unpublish')
  @RequirePermission(K.RESULTS_PUBLISH)
  unpublishProcess(
    @Param('sessionId') sessionId: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.unpublishProcess(this.tid(), user.id, sessionId, studentId);
  }

  @Post('sessions/:sessionId/processes/:studentId/lock')
  @RequirePermission(K.RESULTS_PUBLISH)
  lockProcess(
    @Param('sessionId') sessionId: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.lockProcess(this.tid(), user.id, sessionId, studentId);
  }

  @Post('sessions/:sessionId/processes/:studentId/unlock')
  @RequirePermission(K.RESULTS_PUBLISH)
  unlockProcess(
    @Param('sessionId') sessionId: string,
    @Param('studentId') studentId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.unlockProcess(this.tid(), user.id, sessionId, studentId);
  }

  // ── History & exports ─────────────────────────────────────────────────────

  @Get('sessions/:sessionId/history')
  @RequirePermission(K.RESULTS_VIEW)
  listHistory(
    @Param('sessionId') sessionId: string,
    @Query() query: ResultsPaginationDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resultsService.listHistory(this.tid(), user.id, sessionId, query);
  }

  @Get('sessions/:sessionId/export')
  @RequirePermission(K.RESULTS_EXPORT)
  exportSession(@Param('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.exportSession(this.tid(), user.id, sessionId);
  }

  @Get('students/:studentId/summary')
  @RequirePermission(K.RESULTS_VIEW)
  studentSummary(@Param('studentId') studentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.resultsService.studentSummary(this.tid(), user.id, studentId);
  }
}