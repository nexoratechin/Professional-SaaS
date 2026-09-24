/**
 * Placements controller — the full placement-lifecycle API: recruiting companies & contacts,
 * drives & positions, eligibility evaluation, student resumes (signed-URL upload flow like HR
 * documents), applications, rounds & results, selections, offers & joining, plus closing-the-
 * books outcomes, statistics, department analytics and reports. Guards follow the feature-module
 * convention (JwtAuth + TenantMatch + Permissions + FeatureFlags) gated on FEATURE_KEYS.
 * PLACEMENTS with per-route permissions; row-level student scope is enforced in the services via
 * placementStudentWhere (see placements-scope.ts). Static sub-routes are declared before
 * parameter routes so NestJS never treats them as an :id.
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
import { PlacementsService } from './placements.service';
import { PlacementDriveService } from './placement-drive.service';
import { PlacementApplicationService } from './placement-application.service';
import { PlacementReportService } from './placement-report.service';
import * as Dto from './dto/placements.dto';

@ApiTags('placements')
@Controller('placements')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.PLACEMENTS)
export class PlacementsController {
  constructor(
    private readonly placements: PlacementsService,
    private readonly drives: PlacementDriveService,
    private readonly applications: PlacementApplicationService,
    private readonly reports: PlacementReportService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups & overview ────────────────────────────────────────────────────

  @Get('lookups')
  @RequirePermission(K.PLACEMENTS_VIEW)
  lookups() {
    return this.placements.lookups();
  }

  // ── Companies ─────────────────────────────────────────────────────────────

  @Get('companies')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listCompanies(@Query() query: Dto.QueryCompaniesDto) {
    return this.placements.listCompanies(query);
  }

  @Post('companies')
  @RequirePermission(K.PLACEMENTS_CREATE)
  createCompany(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateCompanyDto) {
    return this.placements.createCompany(this.tid(), user, dto);
  }

  @Get('companies/:id')
  @RequirePermission(K.PLACEMENTS_VIEW)
  getCompany(@Param('id') id: string) {
    return this.placements.getCompany(id);
  }

  @Patch('companies/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updateCompany(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateCompanyDto) {
    return this.placements.updateCompany(this.tid(), user, id, dto);
  }

  @Post('companies/:id/restore')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  restoreCompany(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.placements.archiveCompany(this.tid(), user, id, true);
  }

  @Delete('companies/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  archiveCompany(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.placements.archiveCompany(this.tid(), user, id);
  }

  // ── Contacts ──────────────────────────────────────────────────────────────

  @Get('contacts')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listContacts(@Query() query: Dto.QueryContactsDto) {
    return this.placements.listContacts(query);
  }

  @Post('contacts')
  @RequirePermission(K.PLACEMENTS_CREATE)
  createContact(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateContactDto) {
    return this.placements.createContact(this.tid(), user, dto);
  }

  @Get('contacts/:id')
  @RequirePermission(K.PLACEMENTS_VIEW)
  getContact(@Param('id') id: string) {
    return this.placements.getContact(id);
  }

  @Patch('contacts/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updateContact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateContactDto) {
    return this.placements.updateContact(this.tid(), user, id, dto);
  }

  @Delete('contacts/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  removeContact(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.placements.removeContact(this.tid(), user, id);
  }

  // ── Drives ────────────────────────────────────────────────────────────────

  @Get('drives')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listDrives(@Query() query: Dto.QueryDrivesDto) {
    return this.drives.listDrives(query);
  }

  @Post('drives')
  @RequirePermission(K.PLACEMENTS_CREATE)
  createDrive(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateDriveDto) {
    return this.drives.createDrive(this.tid(), user, dto);
  }

  @Get('drives/:id')
  @RequirePermission(K.PLACEMENTS_VIEW)
  getDrive(@Param('id') id: string) {
    return this.drives.getDrive(id);
  }

  @Patch('drives/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updateDrive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateDriveDto) {
    return this.drives.updateDrive(this.tid(), user, id, dto);
  }

  @Post('drives/:id/status')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  driveStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.ChangeDriveStatusDto) {
    return this.drives.changeDriveStatus(this.tid(), user, id, dto);
  }

  @Post('drives/:id/restore')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  restoreDrive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.drives.archiveDrive(this.tid(), user, id, true);
  }

  @Delete('drives/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  archiveDrive(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.drives.archiveDrive(this.tid(), user, id);
  }

  // ── Positions ─────────────────────────────────────────────────────────────

  @Get('positions')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listPositions(@Query() query: Dto.QueryPositionsDto) {
    return this.drives.listPositions(query);
  }

  @Post('positions')
  @RequirePermission(K.PLACEMENTS_CREATE)
  createPosition(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreatePositionDto) {
    return this.drives.createPosition(this.tid(), user, dto);
  }

  @Get('positions/:id')
  @RequirePermission(K.PLACEMENTS_VIEW)
  getPosition(@Param('id') id: string) {
    return this.drives.getPosition(id);
  }

  @Patch('positions/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updatePosition(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdatePositionDto) {
    return this.drives.updatePosition(this.tid(), user, id, dto);
  }

  @Post('positions/:id/restore')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  restorePosition(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.drives.archivePosition(this.tid(), user, id, true);
  }

  @Delete('positions/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  archivePosition(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.drives.archivePosition(this.tid(), user, id);
  }

  // ── Eligibility ───────────────────────────────────────────────────────────

  @Get('eligibility/eligible-students')
  @RequirePermission(K.PLACEMENTS_VIEW)
  eligibleStudents(@CurrentUser() user: AuthenticatedUser, @Query('positionId') positionId: string) {
    return this.drives.listEligibleStudents(this.tid(), user, positionId);
  }

  @Post('eligibility/evaluate')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  evaluateEligibility(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.EvaluateEligibilityDto) {
    return this.drives.evaluateEligibility(this.tid(), user, dto);
  }

  @Get('eligibility')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listEligibility(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.QueryEligibilityDto) {
    return this.drives.listEligibility(this.tid(), user, query);
  }

  @Patch('eligibility/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  overrideEligibility(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.OverrideEligibilityDto) {
    return this.drives.overrideEligibility(this.tid(), user, id, dto);
  }

  // ── Resumes ───────────────────────────────────────────────────────────────

  @Get('resumes')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listResumes(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.QueryResumesDto) {
    return this.applications.listResumes(this.tid(), user, query);
  }

  @Post('resumes/upload-request')
  @RequirePermission(K.PLACEMENTS_CREATE)
  requestResumeUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.ResumeUploadRequestDto) {
    return this.applications.requestResumeUpload(this.tid(), user, dto);
  }

  @Post('resumes/confirm')
  @RequirePermission(K.PLACEMENTS_CREATE)
  confirmResumeUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.ConfirmResumeUploadDto) {
    return this.applications.confirmResumeUpload(this.tid(), user, dto);
  }

  @Patch('resumes/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updateResume(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateResumeDto) {
    return this.applications.updateResume(this.tid(), user, id, dto);
  }

  @Get('resumes/:id/download')
  @RequirePermission(K.PLACEMENTS_VIEW)
  downloadResume(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.applications.getResumeDownloadUrl(this.tid(), user, id);
  }

  @Delete('resumes/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  deleteResume(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.applications.deleteResume(this.tid(), user, id);
  }

  // ── Applications ──────────────────────────────────────────────────────────

  @Get('applications')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listApplications(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.QueryApplicationsDto) {
    return this.applications.listApplications(this.tid(), user, query);
  }

  @Post('applications')
  @RequirePermission(K.PLACEMENTS_CREATE)
  createApplication(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateApplicationDto) {
    return this.applications.createApplication(this.tid(), user, dto);
  }

  @Post('applications/bulk')
  @RequirePermission(K.PLACEMENTS_CREATE)
  bulkCreateApplications(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateApplicationsBulkDto) {
    return this.applications.bulkCreateApplications(this.tid(), user, dto);
  }

  @Get('applications/:id')
  @RequirePermission(K.PLACEMENTS_VIEW)
  getApplication(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.applications.getApplication(this.tid(), user, id);
  }

  @Patch('applications/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updateApplicationStatus(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateApplicationStatusDto) {
    return this.applications.updateApplicationStatus(this.tid(), user, id, dto);
  }

  // ── Rounds & results ──────────────────────────────────────────────────────

  @Get('rounds')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listRounds(@Query() query: Dto.QueryRoundsDto) {
    return this.applications.listRounds(query.driveId);
  }

  @Post('rounds')
  @RequirePermission(K.PLACEMENTS_CREATE)
  createRound(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateRoundDto) {
    return this.applications.createRound(this.tid(), user, dto);
  }

  @Patch('rounds/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updateRound(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateRoundDto) {
    return this.applications.updateRound(this.tid(), user, id, dto);
  }

  @Delete('rounds/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  deleteRound(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.applications.deleteRound(this.tid(), user, id);
  }

  @Get('round-results')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listRoundResults(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.QueryRoundResultsDto) {
    return this.applications.listRoundResults(this.tid(), user, query.roundId, query.result);
  }

  @Post('round-results')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  recordRoundResult(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.RecordRoundResultDto) {
    return this.applications.recordResult(this.tid(), user, dto);
  }

  @Post('round-results/bulk')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  bulkRecordRoundResults(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.BulkRecordRoundResultsDto) {
    return this.applications.bulkRecordResults(this.tid(), user, dto);
  }

  // ── Selections ────────────────────────────────────────────────────────────

  @Get('selections')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listSelections(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.QuerySelectionsDto) {
    return this.applications.listSelections(this.tid(), user, query);
  }

  @Post('selections')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  createSelection(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateSelectionDto) {
    return this.applications.createSelection(this.tid(), user, dto);
  }

  @Delete('selections/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  removeSelection(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.applications.removeSelection(this.tid(), user, id);
  }

  // ── Offers ────────────────────────────────────────────────────────────────

  @Get('offers')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listOffers(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.QueryOffersDto) {
    return this.applications.listOffers(this.tid(), user, query);
  }

  @Post('offers')
  @RequirePermission(K.PLACEMENTS_CREATE)
  createOffer(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateOfferDto) {
    return this.applications.createOffer(this.tid(), user, dto);
  }

  @Get('offers/:id')
  @RequirePermission(K.PLACEMENTS_VIEW)
  getOffer(@Param('id') id: string) {
    return this.applications.getOffer(id);
  }

  @Post('offers/:id/status')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  decideOffer(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.OfferDecisionDto) {
    return this.applications.decideOffer(this.tid(), user, id, dto);
  }

  @Patch('offers/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updateOffer(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateOfferDto) {
    return this.applications.updateOffer(this.tid(), user, id, dto);
  }

  // ── Joinings ──────────────────────────────────────────────────────────────

  @Get('joinings')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listJoinings(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.QueryJoiningsDto) {
    return this.applications.listJoinings(this.tid(), user, query);
  }

  @Post('joinings')
  @RequirePermission(K.PLACEMENTS_CREATE)
  createJoining(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.CreateJoiningDto) {
    return this.applications.createJoining(this.tid(), user, dto);
  }

  @Patch('joinings/:id')
  @RequirePermission(K.PLACEMENTS_UPDATE)
  updateJoining(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateJoiningDto) {
    return this.applications.updateJoining(this.tid(), user, id, dto);
  }

  // ── Outcomes, statistics & reports ────────────────────────────────────────

  @Get('outcomes')
  @RequirePermission(K.PLACEMENTS_VIEW)
  listOutcomes(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.QueryOutcomesDto) {
    return this.reports.listOutcomes(this.tid(), user, query);
  }

  @Post('outcomes')
  @RequirePermission(K.PLACEMENTS_APPROVE)
  declareOutcome(@CurrentUser() user: AuthenticatedUser, @Body() dto: Dto.DeclareOutcomeDto) {
    return this.reports.declareOutcome(this.tid(), user, dto);
  }

  @Patch('outcomes/:id')
  @RequirePermission(K.PLACEMENTS_APPROVE)
  updateOutcome(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: Dto.UpdateOutcomeDto) {
    return this.reports.updateOutcome(this.tid(), user, id, dto);
  }

  @Get('statistics')
  @RequirePermission(K.PLACEMENTS_VIEW)
  statistics(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.StatisticsQueryDto) {
    return this.reports.statistics(this.tid(), user, query);
  }

  @Get('department-analytics')
  @RequirePermission(K.PLACEMENTS_VIEW)
  departmentAnalytics(@CurrentUser() user: AuthenticatedUser, @Query('academicYearId') academicYearId?: string) {
    return this.reports.departmentAnalytics(this.tid(), user, academicYearId);
  }

  @Get('reports')
  @RequirePermission(K.PLACEMENTS_VIEW)
  generateReport(@CurrentUser() user: AuthenticatedUser, @Query() query: Dto.GeneratePlacementReportDto) {
    return this.reports.generateReport(this.tid(), user, query);
  }
}