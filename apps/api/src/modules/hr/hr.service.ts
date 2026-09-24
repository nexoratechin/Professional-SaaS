/**
 * HR module core service — employee master, designations, joining/exit, employee documents,
 * faculty workload, faculty timetable/attendance reads (reusing the attendance + timetable
 * tables by their userId link), plus the shared scoping used by every other HR service.
 *
 * Conventions mirror the students/attendance modules: every read/write goes through the
 * tenant-scoped Prisma client, every operation is row-scoped to the caller's permission grants
 * via hrEmployeeScopeFilter (see hr-scope.ts), and each sensitive mutation records an audit
 * entry under AUDIT_MODULES.HR.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS as K, type AuthenticatedUser, type PermissionKey } from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { PermissionsService, type ScopeGrant } from '../rbac/permissions.service';
import { StorageService } from '../../common/storage/storage.service';
import { hrEmployeeScopeFilter, type HrScopeResult } from './hr-scope';
import * as HrDto from './dto/hr.dto';

type Where = Record<string, unknown>;

export interface ResolvedHrScope {
  grants: ScopeGrant[];
  scope: HrScopeResult;
  /** Employee-level Prisma `where` from the grants; undefined = GLOBAL (unrestricted). */
  where: Where | undefined;
  campusIds: Set<string>;
  departmentIds: Set<string>;
}

const EXIT_TYPE_TO_STATUS: Record<string, string> = {
  RESIGNATION: 'RESIGNED',
  MUTUAL_SEPARATION: 'RESIGNED',
  END_OF_CONTRACT: 'RESIGNED',
  TERMINATION: 'TERMINATED',
  RETIREMENT: 'RETIRED',
};

const employeeInclude = {
    department: true,
    designation: true,
    campus: true,
    user: { select: { id: true, email: true, fullName: true, status: true } },
    reportingTo: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
  } as const;

type ScopedEmployeeWithRelations = Prisma.EmployeeGetPayload<{ include: typeof employeeInclude }>;

