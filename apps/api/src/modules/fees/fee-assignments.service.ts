/**
 * StudentFeeAssignment — binding a structure to a student and, on creation, issuing its demands.
 *
 * Issuance materializes the structure's installment plan into StudentFee rows grouped under one
 * FeeDemand per installment, inside a single transaction: demand numbers come from the atomic
 * FeeSequence allocator, each line snapshots head code/name + the producing structure's line id,
 * and amounts are integer minor units split exactly across installments (see fee-splitting).
 * Existing historical demands are never touched by later edits — assignment is effectively
 * append-only issuance.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FeeSequenceKind, type PrismaClient } from '@college-erp/database';
import { AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { StudentsService } from '../students/students.service';
import { nextFeeSeriesNumber } from './fee-sequences';
import { buildInstallmentPlan } from './fee-splitting';
import { DEMAND_PREFIX_DEFAULT, FEE_EVENTS } from './fees.constants';
import { CreateFeeAssignmentDto, ListFeeAssignmentQueryDto } from './fees.dto';

type Client = PrismaClient;

const ASSIGNMENT_INCLUDE = {
  student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true, program: true, section: true } },
  structure: { include: { lines: { include: { head: true }, orderBy: { sortOrder: 'asc' as const } }, term: true } },
  term: true,
  demands: { orderBy: { installmentIndex: 'asc' as const } },
};

@Injectable()
export class FeeAssignmentsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  async list(tenantId: string, query: ListFeeAssignmentQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.studentId) where.studentId = query.studentId;
    if (query.structureId) where.structureId = query.structureId;

    const [rows, total] = await Promise.all([
      this.client.studentFeeAssignment.findMany({
        where,
        include: ASSIGNMENT_INCLUDE,
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.client.studentFeeAssignment.count({ where }),
    ]);
    return { data: rows, total };
  }

  async get(tenantId: string, id: string) {
    const row = await this.client.studentFeeAssignment.findFirst({
      where: { id, tenantId },
      include: ASSIGNMENT_INCLUDE,
    });
    if (!row) throw new NotFoundException('Fee assignment not found.');
    return row;
  }

  async create(tenantId: string, userId: string, dto: CreateFeeAssignmentDto) {
    const structure = await this.client.feeStructure.findFirst({
      where: { id: dto.structureId, tenantId, deletedAt: null },
      include: { lines: { include: { head: true }, orderBy: { sortOrder: 'asc' } } },
    });
    if (!structure) throw new NotFoundException('Fee structure not found.');
    if (structure.status !== 'ACTIVE') throw new BadRequestException('Only ACTIVE structures can be assigned.');
    if (!structure.lines.length) throw new BadRequestException('Structure has no lines to bill.');

    await this.studentsService.assertStudentInScope(dto.studentId, tenantId, userId);

    const dup = await this.client.studentFeeAssignment.findFirst({
      where: { tenantId, studentId: dto.studentId, structureId: dto.structureId, termId: dto.termId ?? null },
    });
    if (dup) throw new BadRequestException('This structure is already assigned to the student for the given term.');

    return this.tenantPrisma.client.$transaction(async (tx) => {
      const assignment = await tx.studentFeeAssignment.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          structureId: dto.structureId,
          termId: dto.termId ?? null,
          effectiveDate: dto.effectiveDate ? new Date(dto.effectiveDate) : new Date(),
          notes: dto.notes ?? null,
          assignedBy: userId,
        },
      });

      const demands = await this.issueDemands(tx, tenantId, userId, assignment, structure);

      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.ASSIGNMENT_CREATED, module: AUDIT_MODULES.FEES,
        entityType: 'StudentFeeAssignment', entityId: assignment.id,
        after: { studentId: assignment.studentId, structureId: assignment.structureId, demandCount: demands.length },
      });

      const fresh = await tx.studentFeeAssignment.findUnique({
        where: { id: assignment.id },
        include: { demands: { orderBy: { installmentIndex: 'asc' } }, student: { select: { fullName: true, admissionNumber: true } } },
      });
      return fresh;
    });
  }

  /** Builds + persists the installment demands. Pure plan math lives in fee-splitting. */
  private async issueDemands(
    tx: any,
    tenantId: string,
    userId: string,
    assignment: { id: string; studentId: string; termId: string | null; effectiveDate: Date },
    structure: any,
  ) {
    const anchor = assignment.termId
      ? (await tx.term.findUnique({ where: { id: assignment.termId } }))?.startDate ?? assignment.effectiveDate
      : assignment.effectiveDate;

    const plan = buildInstallmentPlan(
      structure.lines.map((l: any) => ({ id: l.id, headCode: l.head.code, headName: l.head.name, amountCents: l.amountCents })),
      structure.installmentCount,
      anchor,
      structure.dueDayOffset,
      structure.installmentGapDays,
    );

    const demands: { id: string; demandNumber: string; totalCents: number }[] = [];

    for (const installment of plan) {
      const demandNumber = await nextFeeSeriesNumber(tx, tenantId, FeeSequenceKind.DEMAND, DEMAND_PREFIX_DEFAULT);
      const demand = await tx.feeDemand.create({
        data: {
          tenantId,
          assignmentId: assignment.id,
          studentId: assignment.studentId,
          termId: assignment.termId,
          demandNumber,
          installmentIndex: installment.index,
          issueDate: new Date(),
          dueDate: installment.dueDate,
          status: 'ISSUED',
          totalCents: installment.totalCents,
          paidCents: 0,
          waivedCents: 0,
          lateFeeCents: 0,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      demands.push({ id: demand.id, demandNumber, totalCents: installment.totalCents });

      for (const line of installment.lines) {
        await tx.studentFee.create({
          data: {
            tenantId,
            studentId: assignment.studentId,
            termId: assignment.termId,
            structureId: structure.id,
            structureLineId: line.sourceId,
            demandId: demand.id,
            installmentIndex: installment.index,
            headCode: line.headCode,
            headName: line.headName,
            amountCents: line.installmentAmountCents,
            dueDate: installment.dueDate,
            status: 'ISSUED',
            createdBy: userId,
            updatedBy: userId,
            remarks: `Generated from structure '${structure.name}'`,
          },
        });
      }

      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.DEMAND_ISSUED, module: AUDIT_MODULES.FEES,
        entityType: 'FeeDemand', entityId: demand.id,
        after: { number: demandNumber, installment: installment.index, totalCents: installment.totalCents, dueDate: installment.dueDate },
      });
    }

    return demands;
  }

  async revoke(tenantId: string, userId: string, id: string) {
    const existing = await this.client.studentFeeAssignment.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Fee assignment not found.');
    if (existing.status === 'REVOKED') return existing;

    const row = await this.client.studentFeeAssignment.update({
      where: { id },
      data: { status: 'REVOKED' },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.ASSIGNMENT_REVOKED, module: AUDIT_MODULES.FEES,
      entityType: 'StudentFeeAssignment', entityId: id,
      before: { status: existing.status }, after: { status: 'REVOKED' },
    });
    return row;
  }
}