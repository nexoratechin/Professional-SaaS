/**
 * FeePaymentsService — the money-in ledger. StudentPayment is the receipt; StudentFee lines hold
 * paidCents/waivedCents/lateFeeCents so every demand can be reconciled from its lines.
 *
 * Allocation: a payment is split greedily across a target demand's lines (oldest due date first,
 * late fee included in the outstanding balance). Over-payment is rejected outright. Payments are
 * replay-safe via idempotencyKey (unique per tenant). A receipt sequence number is drawn from the
 * atomic FeeSequence allocator with the tenant's configured numbering prefix.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { FeeSequenceKind, type FeeStatus, type PrismaClient } from '@college-erp/database';
import { AUDIT_MODULES } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { StudentsService } from '../students/students.service';
import { TenantConfigurationService } from '../tenant-configuration/tenant-configuration.service';
import { computeFeeLineStatus, refreshDemandFromLines } from './fee-ledger';
import { nextFeeSeriesNumber } from './fee-sequences';
import { FEE_EVENTS, RECEIPT_PREFIX_DEFAULT } from './fees.constants';
import { ListFeePaymentQueryDto, RecordFeePaymentDto } from './fees.dto';

type Client = PrismaClient;

const OPEN_LINE_STATUSES: FeeStatus[] = ['ISSUED', 'OVERDUE', 'PARTIALLY_PAID'];

const PAYMENT_INCLUDE = {
  student: { select: { id: true, fullName: true, admissionNumber: true } },
  allocations: { include: { line: true } },
};

interface OpenLine {
  id: string;
  demandId: string | null;
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  lateFeeCents: number;
  status: string;
  dueDate: Date | null;
}

@Injectable()
export class FeePaymentsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly auditService: AuditService,
    private readonly studentsService: StudentsService,
    private readonly tenantConfiguration: TenantConfigurationService,
  ) {}

  private get client(): Client {
    return this.tenantPrisma.client as Client;
  }

  async list(tenantId: string, query: ListFeePaymentQueryDto) {
    const where: Record<string, unknown> = { tenantId };
    if (query.studentId) where.studentId = query.studentId;
    if (query.demandId) where.allocations = { some: { line: { demandId: query.demandId } } };
    if (query.status) where.status = query.status;
    if (query.method) where.method = query.method;
    if (query.from || query.to) {
      where.paymentDate = {};
      if (query.from) (where.paymentDate as Record<string, unknown>).gte = new Date(query.from);
      if (query.to) (where.paymentDate as Record<string, unknown>).lte = new Date(query.to);
    }

    const [rows, total] = await Promise.all([
      this.client.studentPayment.findMany({
        where,
        include: PAYMENT_INCLUDE,
        skip: query.skip ?? 0,
        take: query.take ?? 50,
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      }),
      this.client.studentPayment.count({ where }),
    ]);
    return { data: rows, total };
  }

  async get(tenantId: string, id: string) {
    const row = await this.client.studentPayment.findFirst({ where: { id, tenantId }, include: PAYMENT_INCLUDE });
    if (!row) throw new NotFoundException('Payment not found.');
    return row;
  }

  /** Idempotent payment entry + greedy allocation + receipt numbering. */
  async record(tenantId: string, userId: string, dto: RecordFeePaymentDto) {
    await this.studentsService.assertStudentInScope(dto.studentId, tenantId, userId);

    if (dto.idempotencyKey) {
      const existing = await this.client.studentPayment.findUnique({
        where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: dto.idempotencyKey } },
      });
      if (existing) {
        const same =
          existing.studentId === dto.studentId &&
          existing.amountCents === dto.amountCents &&
          existing.method === dto.method;
        if (!same) {
          throw new ConflictException('idempotencyKey is already used by a different payment.');
        }
        const row = await this.get(tenantId, existing.id);
        return { ...row, duplicate: true };
      }
    }

    const paymentDate = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    const lines = await this.pickLines(tenantId, dto);

    const openOutstanding = lines.reduce((sum, l) => sum + this.lineOutstanding(l), 0);
    if (dto.amountCents > openOutstanding) {
      throw new BadRequestException(
        `Payment of ${dto.amountCents} exceeds open balance ${openOutstanding} on the selected lines.`,
      );
    }

    const prefix = await this.receiptPrefix(tenantId);

    return this.tenantPrisma.client.$transaction(async (tx) => {
      const receiptNumber = await nextFeeSeriesNumber(tx, tenantId, FeeSequenceKind.RECEIPT, prefix);
      const payment = await tx.studentPayment.create({
        data: {
          tenantId,
          studentId: dto.studentId,
          receiptNumber,
          amountCents: dto.amountCents,
          method: dto.method,
          paymentDate,
          status: 'SUCCEEDED',
          referenceNumber: dto.referenceNumber ?? null,
          idempotencyKey: dto.idempotencyKey ?? null,
          remarks: dto.remarks ?? null,
          recordedByUserId: userId,
        },
      });

      const allocations: { studentFeeId: string; amountCents: number }[] = [];
      let remaining = dto.amountCents;
      const touchedDemands = new Set<string>();

      for (const line of lines) {
        if (remaining <= 0) break;
        const outstanding = this.lineOutstanding(line);
        if (outstanding <= 0) continue;
        const alloc = Math.min(remaining, outstanding);
        remaining -= alloc;

        const paidCents = line.paidCents + alloc;
        const status = computeFeeLineStatus({
          amountCents: line.amountCents,
          paidCents,
          waivedCents: line.waivedCents,
          dueDate: line.dueDate,
        });
        await tx.studentFee.update({
          where: { id: line.id },
          data: { paidCents, status: status as FeeStatus, updatedBy: userId },
        });
        allocations.push({ studentFeeId: line.id, amountCents: alloc });
        if (line.demandId) touchedDemands.add(line.demandId);
      }

      if (allocations.length) {
        await tx.studentFeeAllocation.createMany({
          data: allocations.map((a) => ({
            tenantId,
            paymentId: payment.id,
            studentFeeId: a.studentFeeId,
            amountCents: a.amountCents,
          })),
        });
      }

      for (const demandId of touchedDemands) {
        await refreshDemandFromLines(tx, tenantId, demandId);
      }

      await this.auditService.record({
        scope: 'TENANT', tenantId, actorType: 'USER', actorUserId: userId,
        action: FEE_EVENTS.PAYMENT_RECORDED, module: AUDIT_MODULES.FEES,
        entityType: 'StudentPayment', entityId: payment.id,
        after: {
          number: receiptNumber,
          amountCents: payment.amountCents,
          method: payment.method,
          allocations,
        },
      });

      return tx.studentPayment.findUnique({ where: { id: payment.id }, include: PAYMENT_INCLUDE });
    });
  }

  private async pickLines(tenantId: string, dto: RecordFeePaymentDto): Promise<OpenLine[]> {
    const statuses = { in: OPEN_LINE_STATUSES };
    if (dto.studentFeeId) {
      const line = await this.client.studentFee.findFirst({ where: { tenantId, id: dto.studentFeeId } });
      if (!line) throw new NotFoundException('Fee line not found.');
      if (!OPEN_LINE_STATUSES.includes(line.status)) {
        throw new BadRequestException('This fee line is already settled.');
      }
      return [line as OpenLine];
    }

    if (dto.demandId) {
      const demand = await this.client.feeDemand.findFirst({ where: { tenantId, id: dto.demandId } });
      if (!demand) throw new NotFoundException('Fee demand not found.');
      return (await this.client.studentFee.findMany({
        where: { tenantId, demandId: dto.demandId, status: statuses },
        orderBy: [{ dueDate: 'asc' }, { installmentIndex: 'asc' }],
      })) as OpenLine[];
    }

    return (await this.client.studentFee.findMany({
      where: { tenantId, studentId: dto.studentId, status: statuses },
      orderBy: [{ dueDate: 'asc' }, { installmentIndex: 'asc' }],
      take: 20,
    })) as OpenLine[];
  }

  private lineOutstanding(line: Pick<OpenLine, 'amountCents' | 'paidCents' | 'waivedCents' | 'lateFeeCents'>): number {
    return Math.max(0, line.amountCents + (line.lateFeeCents ?? 0) - line.paidCents - (line.waivedCents ?? 0));
  }

  private async receiptPrefix(tenantId: string): Promise<string> {
    try {
      const config = await this.tenantConfiguration.get(tenantId);
      const numbering = (config as unknown as { numbering?: { feeReceiptPrefix?: string } })?.numbering;
      if (numbering?.feeReceiptPrefix) return numbering.feeReceiptPrefix;
    } catch {
      /* fall back to default */
    }
    return RECEIPT_PREFIX_DEFAULT;
  }
}