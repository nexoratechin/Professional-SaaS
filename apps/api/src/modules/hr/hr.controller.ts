/**
 * HR controller — the full employee-lifecycle API: employee master, designations, joining/exit,
 * employee documents (signed-URL upload flow), faculty workload, faculty timetable/attendance
 * reads, leave (types, balances, applications with approval), performance reviews, salary
 * structures, payroll runs with payslips, and an overview report. Guards follow the feature-module
 * convention (JwtAuth + TenantMatch + Permissions + FeatureFlags) with per-route permissions;
 * row-level scope is enforced in the services via hrEmployeeScopeFilter. Static sub-routes are
 * declared before parameter routes so NestJS never treats them as an :id.
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
import { HrService } from './hr.service';
import { HrLeaveService } from './hr-leave.service';
import { HrPerformanceService } from './hr-performance.service';
import { HrPayrollService } from './hr-payroll.service';
import {
  AdjustLeaveBalanceDto,
  ConfirmUploadDto,
  CreateDesignationDto,
  CreateEmployeeDto,
  CreateExitDto,
  CreateJoiningDto,
  CreateLeaveApplicationDto,
  CreateLeaveTypeDto,
  CreatePayrollRunDto,
  CreatePerformanceReviewDto,
  CreateSalaryStructureDto,
  CreateWorkloadDto,
  DecideLeaveDto,
  LinkPayslipDto,
  LinkUserDto,
  PayPayrollRunDto,
  QueryEmployeesDto,
  QueryLeaveApplicationsDto,
  QueryLeaveBalancesDto,
  QueryPayrollRunsDto,
  QueryPerformanceReviewsDto,
  QuerySalaryStructuresDto,
  QueryWorkloadsDto,
  RequestUploadUrlDto,
  UpdateDesignationDto,
  UpdateEmployeeDto,
  UpdateExitDto,
  UpdateJoiningDto,
  UpdateLeaveTypeDto,
  UpdatePerformanceReviewDto,
  UpdateSalaryStructureDto,
  UpdateWorkloadDto,
  VerifyDocumentDto,
} from './dto/hr.dto';

@ApiTags('hr')
@Controller('hr')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard)
@RequireFeature(FEATURE_KEYS.HR)
export class HrController {
  constructor(
    private readonly hrService: HrService,
    private readonly hrLeave: HrLeaveService,
    private readonly hrPerformance: HrPerformanceService,
    private readonly hrPayroll: HrPayrollService,
    private readonly tenantContext: TenantContextService,
  ) {}

  private tid(): string {
    return this.tenantContext.tenantId as string;
  }

  // ── Lookups & overview ────────────────────────────────────────────────────

  @Get('lookups')
  @RequirePermission(K.HR_VIEW)
  lookups(@CurrentUser() user: AuthenticatedUser) {
    return this.hrService.lookups(user);
  }

  @Get('reports/overview')
  @RequirePermission(K.HR_VIEW)
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.hrService.overview(this.tid(), user);
  }

  @Get('payslips/mine')
  @RequirePermission(K.HR_VIEW)
  myPayslips(@CurrentUser() user: AuthenticatedUser) {
    return this.hrPayroll.myPayslips(this.tid(), user);
  }

  // ── Designations ──────────────────────────────────────────────────────────

  @Get('designations')
  @RequirePermission(K.HR_VIEW)
  listDesignations() {
    return this.hrService.listDesignations();
  }

  @Post('designations')
  @RequirePermission(K.HR_CREATE)
  createDesignation(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDesignationDto) {
    return this.hrService.createDesignation(this.tid(), user, dto);
  }

  @Patch('designations/:id')
  @RequirePermission(K.HR_UPDATE)
  updateDesignation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateDesignationDto) {
    return this.hrService.updateDesignation(this.tid(), user, id, dto);
  }

  @Delete('designations/:id')
  @RequirePermission(K.HR_DELETE)
  removeDesignation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.removeDesignation(this.tid(), user, id);
  }

  // ── Employees ─────────────────────────────────────────────────────────────

  @Post('employees')
  @RequirePermission(K.HR_CREATE)
  createEmployee(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateEmployeeDto) {
    return this.hrService.createEmployee(this.tid(), user, dto);
  }

  @Get('employees')
  @RequirePermission(K.HR_VIEW)
  listEmployees(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryEmployeesDto) {
    return this.hrService.listEmployees(this.tid(), user, query);
  }

  @Get('employees/:id')
  @RequirePermission(K.HR_VIEW)
  getEmployee(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.getEmployee(this.tid(), user, id);
  }

  @Patch('employees/:id')
  @RequirePermission(K.HR_UPDATE)
  updateEmployee(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateEmployeeDto) {
    return this.hrService.updateEmployee(this.tid(), user, id, dto);
  }

  @Delete('employees/:id')
  @RequirePermission(K.HR_DELETE)
  archiveEmployee(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.archiveEmployee(this.tid(), user, id);
  }

  @Post('employees/:id/restore')
  @RequirePermission(K.HR_UPDATE)
  restoreEmployee(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.restoreEmployee(this.tid(), user, id);
  }

  @Post('employees/:id/link-user')
  @RequirePermission(K.HR_UPDATE)
  linkUser(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: LinkUserDto) {
    return this.hrService.linkUser(this.tid(), user, id, dto);
  }

  @Get('employees/:id/timetable')
  @RequirePermission(K.HR_VIEW)
  employeeTimetable(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.getEmployeeTimetable(this.tid(), user, id);
  }

  @Get('employees/:id/attendance')
  @RequirePermission(K.HR_VIEW)
  employeeAttendance(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.getEmployeeAttendance(this.tid(), user, id);
  }

  // ── Joining / exit ────────────────────────────────────────────────────────

  @Post('employees/:id/joinings')
  @RequirePermission(K.HR_CREATE)
  createJoining(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateJoiningDto) {
    return this.hrService.createJoining(this.tid(), user, id, dto);
  }

  @Get('employees/:id/joinings')
  @RequirePermission(K.HR_VIEW)
  listJoinings(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.listJoinings(this.tid(), user, id);
  }

  @Patch('joinings/:joiningId')
  @RequirePermission(K.HR_UPDATE)
  updateJoining(@CurrentUser() user: AuthenticatedUser, @Param('joiningId') joiningId: string, @Body() dto: UpdateJoiningDto) {
    return this.hrService.updateJoining(this.tid(), user, joiningId, dto);
  }

  @Post('employees/:id/exits')
  @RequirePermission(K.HR_CREATE)
  createExit(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateExitDto) {
    return this.hrService.createExit(this.tid(), user, id, dto);
  }

  @Get('employees/:id/exits')
  @RequirePermission(K.HR_VIEW)
  listExits(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.listExits(this.tid(), user, id);
  }

  @Patch('exits/:exitId')
  @RequirePermission(K.HR_UPDATE)
  updateExit(@CurrentUser() user: AuthenticatedUser, @Param('exitId') exitId: string, @Body() dto: UpdateExitDto) {
    return this.hrService.updateExit(this.tid(), user, exitId, dto);
  }

  // ── Employee documents ────────────────────────────────────────────────────

  @Post('employees/:id/documents/upload-url')
  @RequirePermission(K.HR_CREATE)
  requestDocumentUpload(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: RequestUploadUrlDto) {
    return this.hrService.requestDocumentUpload(this.tid(), user, id, dto);
  }

  @Get('employees/:id/documents')
  @RequirePermission(K.HR_VIEW)
  listDocuments(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrService.listDocuments(this.tid(), user, id);
  }

  @Post('documents/:documentId/confirm')
  @RequirePermission(K.HR_UPDATE)
  confirmDocumentUpload(@CurrentUser() user: AuthenticatedUser, @Param('documentId') documentId: string, @Body() dto: ConfirmUploadDto) {
    return this.hrService.confirmDocumentUpload(this.tid(), user, documentId, dto);
  }

  @Post('documents/:documentId/verify')
  @RequirePermission(K.HR_UPDATE)
  verifyDocument(@CurrentUser() user: AuthenticatedUser, @Param('documentId') documentId: string, @Body() dto: VerifyDocumentDto) {
    return this.hrService.verifyDocument(this.tid(), user, documentId, dto);
  }

  @Get('documents/:documentId/download-url')
  @RequirePermission(K.HR_VIEW)
  documentDownloadUrl(@CurrentUser() user: AuthenticatedUser, @Param('documentId') documentId: string) {
    return this.hrService.getDocumentDownloadUrl(this.tid(), user, documentId);
  }

  @Delete('documents/:documentId')
  @RequirePermission(K.HR_DELETE)
  removeDocument(@CurrentUser() user: AuthenticatedUser, @Param('documentId') documentId: string) {
    return this.hrService.removeDocument(this.tid(), user, documentId);
  }

  // ── Faculty workload ──────────────────────────────────────────────────────

  @Post('workloads')
  @RequirePermission(K.HR_CREATE)
  createWorkload(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateWorkloadDto) {
    return this.hrService.createWorkload(this.tid(), user, dto);
  }

  @Get('workloads')
  @RequirePermission(K.HR_VIEW)
  listWorkloads(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryWorkloadsDto) {
    return this.hrService.listWorkloads(this.tid(), user, query);
  }

  @Patch('workloads/:workloadId')
  @RequirePermission(K.HR_UPDATE)
  updateWorkload(@CurrentUser() user: AuthenticatedUser, @Param('workloadId') workloadId: string, @Body() dto: UpdateWorkloadDto) {
    return this.hrService.updateWorkload(this.tid(), user, workloadId, dto);
  }

  @Delete('workloads/:workloadId')
  @RequirePermission(K.HR_DELETE)
  deleteWorkload(@CurrentUser() user: AuthenticatedUser, @Param('workloadId') workloadId: string) {
    return this.hrService.deleteWorkload(this.tid(), user, workloadId);
  }

  // ── Leave types ───────────────────────────────────────────────────────────

  @Get('leave-types')
  @RequirePermission(K.HR_VIEW)
  listLeaveTypes() {
    return this.hrLeave.listLeaveTypes();
  }

  @Post('leave-types')
  @RequirePermission(K.HR_CREATE)
  createLeaveType(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeaveTypeDto) {
    return this.hrLeave.createLeaveType(this.tid(), user, dto);
  }

  @Patch('leave-types/:id')
  @RequirePermission(K.HR_UPDATE)
  updateLeaveType(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateLeaveTypeDto) {
    return this.hrLeave.updateLeaveType(this.tid(), user, id, dto);
  }

  @Delete('leave-types/:id')
  @RequirePermission(K.HR_DELETE)
  deleteLeaveType(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrLeave.deleteLeaveType(this.tid(), user, id);
  }

  // ── Leave balances ────────────────────────────────────────────────────────

  @Get('leave-balances')
  @RequirePermission(K.HR_VIEW)
  listLeaveBalances(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryLeaveBalancesDto) {
    return this.hrLeave.listLeaveBalances(this.tid(), user, query);
  }

  @Post('leave-balances/adjust')
  @RequirePermission(K.HR_UPDATE)
  adjustLeaveBalance(@CurrentUser() user: AuthenticatedUser, @Body() dto: AdjustLeaveBalanceDto) {
    return this.hrLeave.adjustLeaveBalance(this.tid(), user, dto);
  }

  // ── Leave applications ────────────────────────────────────────────────────

  @Post('leave-applications')
  @RequirePermission(K.HR_VIEW)
  createLeaveApplication(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLeaveApplicationDto) {
    return this.hrLeave.createLeaveApplication(this.tid(), user, dto);
  }

  @Get('leave-applications')
  @RequirePermission(K.HR_VIEW)
  listLeaveApplications(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryLeaveApplicationsDto) {
    return this.hrLeave.listLeaveApplications(this.tid(), user, query);
  }

  @Patch('leave-applications/:id')
  @RequirePermission(K.HR_UPDATE)
  updateLeaveApplication(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CreateLeaveApplicationDto) {
    return this.hrLeave.updateLeaveApplication(this.tid(), user, id, dto);
  }

  @Post('leave-applications/:id/cancel')
  @RequirePermission(K.HR_UPDATE)
  cancelLeaveApplication(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.hrLeave.cancelLeaveApplication(this.tid(), user, id);
  }

  @Post('leave-applications/:id/approve')
  @RequirePermission(K.HR_UPDATE)
  approveLeave(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.hrLeave.decideLeaveApplication(this.tid(), user, id, 'APPROVED', dto);
  }

  @Post('leave-applications/:id/reject')
  @RequirePermission(K.HR_UPDATE)
  rejectLeave(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: DecideLeaveDto) {
    return this.hrLeave.decideLeaveApplication(this.tid(), user, id, 'REJECTED', dto);
  }

  // ── Performance reviews ───────────────────────────────────────────────────

  @Post('performance-reviews')
  @RequirePermission(K.HR_CREATE)
  createReview(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePerformanceReviewDto) {
    return this.hrPerformance.createReview(this.tid(), user, dto);
  }

  @Get('performance-reviews')
  @RequirePermission(K.HR_VIEW)
  listReviews(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryPerformanceReviewsDto) {
    return this.hrPerformance.listReviews(this.tid(), user, query);
  }

  @Patch('performance-reviews/:reviewId')
  @RequirePermission(K.HR_UPDATE)
  updateReview(@CurrentUser() user: AuthenticatedUser, @Param('reviewId') reviewId: string, @Body() dto: UpdatePerformanceReviewDto) {
    return this.hrPerformance.updateReview(this.tid(), user, reviewId, dto);
  }

  @Post('performance-reviews/:reviewId/submit')
  @RequirePermission(K.HR_UPDATE)
  submitReview(@CurrentUser() user: AuthenticatedUser, @Param('reviewId') reviewId: string) {
    return this.hrPerformance.submitReview(this.tid(), user, reviewId);
  }

  @Post('performance-reviews/:reviewId/approve')
  @RequirePermission(K.HR_UPDATE)
  approveReview(@CurrentUser() user: AuthenticatedUser, @Param('reviewId') reviewId: string) {
    return this.hrPerformance.approveReview(this.tid(), user, reviewId);
  }

  @Post('performance-reviews/:reviewId/reject')
  @RequirePermission(K.HR_UPDATE)
  rejectReview(@CurrentUser() user: AuthenticatedUser, @Param('reviewId') reviewId: string) {
    return this.hrPerformance.rejectReview(this.tid(), user, reviewId);
  }

  @Post('performance-reviews/:reviewId/complete')
  @RequirePermission(K.HR_UPDATE)
  completeReview(@CurrentUser() user: AuthenticatedUser, @Param('reviewId') reviewId: string) {
    return this.hrPerformance.completeReview(this.tid(), user, reviewId);
  }

  // ── Salary structures ─────────────────────────────────────────────────────

  @Post('salary-structures')
  @RequirePermission(K.HR_MANAGE)
  createSalaryStructure(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateSalaryStructureDto) {
    return this.hrPayroll.createSalaryStructure(this.tid(), user, dto);
  }

  @Get('salary-structures')
  @RequirePermission(K.HR_VIEW)
  listSalaryStructures(@CurrentUser() user: AuthenticatedUser, @Query() query: QuerySalaryStructuresDto) {
    return this.hrPayroll.listSalaryStructures(this.tid(), user, query);
  }

  @Patch('salary-structures/:id')
  @RequirePermission(K.HR_MANAGE)
  updateSalaryStructure(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateSalaryStructureDto) {
    return this.hrPayroll.updateSalaryStructure(this.tid(), user, id, dto);
  }

  // ── Payroll runs ──────────────────────────────────────────────────────────

  @Post('payroll-runs')
  @RequirePermission(K.HR_MANAGE)
  createPayrollRun(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePayrollRunDto) {
    return this.hrPayroll.createPayrollRun(this.tid(), user, dto);
  }

  @Get('payroll-runs')
  @RequirePermission(K.HR_VIEW)
  listPayrollRuns(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryPayrollRunsDto) {
    return this.hrPayroll.listPayrollRuns(this.tid(), user, query);
  }

  @Get('payroll-runs/:runId')
  @RequirePermission(K.HR_VIEW)
  getPayrollRun(@CurrentUser() user: AuthenticatedUser, @Param('runId') runId: string) {
    return this.hrPayroll.getPayrollRun(this.tid(), user, runId);
  }

  @Post('payroll-runs/:runId/process')
  @RequirePermission(K.HR_MANAGE)
  processPayrollRun(@CurrentUser() user: AuthenticatedUser, @Param('runId') runId: string) {
    return this.hrPayroll.processPayrollRun(this.tid(), user, runId);
  }

  @Post('payroll-runs/:runId/approve')
  @RequirePermission(K.HR_MANAGE)
  approvePayrollRun(@CurrentUser() user: AuthenticatedUser, @Param('runId') runId: string) {
    return this.hrPayroll.approvePayrollRun(this.tid(), user, runId);
  }

  @Post('payroll-runs/:runId/pay')
  @RequirePermission(K.HR_MANAGE)
  payPayrollRun(@CurrentUser() user: AuthenticatedUser, @Param('runId') runId: string, @Body() dto: PayPayrollRunDto) {
    return this.hrPayroll.payPayrollRun(this.tid(), user, runId, dto);
  }

  @Post('payroll-runs/:runId/cancel')
  @RequirePermission(K.HR_MANAGE)
  cancelPayrollRun(@CurrentUser() user: AuthenticatedUser, @Param('runId') runId: string) {
    return this.hrPayroll.cancelPayrollRun(this.tid(), user, runId);
  }

  @Post('payroll-lines/:lineId/payslip')
  @RequirePermission(K.HR_MANAGE)
  linkPayslip(@CurrentUser() user: AuthenticatedUser, @Param('lineId') lineId: string, @Body() dto: LinkPayslipDto) {
    return this.hrPayroll.linkPayslip(this.tid(), user, lineId, dto);
  }
}