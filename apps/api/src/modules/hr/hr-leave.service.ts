/**
 * HR leave management — leave type catalogue, per-employee/per-year balances, applications with
 * approval decisions and notifications. Creation is self-serviceable: a faculty member with
 * OWN-scope hr.view may apply for leave on their own record; approving/rejecting/cancelling and
 * adjusting balances require hr.update scoped to the applicant's employee row.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { HrService } from './hr.service';
import * as HrDto from './dto/hr.dto';
import type { ScopeGrantLike } from '../students/student-scope';

type Where = Record<string, unknown>;

const leaveApplicationInclude = {
  employee: { select: { id: true, userId: true, firstName: true, lastName: true } },
  leaveType: true,
} as const;

type LeaveApplicationWithRelations = Prisma.LeaveApplicationGetPayload<{ include: typeof leaveApplicationInclude }>;

@Injectable()
export class HrLeaveService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService,
    private readonly hr: HrService,
  ) {}

  private hasOrgScope(grants: ScopeGrantLike[]): boolean {
    return grants.some((g) => g.scopeType !== 'OWN');
  }

  private computeLeaveDays(fromDate: Date, toDate: Date, halfDayOption?: string): number {
    const msPerDay = 86_400_000;
    const inclusiveDays = Math.round((toDate.getTime() - fromDate.getTime()) / msPerDay) + 1;
    if (halfDayOption) return Math.max(0.5, inclusiveDays - 0.5);
    return inclusiveDays;
  }

  // ── Leave types ───────────────────────────────────────────────────────────

  listLeaveTypes() {
    return this.tenantPrisma.client.leaveType.findMany({ where: { deletedAt: null }, orderBy: { code: 'asc' } });
  }

  async createLeaveType(tenantId: string, user: AuthenticatedUser, dto: HrDto.CreateLeaveTypeDto) {
    const created = await this.tenantPrisma.client.leaveType
      .create({
        data: { tenantId, code: dto.code, name: dto.name, category: dto.category as 'CASUAL' | 'SICK' | 'EARNED' | 'MATERNITY' | 'PATERNITY' | 'UNPAID' | 'HALF_DAY' | 'COMPENSATORY' | 'SPECIAL' | 'OTHER', description: dto.description, color: dto.color, maxDaysPerYear: dto.maxDaysPerYear, isPaid: dto.isPaid ?? true, requiresApproval: dto.requiresApproval ?? true, createdBy: user.id },
      })
      .catch(() => {
        throw new ConflictException('A leave type with this code already exists.');
      });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.LEAVE_TYPE_CREATED, 'LeaveType', created.id, { code: created.code });
    return created;
  }

  async updateLeaveType(tenantId: string, user: AuthenticatedUser, id: string, dto: HrDto.UpdateLeaveTypeDto) {
    await this.leaveTypeOrThrow(id);
    const updated = await this.tenantPrisma.client.leaveType
      .update({ where: { id }, data: { ...dto, updatedBy: user.id, category: dto.category as 'CASUAL' | 'SICK' | 'EARNED' | 'MATERNITY' | 'PATERNITY' | 'UNPAID' | 'HALF_DAY' | 'COMPENSATORY' | 'SPECIAL' | 'OTHER' } })
      .catch(() => {
        throw new ConflictException('A leave type with this code already exists.');
      });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.LEAVE_TYPE_UPDATED, 'LeaveType', updated.id, dto);
    return updated;
  }

  async deleteLeaveType(tenantId: string, user: AuthenticatedUser, id: string) {
    await this.leaveTypeOrThrow(id);
    const usage = await this.tenantPrisma.client.leaveApplication.count({ where: { leaveTypeId: id } });
    if (usage > 0) throw new BadRequestException('Leave type has applications and cannot be deleted.');
    await this.tenantPrisma.client.leaveType.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedBy: user.id } });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.LEAVE_TYPE_DELETED, 'LeaveType', id);
  }

  private async leaveTypeOrThrow(id: string) {
    const found = await this.tenantPrisma.client.leaveType.findFirst({ where: { id, deletedAt: null } });
    if (!found) throw new NotFoundException('Leave type not found.');
    return found;
  }

  // ── Balances ──────────────────────────────────────────────────────────────

  async adjustLeaveBalance(tenantId: string, user: AuthenticatedUser, dto: HrDto.AdjustLeaveBalanceDto) {
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, dto.employeeId);
    await this.leaveTypeOrThrow(dto.leaveTypeId);

    const existing = await this.tenantPrisma.client.leaveBalance.findUnique({
      where: { tenantId_employeeId_leaveTypeId_year: { tenantId, employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year } },
    });

    const openingBalance = existing?.openingBalance ?? dto.openingBalance ?? 0;
    const creditedDays = (existing?.creditedDays ?? 0) + (dto.creditedDays ?? 0);
    const availedDays = (existing?.availedDays ?? 0) + (dto.availedDays ?? 0);
    const adjustedDays = (existing?.adjustedDays ?? 0) + (dto.adjustedDays ?? 0);
    const closingBalance = openingBalance + creditedDays - availedDays - adjustedDays;

    const balance = await this.tenantPrisma.client.leaveBalance.upsert({
      where: { tenantId_employeeId_leaveTypeId_year: { tenantId, employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year } },
      create: { tenantId, employeeId: dto.employeeId, leaveTypeId: dto.leaveTypeId, year: dto.year, openingBalance, creditedDays, availedDays, adjustedDays, closingBalance, updatedBy: user.id },
      update: { openingBalance, creditedDays, availedDays, adjustedDays, closingBalance, updatedBy: user.id },
    });

    await this.audit(tenantId, user.id, AUDIT_ACTIONS.LEAVE_BALANCE_ADJUSTED, 'LeaveBalance', balance.id, {
      employeeId: dto.employeeId,
      leaveTypeId: dto.leaveTypeId,
      year: dto.year,
      openingBalance,
      creditedDays,
      availedDays,
      adjustedDays,
      closingBalance,
    });
    return balance;
  }

  async listLeaveBalances(tenantId: string, user: AuthenticatedUser, query: HrDto.QueryLeaveBalancesDto) {
    const { where } = await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const clauses: Where[] = [];
    if (where) clauses.push({ employee: where });
    if (query.employeeId) clauses.push({ employeeId: query.employeeId });
    if (query.year) clauses.push({ year: query.year });

    const whereFinal: Where | undefined = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { AND: clauses };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.leaveBalance.findMany({
        where: whereFinal ?? undefined,
        orderBy: [{ year: 'desc' }, { createdAt: 'asc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          leaveType: { select: { id: true, code: true, name: true, category: true } },
        },
      }),
      this.tenantPrisma.client.leaveBalance.count({ where: whereFinal ?? undefined }),
    ]);
    return { data, total };
  }

  // ── Applications ──────────────────────────────────────────────────────────

  async createLeaveApplication(tenantId: string, user: AuthenticatedUser, dto: HrDto.CreateLeaveApplicationDto) {
    const viewScope = await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const employee = await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_VIEW, dto.employeeId);
    const leaveType = await this.leaveTypeOrThrow(dto.leaveTypeId);

    // OWN-only callers (faculty self-service) may only apply on their own record.
    if (!this.hasOrgScope(viewScope.grants) && employee.userId !== user.id) {
      throw new ForbiddenException('You may only apply for leave on your own record.');
    }

    const fromDate = new Date(dto.fromDate);
    const toDate = new Date(dto.toDate);
    if (fromDate > toDate) throw new BadRequestException('fromDate must be on or before toDate.');

    const overlaps = await this.tenantPrisma.client.leaveApplication.count({
      where: {
        employeeId: dto.employeeId,
        status: { in: ['PENDING', 'APPROVED'] },
        OR: [{ fromDate: { lte: toDate }, toDate: { gte: fromDate } }],
      },
    });
    if (overlaps > 0) throw new BadRequestException('Leave already applied for part of this period.');

    const durationDays = dto.durationDays ?? this.computeLeaveDays(fromDate, toDate, dto.halfDayOption);

    const application = await this.tenantPrisma.client.leaveApplication.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        leaveTypeId: dto.leaveTypeId,
        fromDate,
        toDate,
        durationDays,
        halfDayOption: dto.halfDayOption,
        reason: dto.reason,
        createdBy: user.id,
      },
      include: { employee: { select: { id: true, firstName: true, lastName: true, userId: true } }, leaveType: true },
    });

    await this.audit(tenantId, user.id, AUDIT_ACTIONS.LEAVE_APPLICATION_CREATED, 'LeaveApplication', application.id, {
      employeeId: application.employeeId,
      fromDate,
      toDate,
      durationDays,
      leaveTypeId: leaveType.id,
    });
    return application;
  }

  async listLeaveApplications(tenantId: string, user: AuthenticatedUser, query: HrDto.QueryLeaveApplicationsDto) {
    const { where } = await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const clauses: Where[] = [];
    if (where) clauses.push({ employee: where });
    if (query.status) clauses.push({ status: query.status });
    if (query.employeeId) clauses.push({ employeeId: query.employeeId });
    if (query.leaveTypeId) clauses.push({ leaveTypeId: query.leaveTypeId });

    const whereFinal: Where | undefined = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { AND: clauses };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.leaveApplication.findMany({
        where: whereFinal ?? undefined,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
          leaveType: { select: { id: true, code: true, name: true, category: true } },
          approvedByUser: { select: { id: true, email: true, fullName: true } },
        },
      }),
      this.tenantPrisma.client.leaveApplication.count({ where: whereFinal ?? undefined }),
    ]);
    return { data, total };
  }

  async updateLeaveApplication(tenantId: string, user: AuthenticatedUser, id: string, dto: Partial<HrDto.CreateLeaveApplicationDto>) {
    const application = await this.applicationOrThrow(id);
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, application.employeeId);
    if (application.status !== 'PENDING') throw new BadRequestException('Only pending applications can be edited.');

    const fromDate = dto.fromDate ? new Date(dto.fromDate) : application.fromDate;
    const toDate = dto.toDate ? new Date(dto.toDate) : application.toDate;
    if (fromDate > toDate) throw new BadRequestException('fromDate must be on or before toDate.');
    const durationDays = dto.durationDays ?? this.computeLeaveDays(fromDate, toDate, dto.halfDayOption ?? application.halfDayOption ?? undefined);

    const updated = await this.tenantPrisma.client.leaveApplication.update({
      where: { id },
      data: {
        ...(dto.leaveTypeId ? { leaveTypeId: dto.leaveTypeId } : {}),
        ...(dto.fromDate ? { fromDate } : {}),
        ...(dto.toDate ? { toDate } : {}),
        ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
        ...(dto.halfDayOption !== undefined ? { halfDayOption: dto.halfDayOption } : {}),
        durationDays,
        updatedBy: user.id,
      },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.LEAVE_APPLICATION_UPDATED, 'LeaveApplication', id, { durationDays });
    return updated;
  }

  async cancelLeaveApplication(tenantId: string, user: AuthenticatedUser, id: string) {
    const application = await this.applicationOrThrow(id);
    const employee = await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, application.employeeId);

    // Self-service own-scope callers can cancel their own pending application.
    const viewScope = await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    if (application.status !== 'PENDING') throw new BadRequestException('Only pending applications can be cancelled.');
    if (employee.userId === user.id && application.createdBy === user.id) {
      // allowed
    } else if (!this.hasOrgScope(viewScope.grants)) {
      throw new ForbiddenException('You may only cancel your own leave applications.');
    }

    const updated = await this.tenantPrisma.client.leaveApplication.update({
      where: { id },
      data: { status: 'CANCELLED', updatedBy: user.id },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.LEAVE_APPLICATION_CANCELLED, 'LeaveApplication', id, {
      employeeId: application.employeeId,
    });
    return updated;
  }

  async decideLeaveApplication(
    tenantId: string,
    user: AuthenticatedUser,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    dto: HrDto.DecideLeaveDto,
  ) {
    const application = await this.applicationOrThrow(id);
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, application.employeeId);
    if (application.status !== 'PENDING') throw new BadRequestException('Only pending applications can be decided.');

    if (decision === 'APPROVED') {
      await this.accountForApprovedLeave(application);
    }

    const updated = await this.tenantPrisma.client.leaveApplication.update({
      where: { id },
      data: { status: decision, approvedByUserId: user.id, decidedAt: new Date(), decisionRemarks: dto.remarks },
    });

    await this.audit(
      tenantId,
      user.id,
      decision === 'APPROVED' ? AUDIT_ACTIONS.LEAVE_APPLICATION_APPROVED : AUDIT_ACTIONS.LEAVE_APPLICATION_REJECTED,
      'LeaveApplication',
      id,
      { employeeId: application.employeeId, decisionRemarks: dto.remarks ?? undefined },
    );

    if (application.employee.userId) {
      await this.notifications.sendSystem(tenantId, {
        recipientUserId: application.employee.userId,
        subject: `Leave ${decision.toLowerCase()}`,
        body: `Your leave (${application.leaveType.name}, ${application.durationDays} day(s) from ${application.fromDate.toISOString().slice(0, 10)} to ${application.toDate.toISOString().slice(0, 10)}) was ${decision.toLowerCase()}.`,
      });
    }

    return updated;
  }

  /** On approval, decrement the applicant's balance ledger for the application's year. */
  private async accountForApprovedLeave(application: LeaveApplicationWithRelations): Promise<void> {
    const leaveType = application.leaveType;
    if (leaveType.maxDaysPerYear == null) return;

    const year = application.fromDate.getFullYear();
    const balance = await this.tenantPrisma.client.leaveBalance.findUnique({
      where: {
        tenantId_employeeId_leaveTypeId_year: {
          tenantId: application.tenantId,
          employeeId: application.employeeId,
          leaveTypeId: application.leaveTypeId,
          year,
        },
      },
    });

    if (!balance) {
      throw new BadRequestException(`No leave balance on record for ${leaveType.code} in ${year} — adjust the balance first.`);
    }

    const remaining = (balance.closingBalance ?? balance.openingBalance + balance.creditedDays - balance.availedDays - balance.adjustedDays) - application.durationDays;
    if (remaining < -1e-9) {
      throw new BadRequestException(`Insufficient ${leaveType.code} balance — only ${balance.closingBalance ?? 0} day(s) remaining.`);
    }

    const availedDays = balance.availedDays + application.durationDays;
    const closingBalance = Math.max(0, (balance.closingBalance ?? balance.openingBalance + balance.creditedDays - balance.availedDays - balance.adjustedDays) - application.durationDays);

    await this.tenantPrisma.client.leaveBalance.update({
      where: { id: balance.id },
      data: { availedDays, closingBalance },
    });
  }

  private async applicationOrThrow(id: string) {
    const application = await this.tenantPrisma.client.leaveApplication.findFirst({
      where: { id },
      include: leaveApplicationInclude,
    });
    if (!application) throw new NotFoundException('Leave application not found.');
    return application;
  }

  private async audit(tenantId: string, actorUserId: string, action: string, entityType: string, entityId: string, after?: unknown): Promise<void> {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action,
      module: AUDIT_MODULES.HR,
      entityType,
      entityId,
      after,
    });
  }
}