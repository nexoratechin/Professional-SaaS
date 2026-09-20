/**
 * Fee structures — fee templates with lines + installment/late-fee rules. Structures are DRAFT
 * before they carry an ACTIVE flag; only ACTIVE structures can be assigned to students. Updates
 * replace the line set transactionally (delete + recreate) — existing generated StudentFee rows
 * keep their snapshots so past demands are never mutated by later edits.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@college-erp/database';
import { AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { buildInstallmentPlan } from './fee-splitting';
import { FEE_EVENTS } from './fees.constants';
import {
  CreateFeeStructureDto,
  ListFeeStructureQueryDto,
  PreviewStructureDto,
  UpdateFeeStructureDto,
} from './fees.dto';

type Client = PrismaClient;

const STRUCTURE_INCLUDE = {
  lines: {
    include: { head: true },
    orderBy: { sortOrder: 'asc' as const },
  },
  academicYear: true,
  term: true,
  program: true,
  section: true,
};

@Injectable()
export class FeeStructuresService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  async list(tenantId: string, query: ListFeeStructureQueryDto) {
    const where: Record<string, unknown> = { tenantId, deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.academicYearId) where.academicYearId = query.academicYearId;
    if (query.programId) where.programId = query.programId;
    if (query.sectionId) where.sectionId = query.sectionId;

    const [rows, total] = await Promise.all([
      this.client.feeStructure.findMany({
        where,
        include: { lines: { select: { id: true, amountCents: true, headId: true, isRequired: true } } },
        orderBy: [{ createdAt: 'desc' }],
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.client.feeStructure.count({ where }),
    ]);
    return { data: rows, total };
  }

  async get(tenantId: string, id: string) {
    const row = await this.client.feeStructure.findFirst({
      where: { id, tenantId, deletedAt: null },
      include: STRUCTURE_INCLUDE,
    });
    if (!row) throw new NotFoundException('Fee structure not found.');
    return row;
  }

  private async assertHeads(tenantId: string, lines: { headId: string }[]) {
    if (!lines.length) return;
    const headIds = [...new Set(lines.map((l) => l.headId))];
    const heads = await this.client.feeHead.findMany({
      where: { tenantId, id: { in: headIds }, deletedAt: null },
      select: { id: true },
    });
    if (heads.length !== headIds.length) {
      throw new BadRequestException('One or more line headIds do not belong to this tenant or are archived.');
    }
  }

  async create(tenantId: string, userId: string, dto: CreateFeeStructureDto) {
    const lines = dto.lines ?? [];
    await this.assertHeads(tenantId, lines);

    return this.tenantPrisma.client.$transaction(async (tx) => {
      const structure = await tx.feeStructure.create({
        data: {
          tenantId,
          name: dto.name,
          status: 'DRAFT',
          academicYearId: dto.academicYearId ?? null,
          termId: dto.termId ?? null,
          programId: dto.programId ?? null,
          sectionId: dto.sectionId ?? null,
          installmentCount: dto.installmentCount ?? 1,
          dueDayOffset: dto.dueDayOffset ?? 30,
          installmentGapDays: dto.installmentGapDays ?? 0,
          lateFeePercentBps: dto.lateFeePercentBps ?? 0,
          lateFeeFlatCents: dto.lateFeeFlatCents ?? 0,
          lateFeeGraceDays: dto.lateFeeGraceDays ?? 0,
          description: dto.description ?? null,
          createdBy: userId,
          updatedBy: userId,
          lines: {
            create: lines.map((l, i) => ({
              tenantId,
              headId: l.headId,
              amountCents: l.amountCents,
              isRequired: l.isRequired ?? true,
              sortOrder: l.sortOrder ?? i,
            })),
          },
        },
        include: STRUCTURE_INCLUDE,
      });

      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.STRUCTURE_CREATED, module: AUDIT_MODULES.FEES,
        entityType: 'FeeStructure', entityId: structure.id,
        after: { name: structure.name, lineCount: structure.lines.length, installmentCount: structure.installmentCount },
      });
      return structure;
    });
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateFeeStructureDto) {
    const existing = await this.get(tenantId, id);
    if (existing.status === 'ARCHIVED') throw new BadRequestException('Archived structures cannot be edited.');

    const lines = dto.lines;
    if (lines) await this.assertHeads(tenantId, lines);

    return this.tenantPrisma.client.$transaction(async (tx) => {
      if (lines) {
        await tx.feeStructureLine.deleteMany({ where: { structureId: id } });
      }
      const structure = await tx.feeStructure.update({
        where: { id },
        data: {
          name: dto.name ?? existing.name,
          academicYearId: dto.academicYearId ?? existing.academicYearId,
          termId: dto.termId ?? existing.termId,
          programId: dto.programId ?? existing.programId,
          sectionId: dto.sectionId ?? existing.sectionId,
          installmentCount: dto.installmentCount ?? existing.installmentCount,
          dueDayOffset: dto.dueDayOffset ?? existing.dueDayOffset,
          installmentGapDays: dto.installmentGapDays ?? existing.installmentGapDays,
          lateFeePercentBps: dto.lateFeePercentBps ?? existing.lateFeePercentBps,
          lateFeeFlatCents: dto.lateFeeFlatCents ?? existing.lateFeeFlatCents,
          lateFeeGraceDays: dto.lateFeeGraceDays ?? existing.lateFeeGraceDays,
          description: dto.description === undefined ? existing.description : dto.description,
          updatedBy: userId,
          lines: lines
            ? {
                create: lines.map((l, i) => ({
                  tenantId,
                  headId: l.headId,
                  amountCents: l.amountCents,
                  isRequired: l.isRequired ?? true,
                  sortOrder: l.sortOrder ?? i,
                })),
              }
            : undefined,
        },
        include: STRUCTURE_INCLUDE,
      });

      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.STRUCTURE_UPDATED, module: AUDIT_MODULES.FEES,
        entityType: 'FeeStructure', entityId: id,
        before: { name: existing.name, lineCount: existing.lines.length },
        after: { name: structure.name, lineCount: structure.lines.length },
      });
      return structure;
    });
  }

  async activate(tenantId: string, userId: string, id: string) {
    const existing = await this.get(tenantId, id);
    if (!existing.lines.length) throw new BadRequestException('Cannot activate a structure with no lines.');
    if (existing.status === 'ACTIVE') return existing;
    const row = await this.client.feeStructure.update({
      where: { id },
      data: { status: 'ACTIVE', updatedBy: userId },
      include: STRUCTURE_INCLUDE,
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.STRUCTURE_ACTIVATED, module: AUDIT_MODULES.FEES,
      entityType: 'FeeStructure', entityId: id,
      before: { status: existing.status }, after: { status: 'ACTIVE' },
    });
    return row;
  }

  async archive(tenantId: string, userId: string, id: string) {
    const existing = await this.get(tenantId, id);
    const row = await this.client.feeStructure.update({
      where: { id },
      data: { status: 'ARCHIVED', updatedBy: userId },
    });
    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.STRUCTURE_ARCHIVED, module: AUDIT_MODULES.FEES,
      entityType: 'FeeStructure', entityId: id,
      before: { status: existing.status }, after: { status: 'ARCHIVED' },
    });
    return { id, archived: true };
  }

  /** Pure installment preview — no writes. Mirrors exactly what assignment issuance persists. */
  async preview(tenantId: string, id: string, query: PreviewStructureDto) {
    const structure = await this.get(tenantId, id);
    const anchor = query.effectiveDate ? new Date(query.effectiveDate) : (structure.term?.startDate ?? new Date());
    return buildInstallmentPlan(
      structure.lines.map((l) => ({ id: l.id, headCode: l.head.code, headName: l.head.name, amountCents: l.amountCents })),
      structure.installmentCount,
      anchor,
      structure.dueDayOffset,
      structure.installmentGapDays,
    );
  }
}