@Injectable()
export class HrService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly permissions: PermissionsService,
    private readonly storage: StorageService,
  ) {}

  // ── Shared scope resolution ───────────────────────────────────────────────

  /** Resolves the caller's grants for a permission into an Employee-row where clause (plus the
   * raw sets the services still need for membership checks). PROGRAM grants are resolved UP to
   * their department id — the org-module convention — because an Employee row doesn't carry a
   * programId. */
  async resolveEmployeeScope(tenantId: string, userId: string, permissionKey: PermissionKey): Promise<ResolvedHrScope> {
    const grants = await this.permissions.getScopeGrantsFor(tenantId, userId, permissionKey);
    const campusIds = new Set<string>();
    const departmentIds = new Set<string>();
    const programIds = new Set<string>();

    for (const g of grants) {
      if (g.scopeType === 'CAMPUS' && g.campusId) campusIds.add(g.campusId);
      if (g.scopeType === 'DEPARTMENT' && g.departmentId) departmentIds.add(g.departmentId);
      if (g.scopeType === 'PROGRAM' && g.programId) programIds.add(g.programId);
    }

    if (programIds.size > 0) {
      const programs = await this.tenantPrisma.client.program.findMany({
        where: { id: { in: [...programIds] } },
        select: { id: true, departmentId: true },
      });
      for (const p of programs) if (p.departmentId) departmentIds.add(p.departmentId);
    }

    const scope = hrEmployeeScopeFilter({ grants, actorUserId: userId, campusIds, departmentIds });
    return { grants, scope, where: scope.employeeWhere, campusIds, departmentIds };
  }

  /** Global-only gate for tenant-wide administrative actions (payroll run lifecycle, salary
   * structures) — a department/campus-scoped hr.manage grant must not run payroll for everyone. */
  assertGlobal(grants: ScopeGrant[]): void {
    if (!grants.some((g) => g.scopeType === 'GLOBAL')) {
      throw new ForbiddenException('Global HR management access is required for this action.');
    }
  }

  /** Loads one employee only if it falls within the caller's scope for the given permission. */
  async fetchScopedEmployee(
    tenantId: string,
    userId: string,
    permissionKey: PermissionKey,
    employeeId: string,
    options: { includeDeleted?: boolean } = {},
  ): Promise<ScopedEmployeeWithRelations> {
    const { where } = await this.resolveEmployeeScope(tenantId, userId, permissionKey);
    const employee = await this.tenantPrisma.client.employee.findFirst({
      where: { id: employeeId, ...(options.includeDeleted ? {} : { deletedAt: null }), ...(where ?? {}) },
      include: employeeInclude,
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    return employee;
  }

  /** Guards a create whose department/campus must fall inside the caller's grants. */
  private async assertCreateTargetInScope(
    res: ResolvedHrScope,
    departmentId: string,
    campusId: string | undefined,
  ): Promise<void> {
    if (res.scope.employeeWhere === undefined) return;
    if (res.departmentIds.has(departmentId)) return;

    let campus = campusId;
    if (!campus) {
      const dept = await this.tenantPrisma.client.department.findFirst({
        where: { id: departmentId },
        select: { campusId: true },
      });
      campus = dept?.campusId ?? undefined;
    }
    if (campus && res.campusIds.has(campus)) return;

    throw new ForbiddenException('The target department/campus is outside your HR scope.');
  }

  private mapP2002(err: unknown, message: string): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictException(message);
    }
    throw err;
  }

  private async audited(
    tenantId: string,
    actorUserId: string,
    action: string,
    entityType: string,
    entityId: string,
    after?: unknown,
    before?: unknown,
  ): Promise<void> {
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action,
      module: AUDIT_MODULES.HR,
      entityType,
      entityId,
      before,
      after,
    });
  }

  // ── Lookups ───────────────────────────────────────────────────────────────

  async lookups(_user: AuthenticatedUser) {
    const [campuses, departments, designations, leaveTypes, terms, users] = await Promise.all([
      this.tenantPrisma.client.campus.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      this.tenantPrisma.client.department.findMany({
        where: { deletedAt: null },
        orderBy: { name: 'asc' },
        include: { campus: { select: { id: true, name: true } } },
      }),
      this.tenantPrisma.client.hrDesignation.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { rank: 'asc' } }),
      this.tenantPrisma.client.leaveType.findMany({ where: { deletedAt: null, isActive: true }, orderBy: { code: 'asc' } }),
      this.tenantPrisma.client.term.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
      this.tenantPrisma.client.user.findMany({
        where: { status: 'ACTIVE' },
        select: { id: true, email: true, fullName: true },
        orderBy: { fullName: 'asc' },
        take: 500,
      }),
    ]);

    return {
      campuses,
      departments,
      designations,
      leaveTypes,
      terms,
      users,
      enums: {
        employeeTypes: [...HrDto.EMPLOYEE_TYPES],
        employmentTypes: [...HrDto.EMPLOYMENT_TYPES],
        employeeStatuses: [...HrDto.EMPLOYEE_STATUSES],
        joiningStatuses: [...HrDto.JOINING_STATUSES],
        exitTypes: [...HrDto.EXIT_TYPES],
        documentTypes: [...HrDto.DOCUMENT_TYPES],
        workloadTypes: [...HrDto.WORKLOAD_TYPES],
        leaveCategories: [...HrDto.LEAVE_CATEGORIES],
        reviewTypes: [...HrDto.REVIEW_TYPES],
        noDueStatuses: [...HrDto.NO_DUE_STATUSES],
        halfDayOptions: [...HrDto.HALF_DAY_OPTIONS],
        payrollRunStatuses: [...HrDto.PAYROLL_RUN_STATUSES],
      },
    };
  }

  // ── Designations ──────────────────────────────────────────────────────────

  async listDesignations() {
    return this.tenantPrisma.client.hrDesignation.findMany({
      where: { deletedAt: null },
      orderBy: [{ rank: 'asc' }, { name: 'asc' }],
      include: { department: { select: { id: true, name: true } } },
    });
  }

  async createDesignation(tenantId: string, user: AuthenticatedUser, dto: HrDto.CreateDesignationDto) {
    const created = await this.tenantPrisma.client.hrDesignation
      .create({
        data: { tenantId, departmentId: dto.departmentId, code: dto.code, name: dto.name, description: dto.description, rank: dto.rank ?? 0, isActive: dto.isActive ?? true, createdBy: user.id },
      })
      .catch((e) => this.mapP2002(e, 'A designation with this code already exists.'));
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.HR_DESIGNATION_CREATED, 'HrDesignation', created.id, { code: created.code });
    return created;
  }

  async updateDesignation(tenantId: string, user: AuthenticatedUser, id: string, dto: HrDto.UpdateDesignationDto) {
    await this.designationOrThrow(id);
    const updated = await this.tenantPrisma.client.hrDesignation
      .update({ where: { id }, data: { ...dto, updatedBy: user.id } })
      .catch((e) => this.mapP2002(e, 'A designation with this code already exists.'));
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.HR_DESIGNATION_UPDATED, 'HrDesignation', updated.id, dto);
    return updated;
  }

  async removeDesignation(tenantId: string, user: AuthenticatedUser, id: string) {
    const found = await this.designationOrThrow(id);
    const employees = await this.tenantPrisma.client.employee.count({ where: { designationId: id, deletedAt: null } });
    if (employees > 0) throw new BadRequestException('Designation is assigned to active employees and cannot be deleted.');
    await this.tenantPrisma.client.hrDesignation.update({ where: { id }, data: { deletedAt: new Date(), updatedBy: user.id } });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.HR_DESIGNATION_DELETED, 'HrDesignation', id, { code: found.code });
  }

  private async designationOrThrow(id: string) {
    const found = await this.tenantPrisma.client.hrDesignation.findFirst({ where: { id, deletedAt: null } });
    if (!found) throw new NotFoundException('Designation not found.');
    return found;
  }

  // ── Employees ─────────────────────────────────────────────────────────────

  async createEmployee(tenantId: string, user: AuthenticatedUser, dto: HrDto.CreateEmployeeDto) {
    const dept = await this.tenantPrisma.client.department.findFirst({ where: { id: dto.departmentId } });
    if (!dept) throw new BadRequestException('Department not found.');
    const targetScope = await this.resolveEmployeeScope(tenantId, user.id, K.HR_CREATE);
    await this.assertCreateTargetInScope(targetScope, dto.departmentId, dto.campusId);

    const employeeCode = dto.employeeCode?.trim() || (await this.generateEmployeeCode());
    const userId = dto.userId ? await this.assertLinkableUser(dto.userId) : undefined;

    const data: Prisma.EmployeeUncheckedCreateInput = {
      tenantId,
      employeeCode,
      userId,
      employeeType: (dto.employeeType ?? 'FACULTY') as Prisma.EmployeeUncheckedCreateInput['employeeType'],
      honorific: dto.honorific,
      firstName: dto.firstName.trim(),
      middleName: dto.middleName,
      lastName: dto.lastName.trim(),
      gender: dto.gender,
      dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
      personalEmail: dto.personalEmail,
      phone: dto.phone,
      alternatePhone: dto.alternatePhone,
      addressLine1: dto.addressLine1,
      addressLine2: dto.addressLine2,
      city: dto.city,
      state: dto.state,
      postalCode: dto.postalCode,
      country: dto.country ?? 'India',
      departmentId: dto.departmentId,
      designationId: dto.designationId,
      campusId: dto.campusId,
      reportingToId: dto.reportingToId,
      employmentType: (dto.employmentType ?? 'FULL_TIME') as Prisma.EmployeeUncheckedCreateInput['employmentType'],
      employmentStatus: (dto.employmentStatus ?? 'ACTIVE') as Prisma.EmployeeUncheckedCreateInput['employmentStatus'],
      joinDate: dto.joinDate ? new Date(dto.joinDate) : undefined,
      confirmationDate: dto.confirmationDate ? new Date(dto.confirmationDate) : undefined,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactPhone: dto.emergencyContactPhone,
      emergencyContactRelation: dto.emergencyContactRelation,
      panNumber: dto.panNumber,
      aadhaarNumber: dto.aadhaarNumber,
      bankAccountNumber: dto.bankAccountNumber,
      bankName: dto.bankName,
      bankIfsc: dto.bankIfsc,
      uanNumber: dto.uanNumber,
      qualification: dto.qualification,
      specialization: dto.specialization,
      notes: dto.notes,
      createdBy: user.id,
    };

    const employee = await this.tenantPrisma.client.employee
      .create({ data })
      .catch((e) => this.mapP2002(e, 'An employee with this code already exists.'));

    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_CREATED, 'Employee', employee.id, {
      employeeCode: employee.employeeCode,
      employeeType: employee.employeeType,
    });
    return employee;
  }

  async listEmployees(tenantId: string, user: AuthenticatedUser, query: HrDto.QueryEmployeesDto) {
    const { where } = await this.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const clauses: Where[] = [];

    if (!query.includeArchived) clauses.push({ deletedAt: null });
    if (where) clauses.push(where);

    if (query.search) {
      const term = query.search.trim();
      if (term.length > 0) {
        clauses.push({
          OR: [
            { firstName: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { employeeCode: { contains: term, mode: 'insensitive' } },
            { personalEmail: { contains: term, mode: 'insensitive' } },
          ],
        });
      }
    }

    if (query.departmentId) clauses.push({ departmentId: query.departmentId });
    if (query.campusId) clauses.push({ campusId: query.campusId });
    if (query.designationId) clauses.push({ designationId: query.designationId });
    if (query.employeeType) clauses.push({ employeeType: query.employeeType });
    if (query.employmentStatus) clauses.push({ employmentStatus: query.employmentStatus });

    const whereFinal: Where | undefined =
      clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { AND: clauses };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.employee.findMany({
        where: whereFinal ?? undefined,
        orderBy: [{ employmentStatus: 'asc' }, { firstName: 'asc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          department: { select: { id: true, name: true } },
          designation: { select: { id: true, name: true, code: true } },
          campus: { select: { id: true, name: true } },
          user: { select: { id: true, email: true, fullName: true, status: true } },
        },
      }),
      this.tenantPrisma.client.employee.count({ where: whereFinal ?? undefined }),
    ]);

    return { data, total };
  }

  async getEmployee(tenantId: string, user: AuthenticatedUser, id: string) {
    const employee = await this.fetchScopedEmployee(tenantId, user.id, K.HR_VIEW, id);
    const [joinings, exits, documents, workloads, salaryStructures, leaveApplications, reviews] = await Promise.all([
      this.tenantPrisma.client.employeeJoining.findMany({ where: { employeeId: id }, orderBy: { createdAt: 'desc' } }),
      this.tenantPrisma.client.employeeExit.findMany({ where: { employeeId: id }, orderBy: { createdAt: 'desc' } }),
      this.tenantPrisma.client.employeeDocument.findMany({ where: { employeeId: id }, orderBy: { createdAt: 'desc' } }),
      this.tenantPrisma.client.facultyWorkload.findMany({ where: { employeeId: id }, orderBy: { createdAt: 'desc' }, include: { term: { select: { id: true, name: true, code: true } } } }),
      this.tenantPrisma.client.salaryStructure.findMany({ where: { employeeId: id }, orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }] }),
      this.tenantPrisma.client.leaveApplication.findMany({ where: { employeeId: id }, orderBy: { createdAt: 'desc' }, include: { leaveType: { select: { id: true, code: true, name: true } } } }),
      this.tenantPrisma.client.employeePerformanceReview.findMany({ where: { employeeId: id }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { ...employee, joinings, exits, documents, workloads, salaryStructures, leaveApplications, reviews };
  }

  async updateEmployee(tenantId: string, user: AuthenticatedUser, id: string, dto: HrDto.UpdateEmployeeDto) {
    const before = await this.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, id);

    const data: Prisma.EmployeeUncheckedUpdateInput = {};
    if (dto.employeeCode !== undefined) data.employeeCode = dto.employeeCode.trim();
    if (dto.userId !== undefined) data.userId = await this.assertLinkableUser(dto.userId, id);
    if (dto.employeeType !== undefined) data.employeeType = dto.employeeType as Prisma.EmployeeUncheckedUpdateInput['employeeType'];
    if (dto.honorific !== undefined) data.honorific = dto.honorific;
    if (dto.firstName !== undefined) data.firstName = dto.firstName.trim();
    if (dto.middleName !== undefined) data.middleName = dto.middleName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName.trim();
    if (dto.gender !== undefined) data.gender = dto.gender;
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = dto.dateOfBirth ? new Date(dto.dateOfBirth) : null;
    if (dto.personalEmail !== undefined) data.personalEmail = dto.personalEmail;
    if (dto.phone !== undefined) data.phone = dto.phone;
    if (dto.alternatePhone !== undefined) data.alternatePhone = dto.alternatePhone;
    if (dto.addressLine1 !== undefined) data.addressLine1 = dto.addressLine1;
    if (dto.addressLine2 !== undefined) data.addressLine2 = dto.addressLine2;
    if (dto.city !== undefined) data.city = dto.city;
    if (dto.state !== undefined) data.state = dto.state;
    if (dto.postalCode !== undefined) data.postalCode = dto.postalCode;
    if (dto.country !== undefined) data.country = dto.country;
    if (dto.departmentId !== undefined) data.departmentId = dto.departmentId;
    if (dto.designationId !== undefined) data.designationId = dto.designationId;
    if (dto.campusId !== undefined) data.campusId = dto.campusId;
    if (dto.reportingToId !== undefined) data.reportingToId = dto.reportingToId;
    if (dto.employmentType !== undefined) data.employmentType = dto.employmentType as Prisma.EmployeeUncheckedUpdateInput['employmentType'];
    if (dto.employmentStatus !== undefined) data.employmentStatus = dto.employmentStatus as Prisma.EmployeeUncheckedUpdateInput['employmentStatus'];
    if (dto.joinDate !== undefined) data.joinDate = dto.joinDate ? new Date(dto.joinDate) : null;
    if (dto.confirmationDate !== undefined) data.confirmationDate = dto.confirmationDate ? new Date(dto.confirmationDate) : null;
    if (dto.emergencyContactName !== undefined) data.emergencyContactName = dto.emergencyContactName;
    if (dto.emergencyContactPhone !== undefined) data.emergencyContactPhone = dto.emergencyContactPhone;
    if (dto.emergencyContactRelation !== undefined) data.emergencyContactRelation = dto.emergencyContactRelation;
    if (dto.panNumber !== undefined) data.panNumber = dto.panNumber;
    if (dto.aadhaarNumber !== undefined) data.aadhaarNumber = dto.aadhaarNumber;
    if (dto.bankAccountNumber !== undefined) data.bankAccountNumber = dto.bankAccountNumber;
    if (dto.bankName !== undefined) data.bankName = dto.bankName;
    if (dto.bankIfsc !== undefined) data.bankIfsc = dto.bankIfsc;
    if (dto.uanNumber !== undefined) data.uanNumber = dto.uanNumber;
    if (dto.qualification !== undefined) data.qualification = dto.qualification;
    if (dto.specialization !== undefined) data.specialization = dto.specialization;
    if (dto.notes !== undefined) data.notes = dto.notes;
    data.updatedBy = user.id;

    const employee = await this.tenantPrisma.client.employee
      .update({ where: { id }, data })
      .catch((e) => this.mapP2002(e, 'An employee with this code already exists.'));

    const statusChanged = dto.employmentStatus !== undefined && dto.employmentStatus !== before.employmentStatus;
    await this.audited(
      tenantId,
      user.id,
      statusChanged ? AUDIT_ACTIONS.EMPLOYEE_STATUS_CHANGED : AUDIT_ACTIONS.EMPLOYEE_UPDATED,
      'Employee',
      id,
      { ...dto },
      before,
    );
    return employee;
  }

  async archiveEmployee(tenantId: string, user: AuthenticatedUser, id: string) {
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_DELETE, id);
    const employee = await this.tenantPrisma.client.employee.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: user.id },
    });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_ARCHIVED, 'Employee', id, {
      employeeCode: employee.employeeCode,
    });
  }

  async restoreEmployee(tenantId: string, user: AuthenticatedUser, id: string) {
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, id, { includeDeleted: true });
    const employee = await this.tenantPrisma.client.employee.update({
      where: { id },
      data: { deletedAt: null, updatedBy: user.id },
    });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_RESTORED, 'Employee', id, {
      employeeCode: employee.employeeCode,
    });
    return employee;
  }

  async linkUser(tenantId: string, user: AuthenticatedUser, id: string, dto: HrDto.LinkUserDto) {
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, id);
    const userId = await this.assertLinkableUser(dto.userId, id);
    const updated = await this.tenantPrisma.client.employee.update({ where: { id }, data: { userId, updatedBy: user.id } });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_UPDATED, 'Employee', id, { userId });
    return updated;
  }

  /** A new employeeCode must be unique and reasonably collision-proof on retry. */
  private async generateEmployeeCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = `EMP-${randomBytes(3).toString('hex').toUpperCase()}`;
      const exists = await this.tenantPrisma.client.employee.findFirst({ where: { employeeCode: code }, select: { id: true } });
      if (!exists) return code;
    }
    throw new BadRequestException('Could not allocate a unique employee code — retry.');
  }

  /** The linked user must exist (tenant-scoped), be ACTIVE, and not already be an employee. */
  private async assertLinkableUser(userId: string, ignoreEmployeeId?: string): Promise<string> {
    const user = await this.tenantPrisma.client.user.findFirst({ where: { id: userId, status: 'ACTIVE' }, select: { id: true } });
    if (!user) throw new BadRequestException('The target user was not found or is not active.');
    const linked = await this.tenantPrisma.client.employee.count({
      where: { userId, ...(ignoreEmployeeId ? { id: { not: ignoreEmployeeId } } : {}) },
    });
    if (linked > 0) throw new ConflictException('That user is already linked to an employee record.');
    return userId;
  }

  // ── Joining / exit ────────────────────────────────────────────────────────

  async createJoining(tenantId: string, user: AuthenticatedUser, employeeId: string, dto: HrDto.CreateJoiningDto) {
    const employee = await this.fetchScopedEmployee(tenantId, user.id, K.HR_CREATE, employeeId);
    const joining = await this.tenantPrisma.client.employeeJoining.create({
      data: {
        tenantId,
        employeeId,
        joiningStatus: (dto.joiningStatus ?? 'PENDING') as 'PENDING' | 'ONBOARDED' | 'CONFIRMED' | 'CLOSED',
        offerDate: dto.offerDate ? new Date(dto.offerDate) : undefined,
        effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
        probationMonths: dto.probationMonths,
        confirmationDate: dto.confirmationDate ? new Date(dto.confirmationDate) : undefined,
        remarks: dto.remarks,
        createdBy: user.id,
      },
    });

    if (joining.joiningStatus === 'ONBOARDED' && dto.effectiveDate && !employee.joinDate) {
      await this.tenantPrisma.client.employee.update({
        where: { id: employeeId },
        data: { joinDate: new Date(dto.effectiveDate), employmentStatus: 'ACTIVE', updatedBy: user.id },
      });
    }

    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_JOINING_CREATED, 'EmployeeJoining', joining.id, {
      employeeId,
      joiningStatus: joining.joiningStatus,
    });
    return joining;
  }

  async updateJoining(tenantId: string, user: AuthenticatedUser, joiningId: string, dto: HrDto.UpdateJoiningDto) {
    const joining = await this.tenantPrisma.client.employeeJoining.findFirst({ where: { id: joiningId } });
    if (!joining) throw new NotFoundException('Joining record not found.');
    const employee = await this.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, joining.employeeId);

    const updated = await this.tenantPrisma.client.employeeJoining.update({ where: { id: joiningId }, data: { ...dto, updatedBy: user.id, joiningStatus: dto.joiningStatus as 'PENDING' | 'ONBOARDED' | 'CONFIRMED' | 'CLOSED' } });

    if (updated.joiningStatus === 'ONBOARDED' && updated.effectiveDate && !employee.joinDate) {
      await this.tenantPrisma.client.employee.update({
        where: { id: employee.id },
        data: { joinDate: updated.effectiveDate, employmentStatus: 'ACTIVE', updatedBy: user.id },
      });
    }
    if (updated.joiningStatus === 'CONFIRMED' && !employee.confirmationDate) {
      await this.tenantPrisma.client.employee.update({
        where: { id: employee.id },
        data: { confirmationDate: updated.confirmationDate ?? new Date(), updatedBy: user.id },
      });
    }

    const onboardedNow = joining.joiningStatus !== 'ONBOARDED' && updated.joiningStatus === 'ONBOARDED';
    await this.audited(
      tenantId,
      user.id,
      onboardedNow ? AUDIT_ACTIONS.EMPLOYEE_ONBOARDED : AUDIT_ACTIONS.EMPLOYEE_JOINING_UPDATED,
      'EmployeeJoining',
      joiningId,
      { employeeId: joining.employeeId, joiningStatus: updated.joiningStatus },
    );
    return updated;
  }

  async listJoinings(tenantId: string, user: AuthenticatedUser, employeeId: string) {
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_VIEW, employeeId);
    return this.tenantPrisma.client.employeeJoining.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
  }

  async createExit(tenantId: string, user: AuthenticatedUser, employeeId: string, dto: HrDto.CreateExitDto) {
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_CREATE, employeeId);

    const exit = await this.tenantPrisma.client.employeeExit.create({
      data: {
        tenantId,
        employeeId,
        exitType: dto.exitType as 'RESIGNATION' | 'RETIREMENT' | 'TERMINATION' | 'END_OF_CONTRACT' | 'MUTUAL_SEPARATION',
        effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : undefined,
        lastWorkingDate: dto.lastWorkingDate ? new Date(dto.lastWorkingDate) : undefined,
        noticePeriodDays: dto.noticePeriodDays,
        relievingDate: dto.relievingDate ? new Date(dto.relievingDate) : undefined,
        reason: dto.reason,
        noDueStatus: dto.noDueStatus ?? 'PENDING',
        noDueClearedAt: dto.noDueClearedAt ? new Date(dto.noDueClearedAt) : undefined,
        settlementAmount: dto.settlementAmount ?? undefined,
        remarks: dto.remarks,
        createdBy: user.id,
      },
    });

    const status = EXIT_TYPE_TO_STATUS[dto.exitType] ?? 'RESIGNED';
    const exitDate = dto.effectiveDate ?? dto.lastWorkingDate;
    await this.tenantPrisma.client.employee.update({
      where: { id: employeeId },
      data: {
        employmentStatus: status as 'RESIGNED' | 'RETIRED' | 'TERMINATED',
        exitDate: exitDate ? new Date(exitDate) : new Date(),
        updatedBy: user.id,
      },
    });

    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_EXIT_CREATED, 'EmployeeExit', exit.id, {
      employeeId,
      exitType: exit.exitType,
    });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_EXITED, 'Employee', employeeId, { exitType: exit.exitType });
    return exit;
  }

  async updateExit(tenantId: string, user: AuthenticatedUser, exitId: string, dto: HrDto.UpdateExitDto) {
    const exit = await this.tenantPrisma.client.employeeExit.findFirst({ where: { id: exitId } });
    if (!exit) throw new NotFoundException('Exit record not found.');
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, exit.employeeId);

    const updated = await this.tenantPrisma.client.employeeExit.update({
      where: { id: exitId },
      data: { ...dto, updatedBy: user.id, exitType: dto.exitType as 'RESIGNATION' | 'RETIREMENT' | 'TERMINATION' | 'END_OF_CONTRACT' | 'MUTUAL_SEPARATION' },
    });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_EXIT_UPDATED, 'EmployeeExit', exitId, {
      employeeId: exit.employeeId,
      exitType: updated.exitType,
    });
    return updated;
  }

  async listExits(tenantId: string, user: AuthenticatedUser, employeeId: string) {
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_VIEW, employeeId);
    return this.tenantPrisma.client.employeeExit.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
  }

  // ── Employee documents ────────────────────────────────────────────────────

  async requestDocumentUpload(tenantId: string, user: AuthenticatedUser, employeeId: string, dto: HrDto.RequestUploadUrlDto) {
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_CREATE, employeeId);

    const fileKey = this.storage.buildKey(tenantId, 'hr-documents', dto.filename);
    const document = await this.tenantPrisma.client.employeeDocument.create({
      data: {
        tenantId,
        employeeId,
        documentType: dto.documentType as 'APPOINTMENT_LETTER' | 'OFFER_LETTER' | 'ID_PROOF' | 'EDUCATIONAL_CERTIFICATE' | 'EXPERIENCE_LETTER' | 'PAYSLIP' | 'RELIEVING_LETTER' | 'NO_DUE_CERTIFICATE' | 'OTHER',
        title: dto.title ?? dto.filename,
        description: dto.description,
        fileKey,
        contentType: dto.mimeType,
        uploadedByUserId: user.id,
        createdBy: user.id,
      },
    });

    const uploadUrl = await this.storage.getUploadUrl(tenantId, fileKey, dto.mimeType);
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_DOCUMENT_UPLOADED, 'EmployeeDocument', document.id, {
      employeeId,
      documentType: document.documentType,
    });
    return { document, uploadUrl };
  }

  async confirmDocumentUpload(tenantId: string, user: AuthenticatedUser, documentId: string, dto: HrDto.ConfirmUploadDto) {
    await this.employeeDocumentOrThrow(documentId);
    const updated = await this.tenantPrisma.client.employeeDocument.update({ where: { id: documentId }, data: { sizeBytes: dto.sizeBytes } });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_DOCUMENT_UPDATED, 'EmployeeDocument', documentId, { sizeBytes: dto.sizeBytes });
    return updated;
  }

  async verifyDocument(tenantId: string, user: AuthenticatedUser, documentId: string, dto: HrDto.VerifyDocumentDto) {
    await this.employeeDocumentOrThrow(documentId);
    const updated = await this.tenantPrisma.client.employeeDocument.update({
      where: { id: documentId },
      data: { isVerified: dto.verified, verifiedByUserId: dto.verified ? user.id : null, verifiedAt: dto.verified ? new Date() : null },
    });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_DOCUMENT_VERIFIED, 'EmployeeDocument', documentId, {
      isVerified: updated.isVerified,
    });
    return updated;
  }

  async getDocumentDownloadUrl(tenantId: string, user: AuthenticatedUser, documentId: string) {
    const document = await this.employeeDocumentOrThrow(documentId);
    const downloadUrl = await this.storage.getDownloadUrl(tenantId, document.fileKey!, {
      contentType: document.contentType ?? undefined,
      filename: document.title ?? undefined,
    });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.DOCUMENT_DOWNLOADED, 'EmployeeDocument', documentId, {
      documentType: document.documentType,
    });
    return { document, downloadUrl };
  }

  async removeDocument(tenantId: string, user: AuthenticatedUser, documentId: string) {
    const document = await this.employeeDocumentOrThrow(documentId);
    const linked = await this.tenantPrisma.client.payrollRunLine.count({ where: { payslipDocumentId: documentId } });
    if (linked > 0) throw new BadRequestException('This document is linked to a payroll line and cannot be deleted.');
    await this.tenantPrisma.client.employeeDocument.delete({ where: { id: documentId } });
    if (document.fileKey) await this.storage.delete(tenantId, document.fileKey);
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.EMPLOYEE_DOCUMENT_DELETED, 'EmployeeDocument', documentId, {
      documentType: document.documentType,
    });
  }

  async listDocuments(tenantId: string, user: AuthenticatedUser, employeeId: string) {
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_VIEW, employeeId);
    return this.tenantPrisma.client.employeeDocument.findMany({ where: { employeeId }, orderBy: { createdAt: 'desc' } });
  }

  private async employeeDocumentOrThrow(id: string) {
    const document = await this.tenantPrisma.client.employeeDocument.findFirst({ where: { id } });
    if (!document) throw new NotFoundException('Document not found.');
    return document;
  }

  // ── Faculty workload ──────────────────────────────────────────────────────

  async createWorkload(tenantId: string, user: AuthenticatedUser, dto: HrDto.CreateWorkloadDto) {
    const employee = await this.fetchScopedEmployee(tenantId, user.id, K.HR_CREATE, dto.employeeId);
    const workload = await this.tenantPrisma.client.facultyWorkload.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        termId: dto.termId,
        workloadType: dto.workloadType as 'TEACHING' | 'ADMINISTRATIVE' | 'RESEARCH' | 'EXAM_DUTY' | 'EXTENSION' | 'OTHER',
        title: dto.title,
        description: dto.description,
        hoursPerWeek: dto.hoursPerWeek ?? 0,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        isActive: dto.isActive ?? true,
        createdBy: user.id,
      },
      include: { term: { select: { id: true, name: true, code: true } } },
    });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.FACULTY_WORKLOAD_CREATED, 'FacultyWorkload', workload.id, {
      employeeId: employee.id,
      workloadType: workload.workloadType,
    });
    return workload;
  }

  async listWorkloads(tenantId: string, user: AuthenticatedUser, query: HrDto.QueryWorkloadsDto) {
    const { where } = await this.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const clauses: Where[] = [];
    if (where) clauses.push({ employee: where });
    if (query.employeeId) clauses.push({ employeeId: query.employeeId });
    if (query.termId) clauses.push({ termId: query.termId });
    if (query.workloadType) clauses.push({ workloadType: query.workloadType });

    const whereFinal: Where | undefined = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { AND: clauses };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.facultyWorkload.findMany({
        where: whereFinal ?? undefined,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          term: { select: { id: true, name: true, code: true } },
          employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
        },
      }),
      this.tenantPrisma.client.facultyWorkload.count({ where: whereFinal ?? undefined }),
    ]);
    return { data, total };
  }

  async updateWorkload(tenantId: string, user: AuthenticatedUser, workloadId: string, dto: HrDto.UpdateWorkloadDto) {
    const workload = await this.tenantPrisma.client.facultyWorkload.findFirst({ where: { id: workloadId } });
    if (!workload) throw new NotFoundException('Workload record not found.');
    if (dto.employeeId && dto.employeeId !== workload.employeeId) {
      await this.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, dto.employeeId);
    } else {
      await this.fetchScopedEmployee(tenantId, user.id, K.HR_UPDATE, workload.employeeId);
    }

    const data: Prisma.FacultyWorkloadUncheckedUpdateInput = { updatedBy: user.id };
    if (dto.employeeId !== undefined) data.employeeId = dto.employeeId;
    if (dto.termId !== undefined) data.termId = dto.termId;
    if (dto.workloadType !== undefined) data.workloadType = dto.workloadType as Prisma.FacultyWorkloadUncheckedUpdateInput['workloadType'];
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.hoursPerWeek !== undefined) data.hoursPerWeek = dto.hoursPerWeek;
    if (dto.effectiveFrom !== undefined) data.effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : null;
    if (dto.effectiveTo !== undefined) data.effectiveTo = dto.effectiveTo ? new Date(dto.effectiveTo) : null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    const updated = await this.tenantPrisma.client.facultyWorkload.update({ where: { id: workloadId }, data });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.FACULTY_WORKLOAD_UPDATED, 'FacultyWorkload', workloadId, { ...dto });
    return updated;
  }

  async deleteWorkload(tenantId: string, user: AuthenticatedUser, workloadId: string) {
    const workload = await this.tenantPrisma.client.facultyWorkload.findFirst({ where: { id: workloadId } });
    if (!workload) throw new NotFoundException('Workload record not found.');
    await this.fetchScopedEmployee(tenantId, user.id, K.HR_DELETE, workload.employeeId);
    await this.tenantPrisma.client.facultyWorkload.delete({ where: { id: workloadId } });
    await this.audited(tenantId, user.id, AUDIT_ACTIONS.FACULTY_WORKLOAD_DELETED, 'FacultyWorkload', workloadId, {
      employeeId: workload.employeeId,
    });
  }

  // ── Faculty timetable / attendance (reuses attendance + timetable tables) ──

  async getEmployeeTimetable(tenantId: string, user: AuthenticatedUser, employeeId: string) {
    const employee = await this.fetchScopedEmployee(tenantId, user.id, K.HR_VIEW, employeeId);
    if (!employee.userId) return [];
    return this.tenantPrisma.client.timetableEntry.findMany({
      where: { assignedUserId: employee.userId },
      orderBy: [{ dayOfWeek: 'asc' }],
      include: {
        period: { select: { id: true, sequence: true, startTime: true, endTime: true, isBreak: true } },
        courseOffering: { include: { course: true } },
        section: { include: { program: { include: { department: true } } } },
        timetable: true,
        room: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async getEmployeeAttendance(tenantId: string, user: AuthenticatedUser, employeeId: string, take = 100) {
    const employee = await this.fetchScopedEmployee(tenantId, user.id, K.HR_VIEW, employeeId);
    if (!employee.userId) return [];
    const rows = await this.tenantPrisma.client.facultyAttendance.findMany({
      where: { userId: employee.userId },
      orderBy: { date: 'desc' },
      take,
    });
    return rows;
  }

  // ── HR overview (insight) ─────────────────────────────────────────────────

  async overview(tenantId: string, user: AuthenticatedUser) {
    const { where } = await this.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const scopedEmployee: Where | undefined = where ? { employee: where } : undefined;

    const [headcount, byDepartment, byStatus, pendingLeaves, activeWorkload, payrollLineAgg] = await Promise.all([
      this.tenantPrisma.client.employee.count({ where: { deletedAt: null, ...(where ?? {}) } }),
      this.tenantPrisma.client.employee.groupBy({
        by: ['departmentId'],
        where: { deletedAt: null, ...(where ?? {}) },
        _count: { _all: true },
      }),
      this.tenantPrisma.client.employee.groupBy({
        by: ['employmentStatus'],
        where: { deletedAt: null, ...(where ?? {}) },
        _count: { _all: true },
      }),
      this.tenantPrisma.client.leaveApplication.count({
        where: { status: 'PENDING', ...(scopedEmployee ?? {}) },
      }),
      this.tenantPrisma.client.facultyWorkload.aggregate({
        where: { isActive: true, ...(scopedEmployee ?? {}) },
        _sum: { hoursPerWeek: true },
      }),
      this.tenantPrisma.client.payrollRunLine.aggregate({
        where: { status: 'PAID', ...(scopedEmployee ?? {}) },
        _count: { _all: true },
        _sum: { netAmount: true, grossAmount: true },
      }),
    ]);

    const departmentMap = new Map<string, string>();
    const depts = await this.tenantPrisma.client.department.findMany({
      where: { id: { in: byDepartment.map((d) => d.departmentId) } },
      select: { id: true, name: true },
    });
    for (const d of depts) departmentMap.set(d.id, d.name);

    await this.audited(tenantId, user.id, AUDIT_ACTIONS.HR_REPORT_VIEWED, 'HrOverview', 'overview');

    return {
      headcount,
      byDepartment: byDepartment.map((d) => ({ departmentId: d.departmentId, departmentName: departmentMap.get(d.departmentId) ?? null, count: d._count._all })),
      byStatus,
      pendingLeaves,
      activeWorkloadHoursPerWeek: activeWorkload._sum.hoursPerWeek ?? 0,
      payroll: {
        paidLines: payrollLineAgg._count._all,
        paidNetTotal: payrollLineAgg._sum.netAmount ?? 0,
        paidGrossTotal: payrollLineAgg._sum.grossAmount ?? 0,
      },
    };
  }
}