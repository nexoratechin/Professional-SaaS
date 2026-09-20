/**
 * FeeRefundsService — money-out workflow against a StudentPayment. REQUESTED → APPROVED → PROCESSED.
 * Processing reverses the payment's ledger allocations in a single transaction (earliest
 * allocations first): each touched line loses up to its paidCents, the payment is marked REFUNDED
 * once fully refunded, and demand caches are recomputed. Refund numbers come from the atomic
 * FeeSequence allocator (kind REFUND).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FeeSequenceKind, type PrismaClient } from '@college-erp/database';
import { AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { StudentsService } from '../students/students.service';
import { computeFeeLineStatus, refreshDemandFromLines } from './fee-ledger';
import { nextFeeSeriesNumber } from './fee-sequences';
import { FEE_EVENTS, REFUND_PREFIX_DEFAULT } from './fees.constants';
import { CreateFeeRefundDto, DecideRefundDto, ListFeeRefundQueryDto, ProcessRefundDto } from './fees.dto';

type Client = PrismaClient;

const REFUND_INCLUDE = {
  student: { select: { id: true, fullName: true, admissionNumber: true } },
  payment: { include: { allocations: { include: { line: true }, orderBy: { createdAt: 'asc' as const } } } },
};

@Injectable()
export class FeeRefundsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  async list(tenantId: string, query: ListFeeRefundQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.status) where.status = query.status;
    if (query.studentId) where.studentId = query.studentId;

    const [rows, total] = await Promise.all([
      this.client.feeRefund.findMany({
        where,
        include: { student: { select: { id: true, fullName: true, admissionNumber: true } }, payment: { select: { id: true, receiptNumber: true, amountCents: true } } },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.client.feeRefund.count({ where }),
    ]);
    return { data: rows, total };
  }

  async get(tenantId: string, id: string) {
    const row = await this.client.feeRefund.findFirst({ where: { id, tenantId }, include: REFUND_INCLUDE });
    if (!row) throw new NotFoundException('Refund not found.');
    return row;
  }

  async request(tenantId: string, userId: string, dto: CreateFeeRefundDto) {
    await this.studentsService.assertStudentInScope(dto.studentId, tenantId, userId);

    const payment = await this.client.studentPayment.findFirst({ where: { tenantId, id: dto.paymentId, studentId: dto.studentId } });
    if (!payment) throw new NotFoundException('Payment not found for this student.');

    const refundedCents = await this.client.feeRefund
      .aggregate({
        where: { tenantId, paymentId: dto.paymentId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSED'] } },
        _sum: { amountCents: true },
      })
      .then((r) => r._sum.amountCents ?? 0);
    const remaining = payment.amountCents - refundedCents;
    if (dto.amountCents > remaining) {
      throw new BadRequestException(`Only ${remaining} paise remain refundable on this payment.`);
    }

    const refund = await this.tenantPrisma.client.$transaction(async (tx) => {
      const refundNumber = await nextFeeSeriesNumber(tx, tenantId, FeeSequenceKind.REFUND, REFUND_PREFIX_DEFAULT);
      return tx.feeRefund.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          paymentId: dto.paymentId,
          refundNumber,
          amountCents: dto.amountCents,
          method: dto.method,
          reason: dto.reason,
          status: 'REQUESTED',
          requestedBy: userId,
        },
        include: REFUND_INCLUDE,
      });
    });

    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.REFUND_REQUESTED, module: AUDIT_MODULES.FEES,
      entityType: 'FeeRefund', entityId: refund.id,
      after: { number: refund.refundNumber, amountCents: refund.amountCents, paymentId: dto.paymentId },
    });
    return refund;
  }

  async decide(tenantId: string, userId: string, id: string, dto: DecideRefundDto) {
    const existing = await this.get(tenantId, id);
    if (existing.status !== 'REQUESTED') throw new BadRequestException('Only requested refunds can be decided.');

    const next = await this.client.feeRefund.update({
      where: { id },
      data: {
        status: dto.approve ? 'APPROVED' : 'REJECTED',
        approvedBy: dto.approve ? userId : null,
        approvedAt: dto.approve ? new Date() : null,
        rejectionReason: dto.approve ? null : dto.remarks ?? null,
      },
      include: REFUND_INCLUDE,
    });

    await this.auditService.record({
      scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
      action: FEE_EVENTS.REFUND_DECIDED, module: AUDIT_MODULES.FEES,
      entityType: 'FeeRefund', entityId: id,
      before: { status: 'REQUESTED' },
      after: { status: next.status, remarks: dto.approve ? null : dto.remarks },
    });
    return next;
  }

  /** Reverses the payment's ledger allocations transactionally. */
  async process(tenantId: string, userId: string, id: string, dto: ProcessRefundDto) {
    const existing = await this.client.feeRefund.findFirst({
      where: { id, tenantId },
      include: {
        payment: { include: { allocations: { include: { line: true }, orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!existing) throw new NotFoundException('Refund not found.');
    if (existing.status !== 'APPROVED') throw new BadRequestException('Only approved refunds can be processed.');
    if (existing.processedAt) throw new BadRequestException('Refund is already processed.');

    const allocations = existing.payment.allocations ?? [];
    let remaining = existing.amountCents;
    const touchedDemands = new Set<string>();

    return this.tenantPrisma.client.$transaction(async (tx) => {
      for (const allocation of allocations) {
        if (remaining <= 0) break;
        const line = allocation.line;
        if (!line) continue;
        const reverse = Math.min(remaining, line.paidCents);
        if (reverse <= 0) continue;
        remaining -= reverse;

        const paidCents = line.paidCents - reverse;
        const status = computeFeeLineStatus({ ...line, paidCents });
        await tx.studentFee.update({
          where: { id: line.id },
          data: { paidCents, status, updatedBy: userId },
        });
        if (line.demandId) touchedDemands.add(line.demandId);
      }

      if (remaining > 0) {
        throw new BadRequestException(`Only ${existing.amountCents - remaining} paise could be unwound (ledger mismatch).`);
      }

      for (const demandId of touchedDemands) {
        await refreshDemandFromLines(tx, tenantId, demandId);
      }

      const totalRefundable = existing.payment.amountCents;
      const refundedSoFar = await tx.feeRefund.aggregate({
        where: { tenantId, paymentId: existing.paymentId, status: { in: ['REQUESTED', 'APPROVED', 'PROCESSED'] } },
        _sum: { amountCents: true },
      });
      const isFullyRefunded = (refundedSoFar._sum.amountCents ?? 0) >= totalRefundable;

      const processed = await tx.feeRefund.update({
        where: { id },
        data: {
          status: 'PROCESSED',
          processedBy: userId,
          processedAt: new Date(),
          referenceNumber: dto.referenceNumber ?? null,
        },
        include: REFUND_INCLUDE,
      });

      if (isFullyRefunded) {
        await tx.studentPayment.update({ where: { id: existing.paymentId }, data: { status: 'REFUNDED' } });
      }

      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.REFUND_PROCESSED, module: AUDIT_MODULES.FEES,
        entityType: 'FeeRefund', entityId: id,
        before: { status: 'APPROVED' },
        after: { status: 'PROCESSED', amountCents: existing.amountCents, fullyRefunded: isFullyRefunded },
      });
      return processed;
    });
  }
}