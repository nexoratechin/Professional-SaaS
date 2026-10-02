/**
 * Student Portal self-service API. Every route is anchored to the authenticated user's own
 * Student record (Student.userId) inside StudentsPortalService — there is no :studentId path
 * parameter to tamper with. Guards: JwtAuthGuard + TenantMatchGuard on the class; FeatureFlagsGuard
 * on each route via @RequireFeature so a tenant plan without a module never exposes that module's
 * data here either.
 */
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { StudentPortalService } from './student-portal.service';
import {
  AddPortalTicketCommentDto,
  CreateCertificateRequestDto,
  CreatePortalPaymentDto,
  CreatePortalTicketDto,
  PortalAttendanceQueryDto,
  PortalConfirmUploadDto,
  PortalDocumentQueryDto,
  PortalNoticesQueryDto,
  PortalTicketFeedbackDto,
  PortalTicketQueryDto,
  PortalUploadUrlDto,
  UpdatePortalProfileDto,
} from './dto/student-portal.dto';

@ApiTags('student-portal')
@Controller('student-portal')
@UseGuards(JwtAuthGuard, TenantMatchGuard, FeatureFlagsGuard)
export class StudentPortalController {
  constructor(private readonly portal: StudentPortalService) {}

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.dashboard(user);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getProfile(user);
  }

  @Patch('profile')
  updateProfile(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdatePortalProfileDto) {
    return this.portal.updateProfile(user, dto);
  }

  @Get('attendance')
  @RequireFeature(FEATURE_KEYS.ATTENDANCE)
  getAttendance(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalAttendanceQueryDto) {
    return this.portal.getAttendance(user, query);
  }

  @Get('timetable')
  @RequireFeature(FEATURE_KEYS.TIMETABLE)
  getTimetable(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getTimetable(user);
  }

  @Get('courses')
  @RequireFeature(FEATURE_KEYS.ACADEMICS)
  getCourses(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getCourses(user);
  }

  @Get('fees')
  @RequireFeature(FEATURE_KEYS.FEES)
  getFees(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getFees(user);
  }

  @Get('payments')
  @RequireFeature(FEATURE_KEYS.PAYMENTS)
  getPayments(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getPayments(user);
  }

  @Post('payments')
  @RequireFeature(FEATURE_KEYS.PAYMENTS)
  createPayment(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePortalPaymentDto) {
    return this.portal.createPayment(user, dto);
  }

  @Get('exams')
  @RequireFeature(FEATURE_KEYS.EXAMS)
  getExams(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getExams(user);
  }

  @Get('results')
  @RequireFeature(FEATURE_KEYS.RESULTS)
  getResults(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getResults(user);
  }

  @Get('certificates')
  @RequireFeature(FEATURE_KEYS.CERTIFICATES)
  getCertificates(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getCertificates(user);
  }

  @Post('certificates')
  @RequireFeature(FEATURE_KEYS.CERTIFICATES)
  requestCertificate(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCertificateRequestDto) {
    return this.portal.requestCertificate(user, dto);
  }

  @Get('certificates/:id/download-url')
  @RequireFeature(FEATURE_KEYS.CERTIFICATES)
  getCertificateDownloadUrl(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.getCertificateDownloadUrl(user, id);
  }

  @Get('library')
  @RequireFeature(FEATURE_KEYS.LIBRARY)
  getLibrary(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getLibrary(user);
  }

  @Get('hostel')
  @RequireFeature(FEATURE_KEYS.HOSTEL)
  getHostel(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getHostel(user);
  }

  @Get('transport')
  @RequireFeature(FEATURE_KEYS.TRANSPORT)
  getTransport(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getTransport(user);
  }

  @Get('notices')
  @RequireFeature(FEATURE_KEYS.NOTIFICATIONS)
  getNotices(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalNoticesQueryDto) {
    return this.portal.getNotices(user, query);
  }

  @Post('notices/:id/read')
  @RequireFeature(FEATURE_KEYS.NOTIFICATIONS)
  markNoticeRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.markNoticeRead(user, id);
  }

  @Get('tickets')
  @RequireFeature(FEATURE_KEYS.HELPDESK)
  getTickets(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalTicketQueryDto) {
    return this.portal.getTickets(user, query);
  }

  @Get('tickets/lookups')
  @RequireFeature(FEATURE_KEYS.HELPDESK)
  getTicketLookups(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getTicketLookups(user);
  }

  @Post('tickets')
  @RequireFeature(FEATURE_KEYS.HELPDESK)
  createTicket(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePortalTicketDto) {
    return this.portal.createTicket(user, dto);
  }

  @Get('tickets/:id')
  @RequireFeature(FEATURE_KEYS.HELPDESK)
  getTicket(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.getTicket(user, id);
  }

  @Post('tickets/:id/comments')
  @RequireFeature(FEATURE_KEYS.HELPDESK)
  addTicketComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddPortalTicketCommentDto,
  ) {
    return this.portal.addTicketComment(user, id, dto);
  }

  @Post('tickets/:id/feedback')
  @RequireFeature(FEATURE_KEYS.HELPDESK)
  submitTicketFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PortalTicketFeedbackDto,
  ) {
    return this.portal.submitTicketFeedback(user, id, dto);
  }

  @Get('documents')
  getDocuments(@CurrentUser() user: AuthenticatedUser, @Query() query: PortalDocumentQueryDto) {
    return this.portal.getDocuments(user, query);
  }

  @Post('documents/upload-url')
  requestDocumentUpload(@CurrentUser() user: AuthenticatedUser, @Body() dto: PortalUploadUrlDto) {
    return this.portal.requestDocumentUpload(user, dto);
  }

  @Post('documents/:id/confirm-upload')
  confirmDocumentUpload(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: PortalConfirmUploadDto,
  ) {
    return this.portal.confirmDocumentUpload(user, id, dto.sizeBytes);
  }

  @Get('documents/:id/download-url')
  getDocumentDownloadUrl(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.portal.getDocumentDownloadUrl(user, id);
  }
}
