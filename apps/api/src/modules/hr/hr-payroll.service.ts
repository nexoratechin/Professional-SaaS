/**
 * HR payroll service — salary structures, monthly payroll runs, run lines, and payslips.
 *
 * The payroll run lifecycle is tenant-wide admin work: DRAFT → PROCESSED (lines materialized from
 * the salary structures active for that month) → APPROVED → PAID (or CANCELLED from any
 * pre-APPROVED state), with each step audited and gated behind a GLOBAL hr.manage grant. Payslips
 * are stored as PAYSLIP-type EmployeeDocument rows and linked from the run line, so they flow
 * through the existing signed-URL document pipeline. Faculty self-service reads their own PAID
 * lines via the /hr/payslips/mine route (OWN-scoped hr.view).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import { Prisma } from '@college-erp/database';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../../common/storage/storage.service';
import { HrService } from './hr.service';
import * as HrDto from './dto/hr.dto';

type Where = Record<string, unknown>;

interface EarningsHead {
  head: string;
  amount: number;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const round2 = (n: number) => Math.round(n * 100) / 100;

type SalaryStructureLike = {
  basicAmount: unknown;
  hraAmount: unknown;
  allowances: unknown;
  deductions: unknown;
};

@Injectable()
export class HrPayrollService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly storage: StorageService,
    private readonly hr: HrService,
  ) {}

  // ── Salary structures ─────────────────────────────────────────────────────

  async createSalaryStructure(tenantId: string, user: AuthenticatedUser, dto: HrDto.CreateSalaryStructureDto) {
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_MANAGE, dto.employeeId);
    const { basicAmount, hraAmount, grossAmount, netAmount } = this.financials({
      basicAmount: dto.basicAmount,
      hraAmount: dto.hraAmount,
      allowances: dto.allowances,
      deductions: dto.deductions,
      grossAmount: dto.grossAmount,
      netAmount: dto.netAmount,
    });

    const structure = await this.tenantPrisma.client.salaryStructure.create({
      data: {
        tenantId,
        employeeId: dto.employeeId,
        effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : undefined,
        effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : undefined,
        basicAmount,
        hraAmount,
        allowances: (dto.allowances ?? undefined) as unknown as Prisma.InputJsonValue,
        deductions: (dto.deductions ?? undefined) as unknown as Prisma.InputJsonValue,
        grossAmount,
        netAmount,
        isActive: dto.isActive ?? true,
        createdBy: user.id,
      },
    });

    await this.audit(tenantId, user.id, AUDIT_ACTIONS.SALARY_STRUCTURE_CREATED, 'SalaryStructure', structure.id, {
      employeeId: dto.employeeId,
      grossAmount,
      netAmount,
    });
    return structure;
  }

  async updateSalaryStructure(tenantId: string, user: AuthenticatedUser, id: string, dto: HrDto.UpdateSalaryStructureDto) {
    const structure = await this.salaryStructureOrThrow(id);
    await this.hr.fetchScopedEmployee(tenantId, user.id, K.HR_MANAGE, structure.employeeId);

    const { basicAmount, hraAmount, grossAmount, netAmount } = this.financials({
      basicAmount: dto.basicAmount ?? Number(structure.basicAmount),
      hraAmount: dto.hraAmount ?? Number(structure.hraAmount),
      allowances: dto.allowances ?? structure.allowances,
      deductions: dto.deductions ?? structure.deductions,
      grossAmount: dto.grossAmount,
      netAmount: dto.netAmount,
    });

    const updated = await this.tenantPrisma.client.salaryStructure.update({
      where: { id },
      data: {
        ...(dto.effectiveFrom !== undefined ? { effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null } : {}),
        ...(dto.effectiveTo !== undefined ? { effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null } : {}),
        ...(dto.allowances !== undefined ? { allowances: dto.allowances as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.deductions !== undefined ? { deductions: dto.deductions as unknown as Prisma.InputJsonValue } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        basicAmount,
        hraAmount,
        grossAmount,
        netAmount,
        updatedBy: user.id,
      },
    });

    await this.audit(tenantId, user.id, AUDIT_ACTIONS.SALARY_STRUCTURE_UPDATED, 'SalaryStructure', id, {
      employeeId: structure.employeeId,
      grossAmount,
      netAmount,
    });
    return updated;
  }

  async listSalaryStructures(tenantId: string, user: AuthenticatedUser, query: HrDto.QuerySalaryStructuresDto) {
    const { where } = await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const clauses: Where[] = [];
    if (where) clauses.push({ employee: where });
    if (query.employeeId) clauses.push({ employeeId: query.employeeId });
    if (!query.includeInactive) clauses.push({ isActive: true });

    const whereFinal: Where | undefined = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { AND: clauses };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.salaryStructure.findMany({
        where: whereFinal ?? undefined,
        orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: { employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } } },
      }),
      this.tenantPrisma.client.salaryStructure.count({ where: whereFinal ?? undefined }),
    ]);
    return { data, total };
  }

  /** Computes gross/net from the earnings components unless the caller overrode them. */
  private financials(input: {
    basicAmount?: number;
    hraAmount?: number;
    allowances?: unknown;
    deductions?: unknown;
    grossAmount?: number;
    netAmount?: number;
  }): { basicAmount: number; hraAmount: number; grossAmount: number; netAmount: number } {
    const basicAmount = round2(input.basicAmount ?? 0);
    const hraAmount = round2(input.hraAmount ?? 0);
    const sumHeads = (heads: unknown): number => {
      const list = Array.isArray(heads) ? heads : [];
      return list.reduce<number>((sum, h) => {
        const amount = (h as { amount?: unknown }).amount;
        return sum + (typeof amount === 'number' ? amount : Number(amount ?? 0) || 0);
      }, 0);
    };

    const grossAmount = round2(input.grossAmount ?? basicAmount + hraAmount + sumHeads(input.allowances));
    const netAmount = round2(input.netAmount ?? grossAmount - sumHeads(input.deductions));
    return { basicAmount, hraAmount, grossAmount, netAmount };
  }

  private async salaryStructureOrThrow(id: string) {
    const structure = await this.tenantPrisma.client.salaryStructure.findFirst({ where: { id } });
    if (!structure) throw new NotFoundException('Salary structure not found.');
    return structure;
  }

  // ── Payroll runs ──────────────────────────────────────────────────────────

  async createPayrollRun(tenantId: string, user: AuthenticatedUser, dto: HrDto.CreatePayrollRunDto) {
    const existing = await this.tenantPrisma.client.payrollRun.findUnique({
      where: { tenantId_month_year: { tenantId, month: dto.month, year: dto.year } },
    });
    if (existing) throw new BadRequestException(`A payroll run for ${MONTH_NAMES[dto.month - 1]} ${dto.year} already exists.`);

    const run = await this.tenantPrisma.client.payrollRun.create({
      data: {
        tenantId,
        month: dto.month,
        year: dto.year,
        title: dto.title ?? `Payroll ${MONTH_NAMES[dto.month - 1]} ${dto.year}`,
        notes: dto.notes,
        createdBy: user.id,
      },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PAYROLL_RUN_CREATED, 'PayrollRun', run.id, { month: run.month, year: run.year });
    return run;
  }

  async listPayrollRuns(tenantId: string, user: AuthenticatedUser, query: HrDto.QueryPayrollRunsDto) {
    const { where } = await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const clauses: Where[] = [];
    if (where) clauses.push({ lines: { some: { employee: where } } });
    if (query.month) clauses.push({ month: query.month });
    if (query.year) clauses.push({ year: query.year });
    if (query.status) clauses.push({ status: query.status });

    const whereFinal: Where | undefined = clauses.length === 0 ? undefined : clauses.length === 1 ? clauses[0] : { AND: clauses };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.payrollRun.findMany({
        where: whereFinal ?? undefined,
        orderBy: [{ year: 'desc' }, { month: 'desc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        include: {
          _count: { select: { lines: true } },
          lines: { select: { id: true, employeeId: true, grossAmount: true, netAmount: true, status: true }, take: 2 },
        },
      }),
      this.tenantPrisma.client.payrollRun.count({ where: whereFinal ?? undefined }),
    ]);
    return { data, total };
  }

  async getPayrollRun(tenantId: string, user: AuthenticatedUser, runId: string) {
    const { where } = await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_VIEW);
    const run = await this.tenantPrisma.client.payrollRun.findFirst({
      where: {
        id: runId,
        ...(where ? { lines: { some: { employee: where } } } : {}),
      },
      include: {
        lines: {
          orderBy: { createdAt: 'asc' },
          include: {
            employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
            salaryStructure: true,
            payslipDocument: true,
          },
        },
        processedByUser: { select: { id: true, fullName: true, email: true } },
        approvedByUser: { select: { id: true, fullName: true, email: true } },
      },
    });
    if (!run) throw new NotFoundException('Payroll run not found.');
    return run;
  }

  async processPayrollRun(tenantId: string, user: AuthenticatedUser, runId: string) {
    const run = await this.payrollRunOrThrow(runId);
    this.hr.assertGlobal((await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_MANAGE)).grants);

    if (run.status !== 'DRAFT' && run.status !== 'PROCESSING') {
      throw new BadRequestException(`Cannot process a ${run.status} payroll run.`);
    }

    const runStart = new Date(Date.UTC(run.year, run.month - 1, 1));
    const runEnd = new Date(Date.UTC(run.year, run.month, 0));

    const structures = await this.tenantPrisma.client.salaryStructure.findMany({
      where: {
        isActive: true,
        OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: runEnd } }],
        AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: runStart } }] }],
        employee: { deletedAt: null, employmentStatus: { in: ['ACTIVE', 'ON_LEAVE'] } },
      },
      include: { employee: { select: { id: true } } },
    });

    for (const structure of structures) {
      const { grossAmount, netAmount } = this.structureFinancials(structure);
      const earnings: EarningsHead[] = [
        { head: 'BASIC', amount: round2(Number(structure.basicAmount)) },
        { head: 'HRA', amount: round2(Number(structure.hraAmount)) },
        ...((structure.allowances as Array<Record<string, unknown>> | null | undefined) ?? []).map((a) => ({
          head: String((a as { head?: unknown }).head ?? 'ALLOWANCE'),
          amount: round2(Number((a as { amount?: unknown }).amount ?? 0)),
        })),
      ];
      const deductions: EarningsHead[] = ((structure.deductions as Array<Record<string, unknown>> | null | undefined) ?? []).map((d) => ({
        head: String((d as { head?: unknown }).head ?? 'DEDUCTION'),
        amount: round2(Number((d as { amount?: unknown }).amount ?? 0)),
      }));

      const existing = await this.tenantPrisma.client.payrollRunLine.findFirst({
        where: { runId: run.id, employeeId: structure.employeeId },
      });

      const fields = {
        salaryStructureId: structure.id,
        grossAmount,
        totalDeductions: round2(deductions.reduce((s, d) => s + d.amount, 0)),
        netAmount,
        earnings: earnings as unknown as Prisma.InputJsonValue,
        deductions: deductions as unknown as Prisma.InputJsonValue,
        status: 'PROCESSED' as const,
      };

      if (existing) {
        await this.tenantPrisma.client.payrollRunLine.update({ where: { id: existing.id }, data: fields });
      } else {
        await this.tenantPrisma.client.payrollRunLine.create({
          data: { ...fields, tenantId, runId: run.id, employeeId: structure.employeeId },
        });
      }
    }

    const processed = await this.tenantPrisma.client.payrollRun.update({
      where: { id: runId },
      data: { status: 'PROCESSED', processedByUserId: user.id, processedAt: new Date(), updatedBy: user.id },
    });
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PAYROLL_RUN_PROCESSED, 'PayrollRun', runId, { month: run.month, year: run.year, lines: structures.length });
    return processed;
  }

  async approvePayrollRun(tenantId: string, user: AuthenticatedUser, runId: string) {
    const run = await this.payrollRunOrThrow(runId);
    this.hr.assertGlobal((await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_MANAGE)).grants);
    if (run.status !== 'PROCESSED') throw new BadRequestException(`Cannot approve a ${run.status} payroll run.`);

    const approved = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.payrollRunLine.updateMany({
        where: { runId },
        data: { status: 'APPROVED', updatedAt: new Date() },
      }),
      this.tenantPrisma.client.payrollRun.update({
        where: { id: runId },
        data: { status: 'APPROVED', approvedByUserId: user.id, approvedAt: new Date(), updatedBy: user.id },
      }),
    ]);
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PAYROLL_RUN_APPROVED, 'PayrollRun', runId, { month: run.month, year: run.year });
    return approved[1];
  }

  async payPayrollRun(tenantId: string, user: AuthenticatedUser, runId: string, dto: HrDto.PayPayrollRunDto) {
    const run = await this.payrollRunOrThrow(runId);
    this.hr.assertGlobal((await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_MANAGE)).grants);
    if (run.status !== 'APPROVED') throw new BadRequestException(`Cannot pay a ${run.status} payroll run.`);

    const paid = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.payrollRunLine.updateMany({
        where: { runId },
        data: { status: 'PAID', paidAt: new Date(), ...(dto.referenceNumber ? { referenceNumber: dto.referenceNumber } : {}), updatedAt: new Date() },
      }),
      this.tenantPrisma.client.payrollRun.update({
        where: { id: runId },
        data: { status: 'PAID', updatedBy: user.id, notes: dto.referenceNumber ?? run.notes },
      }),
    ]);
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PAYROLL_RUN_PAID, 'PayrollRun', runId, { month: run.month, year: run.year, referenceNumber: dto.referenceNumber });
    return paid[1];
  }

  async cancelPayrollRun(tenantId: string, user: AuthenticatedUser, runId: string) {
    const run = await this.payrollRunOrThrow(runId);
    this.hr.assertGlobal((await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_MANAGE)).grants);
    if (run.status === 'APPROVED' || run.status === 'PAID') {
      throw new BadRequestException(`Cannot cancel a ${run.status} payroll run.`);
    }

    const cancelled = await this.tenantPrisma.client.$transaction([
      this.tenantPrisma.client.payrollRunLine.updateMany({ where: { runId }, data: { status: 'CANCELLED', updatedAt: new Date() } }),
      this.tenantPrisma.client.payrollRun.update({ where: { id: runId }, data: { status: 'CANCELLED', updatedBy: user.id } }),
    ]);
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PAYROLL_RUN_CANCELLED, 'PayrollRun', runId, { month: run.month, year: run.year });
    return cancelled[1];
  }

  /** Payslip flow — creates a PAYSLIP EmployeeDocument (with signed upload URL) and links it to
   * the line. The upload itself is confirmed through the shared document-confirm endpoint. */
  async linkPayslip(tenantId: string, user: AuthenticatedUser, lineId: string, dto: HrDto.LinkPayslipDto) {
    const line = await this.tenantPrisma.client.payrollRunLine.findFirst({
      where: { id: lineId },
      include: { run: true, employee: { select: { id: true, firstName: true, lastName: true } } },
    });
    if (!line) throw new NotFoundException('Payroll line not found.');
    this.hr.assertGlobal((await this.hr.resolveEmployeeScope(tenantId, user.id, K.HR_MANAGE)).grants);
    if (line.run.status === 'CANCELLED') throw new BadRequestException('Cannot attach a payslip to a cancelled run.');

    const fileKey = this.storage.buildKey(tenantId, 'hr-payslips', dto.filename);
    const document = await this.tenantPrisma.client.employeeDocument.create({
      data: {
        tenantId,
        employeeId: line.employeeId,
        documentType: 'PAYSLIP',
        title: dto.title ?? `Payslip ${MONTH_NAMES[line.run.month - 1]} ${line.run.year} — ${line.employee.firstName} ${line.employee.lastName}`,
        fileKey,
        contentType: dto.mimeType,
        uploadedByUserId: user.id,
        createdBy: user.id,
      },
    });

    await this.tenantPrisma.client.payrollRunLine.update({
      where: { id: lineId },
      data: { payslipDocumentId: document.id },
    });

    const uploadUrl = await this.storage.getUploadUrl(tenantId, fileKey, dto.mimeType);
    await this.audit(tenantId, user.id, AUDIT_ACTIONS.PAYSLIP_LINKED, 'PayrollRunLine', lineId, {
      employeeId: line.employeeId,
      documentId: document.id,
      run: `${MONTH_NAMES[line.run.month - 1]} ${line.run.year}`,
    });
    return { document, uploadUrl };
  }

  /** Self-service: a faculty member's OWN paid payroll lines with their linked payslips. */
  async myPayslips(tenantId: string, user: AuthenticatedUser) {
    const employee = await this.tenantPrisma.client.employee.findFirst({
      where: { userId: user.id, deletedAt: null },
      select: { id: true },
    });
    if (!employee) return { data: [], total: 0 };

    const [data, total] = await Promise.all([
      this.tenantPrisma.client.payrollRunLine.findMany({
        where: { employeeId: employee.id, status: 'PAID', payslipDocument: { isNot: null } },
        orderBy: [{ run: { year: 'desc' } }, { run: { month: 'desc' } }],
        include: {
          run: { select: { id: true, month: true, year: true, title: true, status: true } },
          payslipDocument: true,
        },
      }),
      this.tenantPrisma.client.payrollRunLine.count({
        where: { employeeId: employee.id, status: 'PAID' },
      }),
    ]);
    return { data, total };
  }

  private async payrollRunOrThrow(id: string) {
    const run = await this.tenantPrisma.client.payrollRun.findFirst({ where: { id } });
    if (!run) throw new NotFoundException('Payroll run not found.');
    return run;
  }

  private structureFinancials(structure: SalaryStructureLike): { grossAmount: number; netAmount: number } {
    const allowances = ((structure.allowances as Array<Record<string, unknown>> | null | undefined) ?? []).reduce(
      (s, a) => s + Number((a as { amount?: unknown }).amount ?? 0),
      0,
    );
    const deductions = ((structure.deductions as Array<Record<string, unknown>> | null | undefined) ?? []).reduce(
      (s, d) => s + Number((d as { amount?: unknown }).amount ?? 0),
      0,
    );
    const gross = round2(Number(structure.basicAmount) + Number(structure.hraAmount) + allowances);
    return { grossAmount: gross, netAmount: round2(gross - deductions) };
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