/**
 * FeeConcessionsService — scholarship / concession / waiver workflow against demands or single
 * lines. REQUESTED rows are PENDING until approved: on approval the computed amount is distributed
 * across the target line(s) as StudentFee.waivedCents (the same channel the students module uses)
 * and the exact per-line split is persisted to `distribution`, so REVOKE reverses precisely the
 * amounts that were applied. Rejection/revoke never touch applied amounts unless unwinding them.
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { FeeStatus, PrismaClient } from '@college-erp/database';
import { AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { StudentsService } from '../students/students.service';
import { computeFeeLineStatus, refreshDemandFromLines } from './fee-ledger';
import { FEE_EVENTS } from './fees.constants';
import { CreateFeeConcessionDto, DecideConcessionDto, ListFeeConcessionQueryDto } from './fees.dto';

type Client = PrismaClient;

const OPEN_LINE_STATUSES = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

export interface ConcessionSplit {
  studentFeeId: string;
  amountCents: number;
}

const CONCESSION_INCLUDE = {
  student: { select: { id: true, fullName: true, admissionNumber: true } },
  demand: { select: { id: true, demandNumber: true, totalCents: true, paidCents: true, waivedCents: true } },
  studentFee: true,
  head: { select: { id: true, code: true, name: true } },
};

@Injectable()
export class FeeConcessionsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  async list(tenantId: string, query: ListFeeConcessionQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.studentId) where.studentId = query.studentId;

    const [rows, total] = await Promise.all([
      this.client.feeConcession.findMany({
        where,
        include: CONCESSION_INCLUDE,
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.client.feeConcession.count({ where }),
    ]);
    return { data: rows, total };
  }

  async get(tenantId: string, id: string) {
    const row = await this.client.feeConcession.findFirst({ where: { id, tenantId }, include: CONCESSION_INCLUDE });
    if (!row) throw new NotFoundException('Concession not found.');
    return row;
  }

  async request(tenantId: string, userId: string, dto: CreateFeeConcessionDto) {
    await this.studentsService.assertStudentInScope(dto.studentId, tenantId, userId);

    if (dto.basis === 'FLAT') {
      if (!dto.amountCents || dto.amountCents <= 0) throw new BadRequestException('FLAT concessions require amountCents > 0.');
    } else {
      if (!dto.percentBps || dto.percentBps <= 0) throw new BadRequestException('PERCENT concessions require percentBps > 0.');
    }
    if (!dto.studentFeeId && !dto.demandId) {
      throw new BadRequestException('A concession must target a demand, a fee line, or both (demand + head).');
    }

    const row = await this.client.feeConcession.create({
      data: {
        tenantId,
        studentId: dto.studentId,
        demandId: dto.demandId ?? null,
        studentFeeId: dto.studentFeeId ?? null,
        headId: dto.headId ?? null,
        kind: dto.kind,
        basis: dto.basis,
        percentBps: dto.percentBps ?? null,
        amountCents: dto.amountCents ?? null,
        reason: dto.reason,
        status: 'PENDING',
        requestedBy: userId,
      },
      include: CONCESSION_INCLUDE,
    });

    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.CONCESSION_REQUESTED, module: AUDIT_MODULES.FEES,
      entityType: 'FeeConcession', entityId: row.id,
      after: { kind: row.kind, basis: row.basis, target: dto.studentFeeId ? 'line' : 'demand', reason: row.reason },
    });
    return row;
  }

  /** PROCEED: approve (applies waivers) or reject. */
  async decide(tenantId: string, userId: string, id: string, dto: DecideConcessionDto) {
    const existing = await this.client.feeConcession.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Concession not found.');
    if (existing.status !== 'PENDING') throw new BadRequestException('Only pending concessions can be decided.');

    if (!dto.approve) {
      const rejected = await this.client.feeConcession.update({
        where: { id },
        data: { status: 'REJECTED', decidedBy: userId, decidedAt: new Date(), remarks: dto.remarks ?? null },
        include: CONCESSION_INCLUDE,
      });
      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.CONCESSION_DECIDED, module: AUDIT_MODULES.FEES,
        entityType: 'FeeConcession', entityId: id,
        before: { status: existing.status }, after: { status: 'REJECTED', remarks: dto.remarks },
      });
      return rejected;
    }

    const targetLines = await this.resolveTargetLines(tenantId, existing);
    if (!targetLines.length) throw new BadRequestException('No open fee lines matched the concession target.');

    const splits = this.computeSplits(existing, targetLines);
    if (splits.totalCents <= 0) throw new BadRequestException('Computed concession amount is zero.');

    return this.tenantPrisma.client.$transaction(async (tx) => {
      const touchedDemands = new Set<string>();

      for (const split of splits.items) {
        const line = await tx.studentFee.findUnique({ where: { id: split.studentFeeId } });
        if (!line) continue;
        const waivedCents = (line.waivedCents ?? 0) + split.amountCents;
        const status = computeFeeLineStatus({ ...line, waivedCents });
        await tx.studentFee.update({
          where: { id: split.studentFeeId },
          data: { waivedCents, status: status as FeeStatus, updatedBy: userId },
        });
        if (line.demandId) touchedDemands.add(line.demandId);
      }

      for (const demandId of touchedDemands) {
        await refreshDemandFromLines(tx, tenantId, demandId);
      }

      const approved = await tx.feeConcession.update({
        where: { id },
        data: {
          status: 'APPROVED',
          appliedCents: splits.totalCents,
          distribution: splits.items,
          decidedBy: userId,
          decidedAt: new Date(),
          remarks: dto.remarks ?? null,
        },
        include: CONCESSION_INCLUDE,
      });

      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.CONCESSION_DECIDED, module: AUDIT_MODULES.FEES,
        entityType: 'FeeConcession', entityId: id,
        before: { status: 'PENDING' },
        after: { status: 'APPROVED', appliedCents: splits.totalCents, distribution: splits.items },
      });
      return approved;
    });
  }

  /** Reverse an applied concession exactly as it was distributed. */
  async revoke(tenantId: string, userId: string, id: string) {
    const existing = await this.client.feeConcession.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Concession not found.');
    if (existing.status !== 'APPROVED') throw new BadRequestException('Only approved concessions can be revoked.');

    // distribution is a persisted JSON blob, not typed as ConcessionSplit[]
    const distribution = (existing.distribution ?? []) as unknown as ConcessionSplit[];
    if (!distribution.length || existing.appliedCents === 0) {
      throw new BadRequestException('Concession has no applied distribution to reverse.');
    }

    return this.tenantPrisma.client.$transaction(async (tx) => {
      const touchedDemands = new Set<string>();

      for (const split of distribution) {
        const line = await tx.studentFee.findUnique({ where: { id: split.studentFeeId } });
        if (!line) continue;
        const reverse = Math.min(split.amountCents, line.waivedCents ?? 0);
        const waivedCents = (line.waivedCents ?? 0) - reverse;
        const status = computeFeeLineStatus({ ...line, waivedCents });
        await tx.studentFee.update({
          where: { id: split.studentFeeId },
          data: { waivedCents, status: status as FeeStatus, updatedBy: userId },
        });
        if (line.demandId) touchedDemands.add(line.demandId);
      }

      for (const demandId of touchedDemands) {
        await refreshDemandFromLines(tx, tenantId, demandId);
      }

      const revoked = await tx.feeConcession.update({
        where: { id },
        data: { status: 'REVOKED', appliedCents: 0, distribution: [], decidedBy: userId, decidedAt: new Date() },
        include: CONCESSION_INCLUDE,
      });

      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.CONCESSION_DECIDED, module: AUDIT_MODULES.FEES,
        entityType: 'FeeConcession', entityId: id,
        before: { status: 'APPROVED', appliedCents: existing.appliedCents },
        after: { status: 'REVOKED', reversedCents: existing.appliedCents },
      });
      return revoked;
    });
  }

  /** Lines that may qualify, scoped to the tenant + student and still open to reduction. */
  private async resolveTargetLines(tenantId: string, concession: any) {
    const statuses = { in: OPEN_LINE_STATUSES };
    const base = { tenantId, studentId: concession.studentId, status: statuses as Record<string, unknown> };

    if (concession.studentFeeId) {
      const line = await this.client.studentFee.findFirst({
        where: { ...base, id: concession.studentFeeId },
      });
      return line ? [line] : [];
    }

    const demandWhere: Record<string, unknown> = { ...base };
    if (concession.demandId) {
      demandWhere.demandId = concession.demandId;
    }
    if (concession.headId) {
      demandWhere.structureLine = { headId: concession.headId };
    }
    return this.client.studentFee.findMany({
      where: demandWhere,
      orderBy: [{ dueDate: 'asc' }, { installmentIndex: 'asc' }],
    });
  }

  /** Pure distribution math: FLAT amount or PERCENT of each line's gross, distributed oldest-first. */
  private computeSplits(concession: any, lines: any[]) {
    const outstandingOf = (l: any) => Math.max(0, l.amountCents - (l.waivedCents ?? 0));

    if (lines.length === 1) {
      const cap = outstandingOf(lines[0]);
      const amount =
        concession.basis === 'FLAT'
          ? Math.min(concession.amountCents, cap)
          : Math.min(Math.round((lines[0].amountCents * (concession.percentBps ?? 0)) / 10000), cap);
      if (amount <= 0 || !OPEN_LINE_STATUSES.includes(lines[0].status)) return { totalCents: 0, items: [] };
      return { totalCents: amount, items: [{ studentFeeId: lines[0].id, amountCents: amount }] };
    }

    const items: ConcessionSplit[] = [];
    let remaining = concession.basis === 'FLAT' ? concession.amountCents : Infinity;

    for (const line of lines) {
      const cap = outstandingOf(line);
      if (cap <= 0) continue;
      let amount: number;
      if (concession.basis === 'PERCENT') {
        amount = Math.min(Math.round((line.amountCents * (concession.percentBps ?? 0)) / 10000), cap);
      } else {
        amount = Math.min(remaining, cap);
        remaining -= amount;
      }
      if (amount <= 0) continue;
      items.push({ studentFeeId: line.id, amountCents: amount });
      if (remaining === 0) break;
    }

    const totalCents = items.reduce((s, i) => s + i.amountCents, 0);
    return { totalCents, items };
  }
}