/**
 * Parent/Guardian Portal API. Every child-scoped route carries an optional `studentId` query
 * parameter that is resolved by ParentPortalService against the caller's own linked children
 * (Guardians.userId) — a caller can never read a student they are not a guardian of. Guards:
 * JwtAuthGuard + TenantMatchGuard + FeatureFlagsGuard on the class; @RequireFeature per route so
 * a tenant plan without a module never exposes that module's data here either.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { ParentPortalService } from './parent-portal.service';
import {
  ParentAttendanceQueryDto,
  ParentChildQueryDto,
  ParentDocumentsQueryDto,
  ParentNoticesQueryDto,
} from './dto/parent-portal.dto';

@ApiTags('parent-portal')
@Controller('parent-portal')
@UseGuards(JwtAuthGuard, TenantMatchGuard, FeatureFlagsGuard)
export class ParentPortalController {
  constructor(private readonly portal: ParentPortalService) {}

  /** The caller's linked children. Also serves as the portal gate (403 when unlinked). */
  @Get('children')
  getChildren(@CurrentUser() user: AuthenticatedUser) {
    return this.portal.getChildren(user);
  }

  @Get('dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.dashboard(user, query.studentId);
  }

  @Get('profile')
  getProfile(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.getProfile(user, query.studentId);
  }

  @Get('attendance')
  @RequireFeature(FEATURE_KEYS.ATTENDANCE)
  getAttendance(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentAttendanceQueryDto) {
    return this.portal.getAttendance(user, query);
  }

  @Get('timetable')
  @RequireFeature(FEATURE_KEYS.TIMETABLE)
  getTimetable(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.getTimetable(user, query.studentId);
  }

  @Get('fees')
  @RequireFeature(FEATURE_KEYS.FEES)
  getFees(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.getFees(user, query.studentId);
  }

  @Get('payments')
  @RequireFeature(FEATURE_KEYS.PAYMENTS)
  getPayments(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.getPayments(user, query.studentId);
  }

  @Get('exams')
  @RequireFeature(FEATURE_KEYS.EXAMS)
  getExams(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.getExams(user, query.studentId);
  }

  @Get('results')
  @RequireFeature(FEATURE_KEYS.RESULTS)
  getResults(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.getResults(user, query.studentId);
  }

  @Get('notices')
  @RequireFeature(FEATURE_KEYS.NOTIFICATIONS)
  getNotices(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentNoticesQueryDto) {
    return this.portal.getNotices(user, query);
  }

  @Get('documents')
  getDocuments(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentDocumentsQueryDto) {
    return this.portal.getDocuments(user, query);
  }

  @Get('documents/:id/download-url')
  getDocumentDownloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query() query: ParentChildQueryDto,
  ) {
    return this.portal.getDocumentDownloadUrl(user, id, query.studentId);
  }

  @Get('transport')
  @RequireFeature(FEATURE_KEYS.TRANSPORT)
  getTransport(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.getTransport(user, query.studentId);
  }

  @Get('hostel')
  @RequireFeature(FEATURE_KEYS.HOSTEL)
  getHostel(@CurrentUser() user: AuthenticatedUser, @Query() query: ParentChildQueryDto) {
    return this.portal.getHostel(user, query.studentId);
  }
}
