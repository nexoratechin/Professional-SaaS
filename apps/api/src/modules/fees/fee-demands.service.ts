/**
 * FeeDemand reads + late-fee accrual.
 *
 * Late fees: a one-time penalty per unsettled line, charged once the due date + grace window has
 * passed — max(flatCents, percent of outstanding). The charge is idempotent per line (only
 * applied while line.lateFeeCents === 0), so re-running the sweep never double-charges.
 * Structure rules drive the amounts (percent is basis points: 500 = 5%).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { type FeeStatus, type PrismaClient } from '@college-erp/database';
import { AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { refreshDemandFromLines } from './fee-ledger';
import { FEE_EVENTS } from './fees.constants';
import { AccrueLateFeeDto, ListFeeDemandQueryDto } from './fees.dto';

type Client = PrismaClient;

const DEMAND_STATUS_PENDING: FeeStatus[] = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'];

export const DEMAND_INCLUDE = {
  student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true, program: true, section: true } },
  assignment: { include: { structure: { select: { id: true, name: true } } } },
  term: true,
  lines: {
    include: { structureLine: { select: { id: true, headId: true, amountCents: true } }, payments: true },
    orderBy: { installmentIndex: 'asc' as const },
  },
};

@Injectable()
export class FeeDemandsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  async list(tenantId: string, query: ListFeeDemandQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.studentId) where.studentId = query.studentId;
    if (query.assignmentId) where.assignmentId = query.assignmentId;
    if (query.dueFrom || query.dueTo) {
      where.dueDate = {};
      if (query.dueFrom) (where.dueDate as Record<string, unknown>).gte = new Date(query.dueFrom);
      if (query.dueTo) (where.dueDate as Record<string, unknown>).lte = new Date(query.dueTo);
    }
    if (query.outstandingOnly) {
      where.status = { in: DEMAND_STATUS_PENDING };
    }

    const [rows, total] = await Promise.all([
      this.client.feeDemand.findMany({
        where,
        select: {
          id: true,
          demandNumber: true,
          installmentIndex: true,
          issueDate: true,
          dueDate: true,
          status: true,
          totalCents: true,
          paidCents: true,
          waivedCents: true,
          lateFeeCents: true,
          createdAt: true,
          student: { select: { id: true, fullName: true, admissionNumber: true, rollNumber: true } },
          assignment: { select: { structure: { select: { name: true } } } },
        },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        orderBy: [{ dueDate: 'desc' }, { createdAt: 'desc' }],
      }),
      this.client.feeDemand.count({ where }),
    ]);

    const data = rows.map((r) => ({
      ...r,
      outstandingCents: Math.max(0, r.totalCents + r.lateFeeCents - r.paidCents - r.waivedCents),
    }));
    return { data, total };
  }

  async get(tenantId: string, id: string) {
    const row = await this.client.feeDemand.findFirst({ where: { id, tenantId }, include: DEMAND_INCLUDE });
    if (!row) throw new NotFoundException('Fee demand not found.');
    const outstandingCents = Math.max(0, row.totalCents + row.lateFeeCents - row.paidCents - row.waivedCents);
    return { ...row, outstandingCents };
  }

  /** Accrue the one-time late fee on the specified demand(s) (or all overdue when omitted). */
  async accrueLateFees(tenantId: string, userId: string, dto: AccrueLateFeeDto) {
    const demandIds = dto.demandIds?.length
      ? dto.demandIds
      : await this.client.feeDemand
          .findMany({
            where: { tenantId, dueDate: { lt: new Date() }, status: { in: DEMAND_STATUS_PENDING } },
            select: { id: true },
            take: 100,
            orderBy: { dueDate: 'asc' },
          })
          .then((rows) => rows.map((r) => r.id));

    if (!demandIds.length) return { demands: [], totalChargedCents: 0 };

    return this.tenantPrisma.client.$transaction(async (tx) => {
      let totalChargedCents = 0;
      const demands: { id: string; demandNumber: string; chargedCents: number }[] = [];

      for (const demandId of demandIds) {
        const demand = await tx.feeDemand.findUnique({ where: { id: demandId } });
        if (!demand || !DEMAND_STATUS_PENDING.includes(demand.status)) continue;
        const charged = await this.accrueDemand(tx, tenantId, userId, demand);
        if (charged > 0) {
          totalChargedCents += charged;
          demands.push({ id: demand.id, demandNumber: demand.demandNumber, chargedCents: charged });
        }
      }

      return { demands, totalChargedCents };
    });
  }

  private async accrueDemand(tx: any, tenantId: string, userId: string, demand: any): Promise<number> {
    const lines = await tx.studentFee.findMany({ where: { demandId: demand.id, tenantId } });
    if (!lines.length) return 0;

    const structureId = lines[0].structureId;
    const rules = structureId
      ? await tx.feeStructure.findUnique({ where: { id: structureId }, select: { lateFeePercentBps: true, lateFeeFlatCents: true, lateFeeGraceDays: true } })
      : null;
    const percentBps = rules?.lateFeePercentBps ?? 0;
    const flatCents = rules?.lateFeeFlatCents ?? 0;
    const graceDays = rules?.lateFeeGraceDays ?? 0;
    if (percentBps === 0 && flatCents === 0) return 0;

    const chargedAt = new Date();
    let chargedCents = 0;

    for (const line of lines) {
      if (['PAID', 'WAIVED', 'REFUNDED'].includes(line.status)) continue;
      if (line.lateFeeCents > 0) continue;
      if (!line.dueDate) continue;
      const graceAt = new Date(line.dueDate);
      graceAt.setUTCDate(graceAt.getUTCDate() + graceDays);
      if (chargedAt.getTime() <= graceAt.getTime()) continue;

      const outstanding = Math.max(0, line.amountCents - line.paidCents - line.waivedCents);
      if (outstanding <= 0) continue;

      const percentCharge = Math.round(outstanding * (percentBps / 10000));
      const charge = Math.max(flatCents, percentCharge);
      if (charge <= 0) continue;

      await tx.studentFee.update({
        where: { id: line.id },
        data: { lateFeeCents: line.lateFeeCents + charge, lastLateFeeAccruedAt: chargedAt, updatedBy: userId },
      });
      chargedCents += charge;
    }

    if (chargedCents > 0) {
      await refreshDemandFromLines(tx, tenantId, demand.id);
      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.DEMAND_LATE_FEE_ACCRUED, module: AUDIT_MODULES.FEES,
        entityType: 'FeeDemand', entityId: demand.id,
        after: { chargedCents, totalLateFeeCents: demand.lateFeeCents + chargedCents },
      });
    }
    return chargedCents;
  }
}