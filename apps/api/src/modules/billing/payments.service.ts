import { BadRequestException, Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { PaymentStatus } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import { InvoicesService } from './invoices.service';
import type { ListPaymentsDto, RecordPaymentDto } from './dto/list-payments.dto';

/**
 * Payments are reconciled records, not yet a live gateway (Phase 6+). A record's status drives
 * the same transitions a webhook would: SUCCEEDED settles the invoice (markPaid — which also
 * recovers a PAST_DUE/TRIALING subscription), FAILED leaves the invoice open for the worker's
 * retry sweep, and REFUND keeps the invoice settled while the money moves out. The worker's
 * renewal sweep records an automatic OFFLINE 'auto-renew' SUCCEEDED payment as it re-invoices.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly auditService: AuditService,
  ) {}

  async recordPayment(invoiceId: string, dto: RecordPaymentDto, actorPlatformUserId: string) {
    const invoice = await this.platformPrisma.client.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { subscription: true },
    });
    if (invoice.status === 'VOID') {
      throw new BadRequestException('Cannot record a payment against a voided invoice.');
    }
    if (invoice.status === 'DRAFT') {
      throw new BadRequestException('Cannot record a payment against a draft (unissued) invoice.');
    }

    const amountCents = dto.amountCents ?? invoice.totalCents;
    const payment = await this.platformPrisma.client.payment.create({
      data: {
        tenantId: invoice.tenantId,
        subscriptionId: invoice.subscriptionId!,
        invoiceId: invoice.id,
        amountCents,
        currency: invoice.currency,
        status: dto.status,
        method: dto.method,
        gatewayReference: dto.gatewayReference,
        failureReason: dto.failureReason,
        paidAt: dto.status === 'SUCCEEDED' ? new Date() : null,
        createdByPlatformUserId: actorPlatformUserId,
      },
    });

    if (dto.status === 'SUCCEEDED') {
      await this.invoicesService.markPaid(invoice.id, actorPlatformUserId);
    }

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: invoice.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PAYMENT_RECORDED,
      module: AUDIT_MODULES.PAYMENTS,
      entityType: 'Payment',
      entityId: payment.id,
      after: {
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        status: dto.status,
        method: dto.method,
        amountCents,
        gatewayReference: dto.gatewayReference,
        failureReason: dto.failureReason,
      },
    });

    return payment;
  }

  /** Mark a FAILED payment attempt as refunded/voided by hand (platform admin). The invoice it
   *  was attached to is unaffected — a refund refers to money that previously collected. */
  async refundPayment(id: string, actorPlatformUserId: string) {
    const payment = await this.platformPrisma.client.payment.findUniqueOrThrow({ where: { id } });
    if (payment.status !== 'SUCCEEDED') {
      throw new BadRequestException('Only a SUCCEEDED payment can be refunded.');
    }
    const updated = await this.platformPrisma.client.payment.update({
      where: { id },
      data: { status: 'REFUNDED', refundedAt: new Date() },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: payment.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.PAYMENT_REFUNDED,
      module: AUDIT_MODULES.PAYMENTS,
      entityType: 'Payment',
      entityId: id,
      after: { status: 'REFUNDED', amountCents: payment.amountCents, invoiceId: payment.invoiceId },
    });

    return updated;
  }

  async listPayments(query: ListPaymentsDto = {}) {
    const where = {
      status: query.status as PaymentStatus | undefined,
      subscriptionId: query.subscriptionId,
      invoiceId: query.invoiceId,
    };
    const [data, total] = await Promise.all([
      this.platformPrisma.client.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.platformPrisma.client.payment.count({ where }),
    ]);
    return { data, total };
  }

  /** Tenant-scoped payments for the self-service routes — always bounded by the caller's tenant
   *  from the JWT, so a tenant can never read another tenant's payment rows. */
  async listTenantPayments(tenantId: string, query: ListPaymentsDto = {}) {
    const where = {
      tenantId,
      status: query.status as PaymentStatus | undefined,
      subscriptionId: query.subscriptionId,
      invoiceId: query.invoiceId,
    };
    const [data, total] = await Promise.all([
      this.platformPrisma.client.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.platformPrisma.client.payment.count({ where }),
    ]);
    return { data, total };
  }

  /** Combined tenant self-service overview — the single payload behind the tenant billing page.
   *  The worker keeps its own copy of renewal logic, so no cross-injectable worker dependency. */
  async getTenantBillingOverview(tenantId: string) {
    const [subscription, invoices, payments, config, plans] = await Promise.all([
      this.platformPrisma.client.subscription.findFirst({
        where: { tenantId, status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED'] } },
        orderBy: { createdAt: 'desc' },
        include: { plan: true },
      }),
      this.platformPrisma.client.invoice.findMany({
        where: { tenantId },
        include: { lineItems: true, payments: true },
        orderBy: { createdAt: 'desc' },
        take: 24,
      }),
      this.platformPrisma.client.payment.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: 24 }),
      this.platformPrisma.client.billingConfig.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} }),
      this.platformPrisma.client.plan.findMany({
        where: { isActive: true, isCustom: false },
        orderBy: { priceCents: 'asc' },
        select: { id: true, code: true, name: true, priceCents: true },
      }),
    ]);

    return {
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            billingCycle: subscription.billingCycle,
            currentPeriodStart: subscription.currentPeriodStart,
            currentPeriodEnd: subscription.currentPeriodEnd,
            cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
            canceledAt: subscription.canceledAt,
            plan: {
              id: subscription.plan.id,
              code: subscription.plan.code,
              name: subscription.plan.name,
              priceCents: subscription.plan.priceCents,
              currency: subscription.plan.currency,
},
        }
        : null,
      invoices,
      payments,
      config: {
        taxName: config.taxName,
        taxRateBps: config.taxRateBps,
        gracePeriodDays: config.gracePeriodDays,
        renewalDueDays: config.renewalDueDays,
      },
      plans,
    };
  }

  async getBillingSummary() {
    const [invoiceAgg, paymentAgg, active, pastDue, trials, invoicesByStatus] = await Promise.all([
      this.platformPrisma.client.invoice.aggregate({
        _sum: { totalCents: true, taxCents: true },
      }),
      this.platformPrisma.client.payment.aggregate({ _sum: { amountCents: true } }),
      this.platformPrisma.client.subscription.count({ where: { status: 'ACTIVE' } }),
      this.platformPrisma.client.subscription.count({ where: { status: 'PAST_DUE' } }),
      this.platformPrisma.client.subscription.count({ where: { status: 'TRIALING' } }),
      this.platformPrisma.client.invoice.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const outstanding = await this.platformPrisma.client.invoice.aggregate({
      _sum: { totalCents: true },
      where: { status: { in: ['ISSUED', 'OVERDUE'] } },
    });

    return {
      totalBilledCents: invoiceAgg._sum.totalCents ?? 0,
      totalCollectedCents: paymentAgg._sum.amountCents ?? 0,
      totalOutstandingCents: outstanding._sum.totalCents ?? 0,
      invoiceCounts: Object.fromEntries(invoicesByStatus.map((row) => [row.status, row._count._all])),
      activeSubscriptions: active,
      pastDueSubscriptions: pastDue,
      trials,
    };
  }
}