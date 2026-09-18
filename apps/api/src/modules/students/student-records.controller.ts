/**
 * Student 360 — nested sub-resource endpoints under /students/:studentId/:resource.
 *
 * Permission keys are per-resource (fees.view, attendance.view, certificates.approve, …) and
 * cannot be expressed as a single static @RequirePermission, so this controller runs the
 * standard guard chain without PermissionsGuard and checks the mapped key at runtime via
 * PermissionsService — same presence semantics as PermissionsGuard. Row-level scope is still
 * enforced inside StudentRecordsService.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FEATURE_KEYS, type AuthenticatedUser, type PermissionKey } from '@college-erp/auth';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { PermissionsService } from '../rbac/permissions.service';
import { StudentRecordsService } from './student-records.service';
import { STUDENT_RESOURCES, STUDENT_RESOURCE_META, type StudentResource } from './students.constants';
import {
  WaiveFeeDto,
  RefundPaymentDto,
  CertificateStatusChangeDto,
  ReturnLibraryLoanDto,
  LiftHoldDto,
  DocumentDecisionDto,
} from './dto/student-records.dto';

@ApiTags('students')
@Controller('students/:studentId')
@UseGuards(JwtAuthGuard, TenantMatchGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.STUDENTS)
export class StudentRecordsController {
  constructor(
    private readonly recordsService: StudentRecordsService,
    private readonly permissionsService: PermissionsService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  private resolveResource(resource: string): StudentResource {
    if (!(STUDENT_RESOURCES as readonly string[]).includes(resource)) {
      throw new NotFoundException('Unknown student record resource.');
    }
    return resource as StudentResource;
  }

  private async permit(permission: PermissionKey, user: AuthenticatedUser): Promise<void> {
    const grants = await this.permissionsService.getScopeGrantsFor(this.tid(), user.id, permission);
    if (grants.length === 0) throw new ForbiddenException(`Missing permission: ${permission}`);
  }

  private assertResource(resource: StudentResource, expected: StudentResource): void {
    if (resource !== expected) throw new BadRequestException('Invalid resource for this action.');
  }

  // ── Timeline (declared before :resource so it isn't swallowed) ────────────

  @Get('timeline')
  timeline(@Param('studentId') studentId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.recordsService.timeline(studentId, this.tid(), user.id);
  }

  // ── Generic per-resource CRUD ─────────────────────────────────────────────

  @Get(':resource')
  async list(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Query() query: Record<string, any>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    await this.permit(STUDENT_RESOURCE_META[res].viewKey, user);
    return this.recordsService.list(studentId, res, this.tid(), user.id, query);
  }

  @Post(':resource')
  async create(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Body() dto: Record<string, any>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    await this.permit(STUDENT_RESOURCE_META[res].createKey, user);
    return this.recordsService.create(studentId, res, this.tid(), user.id, dto);
  }

  @Get(':resource/:recordId')
  async getOne(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    await this.permit(STUDENT_RESOURCE_META[res].viewKey, user);
    return this.recordsService.getOne(studentId, res, recordId, this.tid(), user.id);
  }

  @Patch(':resource/:recordId')
  async update(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: Record<string, any>,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    await this.permit(STUDENT_RESOURCE_META[res].updateKey, user);
    return this.recordsService.update(studentId, res, recordId, this.tid(), user.id, dto);
  }

  @Delete(':resource/:recordId')
  async remove(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    await this.permit(STUDENT_RESOURCE_META[res].deleteKey, user);
    return this.recordsService.remove(studentId, res, recordId, this.tid(), user.id);
  }

  // ── Documents: verify / reject ────────────────────────────────────────────

  @Post(':resource/:recordId/verify')
  async verifyDocument(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: DocumentDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'document');
    await this.permit(STUDENT_RESOURCE_META.document.updateKey, user);
    return this.recordsService.verifyDocument(studentId, recordId, this.tid(), user.id, dto.remarks);
  }

  @Post(':resource/:recordId/reject')
  async rejectDocument(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: DocumentDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'document');
    await this.permit(STUDENT_RESOURCE_META.document.updateKey, user);
    return this.recordsService.rejectDocument(studentId, recordId, this.tid(), user.id, dto.remarks);
  }

  // ── Fees: waive ───────────────────────────────────────────────────────────

  @Post(':resource/:recordId/waive')
  async waiveFee(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: WaiveFeeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'fee');
    await this.permit(STUDENT_RESOURCE_META.fee.updateKey, user);
    return this.recordsService.waiveFee(studentId, recordId, this.tid(), user.id, dto.amountCents, dto.reason);
  }

  // ── Payments: refund ──────────────────────────────────────────────────────

  @Post(':resource/:recordId/refund')
  async refundPayment(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: RefundPaymentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'payment');
    await this.permit(STUDENT_RESOURCE_META.payment.updateKey, user);
    return this.recordsService.refundPayment(studentId, recordId, this.tid(), user.id, dto.remarks);
  }

  // ── Certificates: status change ───────────────────────────────────────────

  @Post(':resource/:recordId/status')
  async changeCertificateStatus(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: CertificateStatusChangeDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'certificate');
    await this.permit(STUDENT_RESOURCE_META.certificate.updateKey, user);
    return this.recordsService.changeCertificateStatus(studentId, recordId, this.tid(), user.id, dto.status, dto.certificateNumber, dto.remarks);
  }

  // ── Library loans: return ─────────────────────────────────────────────────

  @Post(':resource/:recordId/return')
  async returnLibraryLoan(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: ReturnLibraryLoanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'libraryLoan');
    await this.permit(STUDENT_RESOURCE_META.libraryLoan.updateKey, user);
    return this.recordsService.returnLibraryLoan(studentId, recordId, this.tid(), user.id, dto.returnedAt, dto.fineCents, dto.remarks);
  }

  // ── Hostel bookings: check-in / check-out / cancel ────────────────────────

  @Post(':resource/:recordId/check-in')
  async hostelCheckIn(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'hostelBooking');
    await this.permit(STUDENT_RESOURCE_META.hostelBooking.updateKey, user);
    return this.recordsService.hostelCheckIn(studentId, recordId, this.tid(), user.id);
  }

  @Post(':resource/:recordId/check-out')
  async hostelCheckOut(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'hostelBooking');
    await this.permit(STUDENT_RESOURCE_META.hostelBooking.updateKey, user);
    return this.recordsService.hostelCheckOut(studentId, recordId, this.tid(), user.id);
  }

  @Post(':resource/:recordId/cancel')
  async cancel(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: DocumentDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    if (res === 'transportPass') {
      await this.permit(STUDENT_RESOURCE_META.transportPass.updateKey, user);
      return this.recordsService.cancelTransportPass(studentId, recordId, this.tid(), user.id, dto.remarks);
    }
    if (res === 'hostelBooking') {
      await this.permit(STUDENT_RESOURCE_META.hostelBooking.updateKey, user);
      return this.recordsService.cancelHostelBooking(studentId, recordId, this.tid(), user.id, dto.remarks);
    }
    throw new BadRequestException('Invalid resource for this action.');
  }

  // ── Holds: lift ───────────────────────────────────────────────────────────

  @Post(':resource/:recordId/lift')
  async liftHold(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: LiftHoldDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'hold');
    await this.permit(STUDENT_RESOURCE_META.hold.updateKey, user);
    return this.recordsService.liftHold(studentId, recordId, this.tid(), user.id, dto.remarks);
  }

  // ── Enrollments: withdraw ─────────────────────────────────────────────────

  @Post(':resource/:recordId/withdraw')
  async withdrawEnrollment(
    @Param('studentId') studentId: string,
    @Param('resource') resource: string,
    @Param('recordId') recordId: string,
    @Body() dto: DocumentDecisionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const res = this.resolveResource(resource);
    this.assertResource(res, 'enrollment');
    await this.permit(STUDENT_RESOURCE_META.enrollment.updateKey, user);
    return this.recordsService.withdrawEnrollment(studentId, recordId, this.tid(), user.id, dto.remarks);
  }
}