/**
 * Admissions lifecycle controller — the full pipeline as REST endpoints:
 * sessions (seat matrix) → enquiries → applications → documents/qualifications → verification →
 * merit → counselling → selection → offer → fee payment → enrollment (auto-creates the Student).
 * Guards follow the feature-module convention; scoped grants are enforced in the service.
 */
import {
  Body,
  Controller,
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
import { AdmissionsService } from './admissions.service';
import {
  BookCounsellingDto,
  CancelApplicationDto,
  CounsellingDecisionDto,
  CreateAdmissionApplicationDto,
  CreateAdmissionEnquiryDto,
  CreateAdmissionProgramDto,
  CreateAdmissionSessionDto,
  CreateApplicationDocumentDto,
  CreateCounsellingSlotDto,
  CreateQualificationDto,
  DocumentDecisionDto,
  EnrollApplicationDto,
  IssueOfferDto,
  ListAdmissionApplicationQueryDto,
  PayAdmissionFeeDto,
  ScoreAdmissionApplicationDto,
  UpdateAdmissionApplicationDto,
  UpdateAdmissionEnquiryDto,
  UpdateAdmissionProgramDto,
  UpdateAdmissionSessionDto,
  UpdateApplicationDocumentDto,
  UpdateCounsellingSlotDto,
  UpdateQualificationDto,
} from './dto/admissions.dto';

@ApiTags('admissions')
@Controller('admissions')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.ADMISSIONS)
export class AdmissionsController {
  constructor(
    private readonly admissionsService: AdmissionsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Sessions ──────────────────────────────────────────────────────────────

  @Get('sessions')
  @RequirePermission(K.ADMISSIONS_VIEW)
  listSessions() {
    return this.admissionsService.listSessions(this.tid());
  }

  @Post('sessions')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  createSession(@Body() dto: CreateAdmissionSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.createSession(this.tid(), user.id, dto);
  }

  @Get('sessions/:id')
  @RequirePermission(K.ADMISSIONS_VIEW)
  getSession(@Param('id') id: string) {
    return this.admissionsService.getSession(this.tid(), id);
  }

  @Patch('sessions/:id')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  updateSession(@Param('id') id: string, @Body() dto: UpdateAdmissionSessionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.updateSession(this.tid(), user.id, id, dto);
  }

  @Post('sessions/:id/close')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  closeSession(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.closeSession(this.tid(), user.id, id);
  }

  @Post('sessions/:id/publish-merit')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  publishMerit(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.publishMerit(this.tid(), user.id, id);
  }

  // ── Program offers (seat matrix) ──────────────────────────────────────────

  @Get('programs')
  @RequirePermission(K.ADMISSIONS_VIEW)
  listPrograms(@Query('sessionId') sessionId?: string) {
    return this.admissionsService.listPrograms(this.tid(), sessionId ?? undefined);
  }

  @Post('programs')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  createProgram(@Body() dto: CreateAdmissionProgramDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.createProgram(this.tid(), user.id, dto);
  }

  @Patch('programs/:id')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  updateProgram(@Param('id') id: string, @Body() dto: UpdateAdmissionProgramDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.updateProgram(this.tid(), user.id, id, dto);
  }

  // ── Dynamic form definition ───────────────────────────────────────────────

  @Get('form-definition')
  @RequirePermission(K.ADMISSIONS_VIEW)
  formDefinition(@Query('sessionId') sessionId: string, @Query('admissionProgramId') admissionProgramId?: string) {
    return this.admissionsService.formDefinition(this.tid(), sessionId, admissionProgramId ?? undefined);
  }

  // ── Enquiries ─────────────────────────────────────────────────────────────

  @Get('enquiries')
  @RequirePermission(K.ADMISSIONS_VIEW)
  listEnquiries(
    @Query('search') search?: string,
    @Query('source') source?: string,
    @Query('sessionId') sessionId?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.admissionsService.listEnquiries(this.tid(), {
      search: search ?? undefined,
      source: source ?? undefined,
      sessionId: sessionId ?? undefined,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Post('enquiries')
  @RequirePermission(K.ADMISSIONS_CREATE)
  createEnquiry(@Body() dto: CreateAdmissionEnquiryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.createEnquiry(this.tid(), user.id, dto);
  }

  @Patch('enquiries/:id')
  @RequirePermission(K.ADMISSIONS_UPDATE)
  updateEnquiry(@Param('id') id: string, @Body() dto: UpdateAdmissionEnquiryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.updateEnquiry(this.tid(), user.id, id, dto);
  }

  @Post('enquiries/:id/convert')
  @RequirePermission(K.ADMISSIONS_CREATE)
  convertEnquiry(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.convertEnquiry(this.tid(), user.id, id);
  }

  // ── Applications ──────────────────────────────────────────────────────────

  @Get('applications')
  @RequirePermission(K.ADMISSIONS_VIEW)
  listApplications(@Query() query: ListAdmissionApplicationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.listApplications(this.tid(), user.id, query);
  }

  @Post('applications')
  @RequirePermission(K.ADMISSIONS_CREATE)
  createApplication(@Body() dto: CreateAdmissionApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.createApplication(this.tid(), user.id, dto);
  }

  @Get('applications/:id')
  @RequirePermission(K.ADMISSIONS_VIEW)
  getApplication(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.getApplication(id, this.tid(), user.id);
  }

  @Patch('applications/:id')
  @RequirePermission(K.ADMISSIONS_UPDATE)
  updateApplication(@Param('id') id: string, @Body() dto: UpdateAdmissionApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.updateApplication(id, this.tid(), user.id, dto);
  }

  @Post('applications/:id/submit')
  @RequirePermission(K.ADMISSIONS_UPDATE)
  submitApplication(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.submitApplication(id, this.tid(), user.id);
  }

  @Post('applications/:id/cancel')
  @RequirePermission(K.ADMISSIONS_UPDATE)
  cancelApplication(@Param('id') id: string, @Body() dto: CancelApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.cancelApplication(id, this.tid(), user.id, dto.reason);
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  @Post('applications/:id/documents')
  @RequirePermission(K.ADMISSIONS_CREATE)
  createDocument(@Param('id') id: string, @Body() dto: CreateApplicationDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.createDocument(id, this.tid(), user.id, dto);
  }

  @Patch('documents/:docId')
  @RequirePermission(K.ADMISSIONS_UPDATE)
  updateDocument(@Param('docId') docId: string, @Body() dto: UpdateApplicationDocumentDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.updateDocument(docId, this.tid(), user.id, dto);
  }

  @Post('documents/:docId/verify')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  verifyDocument(@Param('docId') docId: string, @Body() dto: DocumentDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.verifyDocument(docId, this.tid(), user.id, dto);
  }

  @Post('documents/:docId/reject')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  rejectDocument(@Param('docId') docId: string, @Body() dto: DocumentDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.rejectDocument(docId, this.tid(), user.id, dto);
  }

  @Post('documents/:docId/delete')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  deleteDocument(@Param('docId') docId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.deleteDocument(docId, this.tid(), user.id);
  }

  // ── Qualifications ────────────────────────────────────────────────────────

  @Post('applications/:id/qualifications')
  @RequirePermission(K.ADMISSIONS_CREATE)
  createQualification(@Param('id') id: string, @Body() dto: CreateQualificationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.createQualification(id, this.tid(), user.id, dto);
  }

  @Patch('qualifications/:qualificationId')
  @RequirePermission(K.ADMISSIONS_UPDATE)
  updateQualification(@Param('qualificationId') qualificationId: string, @Body() dto: UpdateQualificationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.updateQualification(qualificationId, this.tid(), user.id, dto);
  }

  @Post('qualifications/:qualificationId/delete')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  deleteQualification(@Param('qualificationId') qualificationId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.deleteQualification(qualificationId, this.tid(), user.id);
  }

  // ── Verification / merit ──────────────────────────────────────────────────

  @Post('applications/:id/complete-verification')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  completeVerification(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.completeVerification(id, this.tid(), user.id);
  }

  @Post('applications/:id/score')
  @RequirePermission(K.ADMISSIONS_UPDATE)
  scoreApplication(@Param('id') id: string, @Body() dto: ScoreAdmissionApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.scoreApplication(id, this.tid(), user.id, dto);
  }

  // ── Counselling ───────────────────────────────────────────────────────────

  @Get('counselling-slots')
  @RequirePermission(K.ADMISSIONS_VIEW)
  listCounsellingSlots(@Query('sessionId') sessionId?: string, @Query('programId') programId?: string) {
    return this.admissionsService.listCounsellingSlots(this.tid(), sessionId ?? undefined, programId ?? undefined);
  }

  @Post('counselling-slots')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  createCounsellingSlot(@Body() dto: CreateCounsellingSlotDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.createCounsellingSlot(this.tid(), user.id, dto);
  }

  @Patch('counselling-slots/:slotId')
  @RequirePermission(K.ADMISSIONS_MANAGE)
  updateCounsellingSlot(@Param('slotId') slotId: string, @Body() dto: UpdateCounsellingSlotDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.updateCounsellingSlot(this.tid(), user.id, slotId, dto);
  }

  @Post('applications/:id/book-counselling')
  @RequirePermission(K.ADMISSIONS_CREATE)
  bookCounselling(@Param('id') id: string, @Body() dto: BookCounsellingDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.bookCounselling(id, this.tid(), user.id, dto.counsellingSlotId);
  }

  @Post('applications/:id/counselled')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  counselled(@Param('id') id: string, @Body() dto: CounsellingDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.counselled(id, this.tid(), user.id, dto.decision, dto.remarks);
  }

  // ── Offers & payment ──────────────────────────────────────────────────────

  @Post('applications/:id/offer')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  issueOffer(@Param('id') id: string, @Body() dto: IssueOfferDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.issueOffer(id, this.tid(), user.id, dto);
  }

  @Post('offers/:offerId/accept')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  acceptOffer(@Param('offerId') offerId: string, @Body() dto: DocumentDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.acceptOffer(offerId, this.tid(), user.id, dto.remarks);
  }

  @Post('offers/:offerId/decline')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  declineOffer(@Param('offerId') offerId: string, @Body() dto: DocumentDecisionDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.declineOffer(offerId, this.tid(), user.id, dto.remarks);
  }

  @Post('applications/:id/fees/pay')
  @RequirePermission(K.ADMISSIONS_CREATE)
  payAdmissionFee(@Param('id') id: string, @Body() dto: PayAdmissionFeeDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.payAdmissionFee(id, this.tid(), user.id, dto);
  }

  // ── Enrollment ────────────────────────────────────────────────────────────

  @Post('applications/:id/enroll')
  @RequirePermission(K.ADMISSIONS_APPROVE)
  enroll(@Param('id') id: string, @Body() dto: EnrollApplicationDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.enroll(id, this.tid(), user.id, dto);
  }

  // ── Dashboard & reports ───────────────────────────────────────────────────

  @Get('dashboard')
  @RequirePermission(K.ADMISSIONS_VIEW)
  dashboard(@CurrentUser() user: AuthenticatedUser, @Query('sessionId') sessionId?: string) {
    return this.admissionsService.dashboard(this.tid(), user.id, sessionId ?? undefined);
  }

  @Get('reports/sessions')
  @RequirePermission(K.ADMISSIONS_VIEW)
  sessionReport(@CurrentUser() user: AuthenticatedUser, @Query('sessionId') sessionId?: string) {
    return this.admissionsService.sessionReport(this.tid(), user.id, sessionId ?? undefined);
  }

  @Get('reports/pipeline')
  @RequirePermission(K.ADMISSIONS_VIEW)
  pipelineReport(@Query('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.pipelineReport(this.tid(), user.id, sessionId);
  }

  @Get('reports/merit')
  @RequirePermission(K.ADMISSIONS_VIEW)
  meritReport(@Query('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.meritReport(this.tid(), user.id, sessionId);
  }

  // ── CSV exports ───────────────────────────────────────────────────────────

  @Get('export/applications')
  @RequirePermission(K.ADMISSIONS_EXPORT)
  exportApplications(@Query() query: ListAdmissionApplicationQueryDto, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.exportApplications(this.tid(), user.id, query);
  }

  @Get('export/enquiries')
  @RequirePermission(K.ADMISSIONS_EXPORT)
  exportEnquiries(
    @Query('search') search?: string,
    @Query('source') source?: string,
    @Query('sessionId') sessionId?: string,
  ) {
    return this.admissionsService.exportEnquiries(this.tid(), {
      search: search ?? undefined,
      source: source ?? undefined,
      sessionId: sessionId ?? undefined,
    });
  }

  @Get('export/merit')
  @RequirePermission(K.ADMISSIONS_EXPORT)
  exportMerit(@Query('sessionId') sessionId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.admissionsService.exportMerit(this.tid(), user.id, sessionId);
  }
}