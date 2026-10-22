/**
 * Public admissions portal API — the only unauthenticated, tenant-scoped write surface in the
 * product. Mounted under `/public/*`, which AppModule excludes from TenantResolutionMiddleware;
 * every route therefore takes the college slug in the path and resolves the tenant itself.
 *
 * Authentication on applicant routes is the signed applicant token (ApplicantAccessGuard), not a
 * User JWT. Never add these routes to the staff AdmissionsController.
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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ApplicantAccessGuard } from './applicant-access.guard';
import { CurrentApplicant } from './current-applicant.decorator';
import type { ApplicantTokenClaims } from './applicant-token.service';
import { PublicAdmissionsService } from './public-admissions.service';
import {
  CreatePortalApplicationDto,
  PortalConfirmUploadDto,
  PortalOfferResponseDto,
  PortalOtpRequestDto,
  PortalOtpVerifyDto,
  PortalQualificationDto,
  PortalResumeDto,
  PortalSubmitDto,
  PortalUploadUrlDto,
  UpdatePortalApplicationDto,
} from './dto/public-admissions.dto';

const OTP_THROTTLE = { default: { limit: 10, ttl: 60_000 } };
const WRITE_THROTTLE = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('public-admissions')
@Controller('public/admissions')
export class PublicAdmissionsController {
  constructor(private readonly admissions: PublicAdmissionsService) {}

  private meta(req: Request) {
    return { ip: req.ip ?? null, userAgent: req.get('user-agent') ?? null };
  }

  // ── Catalogue (no auth) ─────────────────────────────────────────────────────────────────────

  @Get(':tenantSlug/sessions')
  @ApiOperation({ summary: 'Open admission sessions and programmes for a college (public).' })
  listSessions(@Param('tenantSlug') tenantSlug: string) {
    return this.admissions.listSessions(tenantSlug);
  }

  @Get(':tenantSlug/sessions/:publicSlug/form')
  @ApiOperation({ summary: 'Published application form, document checklist and consent text.' })
  getForm(
    @Param('tenantSlug') tenantSlug: string,
    @Param('publicSlug') publicSlug: string,
    @Query('programOfferId') programOfferId?: string,
  ) {
    return this.admissions.getForm(tenantSlug, publicSlug, programOfferId);
  }

  // ── Applicant identity ──────────────────────────────────────────────────────────────────────

  @Post(':tenantSlug/applicant/otp')
  @Throttle(OTP_THROTTLE)
  @ApiOperation({ summary: 'Send a one-time verification code to an applicant email/phone.' })
  requestOtp(@Param('tenantSlug') tenantSlug: string, @Body() dto: PortalOtpRequestDto, @Req() req: Request) {
    return this.admissions.requestOtp(tenantSlug, dto, this.meta(req));
  }

  @Post(':tenantSlug/applicant/verify')
  @Throttle(OTP_THROTTLE)
  @ApiOperation({ summary: 'Verify a one-time code and issue a short-lived applicant token.' })
  verifyOtp(@Param('tenantSlug') tenantSlug: string, @Body() dto: PortalOtpVerifyDto, @Req() req: Request) {
    return this.admissions.verifyOtp(tenantSlug, dto, this.meta(req));
  }

  @Post(':tenantSlug/applicant/resume')
  @Throttle(OTP_THROTTLE)
  @ApiOperation({ summary: 'Exchange an emailed resume token for a new applicant token.' })
  resume(@Param('tenantSlug') tenantSlug: string, @Body() dto: PortalResumeDto) {
    return this.admissions.resume(tenantSlug, dto.resumeToken);
  }

  // ── Draft (applicant auth) ──────────────────────────────────────────────────────────────────

  @Get(':tenantSlug/me')
  @UseGuards(ApplicantAccessGuard)
  @ApiOperation({ summary: 'The signed-in applicant’s application(s) and status.' })
  listMine(@Param('tenantSlug') tenantSlug: string, @CurrentApplicant() applicant: ApplicantTokenClaims) {
    return this.admissions.listMyApplications(tenantSlug, applicant.sub);
  }

  @Post(':tenantSlug/applications')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Start a draft application.' })
  create(
    @Param('tenantSlug') tenantSlug: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
    @Body() dto: CreatePortalApplicationDto,
  ) {
    return this.admissions.createApplication(tenantSlug, applicant.sub, dto);
  }

  @Patch(':tenantSlug/applications/:id')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Update a draft (allowed until verification starts).' })
  update(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
    @Body() dto: UpdatePortalApplicationDto,
  ) {
    return this.admissions.updateApplication(tenantSlug, applicant.sub, id, dto);
  }

  @Post(':tenantSlug/applications/:id/qualifications')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  addQualification(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
    @Body() dto: PortalQualificationDto,
  ) {
    return this.admissions.addQualification(tenantSlug, applicant.sub, id, dto);
  }

  @Delete(':tenantSlug/applications/:id/qualifications/:qualificationId')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  deleteQualification(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Param('qualificationId') qualificationId: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
  ) {
    return this.admissions.deleteQualification(tenantSlug, applicant.sub, id, qualificationId);
  }

  // ── Documents ───────────────────────────────────────────────────────────────────────────────

  @Post(':tenantSlug/applications/:id/documents/upload-url')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Reserve a document row and return a short-lived signed upload URL.' })
  requestUpload(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
    @Body() dto: PortalUploadUrlDto,
  ) {
    return this.admissions.requestDocumentUpload(tenantSlug, applicant.sub, id, dto);
  }

  @Post(':tenantSlug/applications/:id/documents/:documentId/confirm')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Confirm the bytes landed and queue the malware scan.' })
  confirmUpload(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
    @Body() _dto: PortalConfirmUploadDto,
  ) {
    return this.admissions.confirmDocumentUpload(tenantSlug, applicant.sub, id, documentId);
  }

  @Get(':tenantSlug/applications/:id/documents/:documentId/download-url')
  @UseGuards(ApplicantAccessGuard)
  @ApiOperation({ summary: 'Short-lived download URL for the applicant’s own uploaded file.' })
  downloadUrl(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
  ) {
    return this.admissions.downloadUrl(tenantSlug, applicant.sub, id, documentId);
  }

  @Delete(':tenantSlug/applications/:id/documents/:documentId')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  deleteDocument(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @Param('documentId') documentId: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
  ) {
    return this.admissions.deleteDocument(tenantSlug, applicant.sub, id, documentId);
  }

  // ── Submit, track, respond to offers ────────────────────────────────────────────────────────

  @Post(':tenantSlug/applications/:id/submit')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  @ApiOperation({ summary: 'Submit the application into the staff admissions pipeline.' })
  submit(
    @Param('tenantSlug') tenantSlug: string,
    @Param('id') id: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
    @Body() dto: PortalSubmitDto,
  ) {
    return this.admissions.submitApplication(tenantSlug, applicant.sub, id, dto);
  }

  @Get(':tenantSlug/track/:reference')
  @UseGuards(ApplicantAccessGuard)
  @ApiOperation({ summary: 'Status timeline, documents and offers for one application reference.' })
  track(
    @Param('tenantSlug') tenantSlug: string,
    @Param('reference') reference: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
  ) {
    return this.admissions.track(tenantSlug, applicant.sub, reference);
  }

  @Post(':tenantSlug/offers/:offerId/accept')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  acceptOffer(
    @Param('tenantSlug') tenantSlug: string,
    @Param('offerId') offerId: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
    @Body() dto: PortalOfferResponseDto,
  ) {
    return this.admissions.respondToOffer(tenantSlug, applicant.sub, offerId, 'accept', dto.remarks);
  }

  @Post(':tenantSlug/offers/:offerId/decline')
  @UseGuards(ApplicantAccessGuard)
  @Throttle(WRITE_THROTTLE)
  declineOffer(
    @Param('tenantSlug') tenantSlug: string,
    @Param('offerId') offerId: string,
    @CurrentApplicant() applicant: ApplicantTokenClaims,
    @Body() dto: PortalOfferResponseDto,
  ) {
    return this.admissions.respondToOffer(tenantSlug, applicant.sub, offerId, 'decline', dto.remarks);
  }
}
