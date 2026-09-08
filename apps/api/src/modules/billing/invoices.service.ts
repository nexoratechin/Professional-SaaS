import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  computeInvoiceTotals,
  formatInvoiceNumber,
  proratedShareCents,
} from '@college-erp/auth';
import type { InvoiceStatus, Prisma } from '@college-erp/database';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { StorageService } from '../../common/storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { BillingConfigService } from './billing-config.service';
import type { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import type { ListInvoicesDto } from './dto/list-invoices.dto';
import { buildInvoicePdf } from './invoice-pdf';

export type BillingActor =
  | { type: 'PLATFORM_USER'; platformUserId: string }
  | { type: 'USER'; userId: string };

function auditActorMeta(actor: BillingActor) {
  return actor.type === 'PLATFORM_USER'
    ? { actorType: 'PLATFORM_USER' as const, actorPlatformUserId: actor.platformUserId }
    : { actorType: 'USER' as const, actorUserId: actor.userId };
}

/**
 * Platform-generated billing. No payment-gateway integration exists yet (Phase 6+ per the
 * blueprint), so invoices are generated on demand (or by the worker's subscription-lifecycle
 * renewal sweep) from a Subscription's plan price + line items; tax is applied from the SaaS-wide
 * BillingConfig, invoice numbers are sequential under a configurable prefix, and markPaid/void
 * are manual platform-admin reconciliation actions rather than a webhook-driven state machine.
 * Paying the invoice is a PaymentsService concern (record → SUCCEEDED settles here).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
    private readonly billingConfig: BillingConfigService,
    private readonly storage: StorageService,
  ) {}

  /** Atomic, race-free invoice number allocation: UPDATE … increment returns the new sequence
   *  value, and the caller uses newValue - 1 as this invoice's sequence. Postgres row-locks the
   *  billing_config row, so two concurrent generators can never claim the same number. */
  private async allocateInvoiceNumber(tx: Prisma.TransactionClient, now: Date): Promise<string> {
    const updated = await tx.billingConfig.update({
      where: { id: 'default' },
      data: { nextInvoiceSequence: { increment: 1 } },
    });
    return formatInvoiceNumber(updated.invoicePrefix, updated.nextInvoiceSequence - 1, now);
  }

  private async buildStandardLineItems(subscription: {
    plan: { name: string; priceCents: number | null };
    billingCycle: string;
    items: Array<{ description: string; quantity: number; unitPriceCents: number }>;
  }): Promise<Array<{ description: string; quantity: number; unitPriceCents: number; amountCents: number }>> {
    const lineItems = [];
    if (subscription.plan.priceCents) {
      lineItems.push({
        description: `${subscription.plan.name} plan (${subscription.billingCycle})`,
        quantity: 1,
        unitPriceCents: subscription.plan.priceCents,
        amountCents: subscription.plan.priceCents,
      });
    }
    for (const item of subscription.items) {
      lineItems.push({
        description: item.description,
        quantity: item.quantity,
        unitPriceCents: item.unitPriceCents,
        amountCents: item.quantity * item.unitPriceCents,
      });
    }
    return lineItems;
  }

  /** Core invoice generator: taxes a subtotal per BillingConfig, sets dueAt from config
   *  (overridable), allocates a sequence number, and creates invoice + line items atomically.
   *  Used by the ad-hoc platform-admin endpoint, plan-change proration, and (mirrored in the
   *  worker) the renewal sweep. */
  async generateForSubscriptionPeriod(
    subscriptionId: string,
    periodStart: Date,
    periodEnd: Date,
    actor: BillingActor,
    opts: { dueInDays?: number | null; status?: 'DRAFT' | 'ISSUED' } = {},
  ) {
    const subscription = await this.platformPrisma.client.subscription.findUniqueOrThrow({
      where: { id: subscriptionId },
      include: { plan: true, items: true },
    });
    const config = await this.billingConfig.get();

    const lineItems = await this.buildStandardLineItems(subscription);
    if (lineItems.length === 0) {
      throw new BadRequestException('This subscription has no billable plan price or items to invoice.');
    }

    const subtotalCents = lineItems.reduce((sum, item) => sum + item.amountCents, 0);
    const { taxCents, totalCents } = computeInvoiceTotals(subtotalCents, config.taxRateBps);

    const now = new Date();
    const dueInDays = opts.dueInDays ?? config.renewalDueDays;
    const dueAt = new Date(now.getTime() + dueInDays * 24 * 60 * 60 * 1000);

    const invoice = await this.platformPrisma.client.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          tenantId: subscription.tenantId,
          subscriptionId: subscription.id,
          invoiceNumber: await this.allocateInvoiceNumber(tx, now),
          status: opts.status ?? 'ISSUED',
          currency: subscription.plan.currency,
          subtotalCents,
          taxCents,
          totalCents,
          periodStart,
          periodEnd,
          issuedAt: now,
          dueAt,
          createdByPlatformUserId: actor.type === 'PLATFORM_USER' ? actor.platformUserId : null,
        },
      });
      await tx.invoiceLineItem.createMany({
        data: lineItems.map((item) => ({ tenantId: subscription.tenantId, invoiceId: created.id, ...item })),
      });
      return created;
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: subscription.tenantId,
      ...auditActorMeta(actor),
      action: AUDIT_ACTIONS.INVOICE_GENERATED,
      module: AUDIT_MODULES.BILLING,
      entityType: 'Invoice',
      entityId: invoice.id,
      after: { invoiceNumber: invoice.invoiceNumber, subtotalCents, taxCents, totalCents },
    });

    return this.getInvoice(invoice.id);
  }

  /** Backward-compatible ad-hoc generation (platform admin): invoices the CURRENT period. */
  generateForSubscription(subscriptionId: string, dto: GenerateInvoiceDto, actorPlatformUserId: string) {
    return this.platformPrisma.client.subscription
      .findUniqueOrThrow({ where: { id: subscriptionId } })
      .then((subscription) =>
        this.generateForSubscriptionPeriod(
          subscriptionId,
          subscription.currentPeriodStart,
          subscription.currentPeriodEnd,
          { type: 'PLATFORM_USER', platformUserId: actorPlatformUserId },
          { dueInDays: dto.dueInDays ?? null },
        ),
      );
  }

  /** Prorated adjustment invoice emitted on an immediate upgrade/downgrade. Credits the old
   *  plan's unused remainder and charges the new plan's remainder; a net-credit month still
   *  produces a nil-total document showing both lines. Never paid automatically — it follows the
   *  normal payment/grace flow (the plan change itself takes effect immediately). */
  async createProrationInvoice(
    subscription: {
      id: string;
      tenantId: string;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      plan: { name: string; priceCents: number | null; currency: string };
      items: Array<{ description: string; quantity: number; unitPriceCents: number }>;
    },
    targetPlan: { name: string; priceCents: number | null },
    actor: BillingActor,
  ) {
    const config = await this.billingConfig.get();
    const now = new Date();
    const creditCents = subscription.plan.priceCents
      ? proratedShareCents(subscription.plan.priceCents, subscription.currentPeriodStart, subscription.currentPeriodEnd, now)
      : 0;
    const chargeCents = targetPlan.priceCents
      ? proratedShareCents(targetPlan.priceCents, subscription.currentPeriodStart, subscription.currentPeriodEnd, now)
      : 0;

    const lineItems: Array<{ description: string; quantity: number; unitPriceCents: number; amountCents: number }> = [];
    if (creditCents > 0) {
      lineItems.push({
        description: `Credit — unused portion of ${subscription.plan.name}`,
        quantity: 1,
        unitPriceCents: -creditCents,
        amountCents: -creditCents,
      });
    }
    if (chargeCents > 0) {
      lineItems.push({
        description: `Prorated charge — ${targetPlan.name} for remainder of billing period`,
        quantity: 1,
        unitPriceCents: chargeCents,
        amountCents: chargeCents,
      });
    }
    if (lineItems.length === 0) {
      return null;
    }

    const subtotalCents = lineItems.reduce((sum, line) => sum + line.amountCents, 0);
    const { taxCents, totalCents } = computeInvoiceTotals(subtotalCents, config.taxRateBps);

    const invoice = await this.platformPrisma.client.$transaction(async (tx) => {
      const created = await tx.invoice.create({
        data: {
          tenantId: subscription.tenantId,
          subscriptionId: subscription.id,
          invoiceNumber: await this.allocateInvoiceNumber(tx, now),
          status: 'ISSUED',
          currency: subscription.plan.currency,
          subtotalCents,
          taxCents,
          totalCents,
          periodStart: subscription.currentPeriodStart,
          periodEnd: subscription.currentPeriodEnd,
          issuedAt: now,
          dueAt: new Date(now.getTime() + config.renewalDueDays * 24 * 60 * 60 * 1000),
        },
      });
      await tx.invoiceLineItem.createMany({
        data: lineItems.map((item) => ({ tenantId: subscription.tenantId, invoiceId: created.id, ...item })),
      });
      return created;
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: subscription.tenantId,
      ...auditActorMeta(actor),
      action: AUDIT_ACTIONS.INVOICE_GENERATED,
      module: AUDIT_MODULES.BILLING,
      entityType: 'Invoice',
      entityId: invoice.id,
      after: { invoiceNumber: invoice.invoiceNumber, subtotalCents, taxCents, totalCents, prorated: true },
    });

    return this.getInvoice(invoice.id);
  }

  async getInvoice(id: string) {
    return this.platformPrisma.client.invoice.findUniqueOrThrow({
      where: { id },
      include: { lineItems: true, payments: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async listForTenant(tenantId: string, query: ListInvoicesDto = {}) {
    const where = { tenantId, status: query.status as InvoiceStatus | undefined };
    const [data, total] = await Promise.all([
      this.platformPrisma.client.invoice.findMany({
        where,
        include: { lineItems: true },
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.platformPrisma.client.invoice.count({ where }),
    ]);
    return { data, total };
  }

  async listAll(query: ListInvoicesDto = {}) {
    const where = { status: query.status as InvoiceStatus | undefined };
    const [data, total] = await Promise.all([
      this.platformPrisma.client.invoice.findMany({
        where,
        include: { lineItems: true, payments: true },
        orderBy: { createdAt: 'desc' },
        skip: query.skip ?? 0,
        take: query.take ?? 50,
      }),
      this.platformPrisma.client.invoice.count({ where }),
    ]);
    return { data, total };
  }

  /** Settle an invoice: mark it PAID, and recover a PAST_DUE/TRIALING subscription to ACTIVE
   *  because the outstanding balance just cleared. Called by markPaid and by PaymentsService
   *  when a recorded payment SUCCEEDs. */
  private async settleInvoice(invoiceId: string): Promise<void> {
    const invoice = await this.platformPrisma.client.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { subscription: true },
    });
    if (invoice.status === 'PAID') {
      return;
    }
    if (invoice.status !== 'ISSUED' && invoice.status !== 'OVERDUE') {
      throw new BadRequestException(`Cannot settle a ${invoice.status} invoice.`);
    }

    await this.platformPrisma.client.$transaction(async (tx) => {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { status: 'PAID', paidAt: new Date() },
      });
      if (
        invoice.subscription &&
        (invoice.subscription.status === 'PAST_DUE' || invoice.subscription.status === 'TRIALING')
      ) {
        await tx.subscription.update({
          where: { id: invoice.subscription.id },
          data: { status: 'ACTIVE' },
        });
      }
    });
  }

  async markPaid(id: string, actorPlatformUserId: string) {
    const before = await this.platformPrisma.client.invoice.findUniqueOrThrow({
      where: { id },
      include: { subscription: true },
    });
    if (before.status === 'PAID' || before.status === 'VOID' || before.status === 'DRAFT') {
      throw new BadRequestException(`Cannot mark a ${before.status} invoice as paid.`);
    }

    await this.settleInvoice(id);

    const after = await this.platformPrisma.client.invoice.findUniqueOrThrow({
      where: { id },
      include: { subscription: true },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: before.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.INVOICE_MARKED_PAID,
      module: AUDIT_MODULES.BILLING,
      entityType: 'Invoice',
      entityId: id,
      before: { status: before.status, subscriptionStatus: before.subscription?.status },
      after: { status: after.status, subscriptionStatus: after.subscription?.status },
    });

    return after;
  }

  async voidInvoice(id: string, actorPlatformUserId: string) {
    const before = await this.platformPrisma.client.invoice.findUniqueOrThrow({ where: { id } });
    if (before.status === 'PAID') {
      throw new BadRequestException('Cannot void an invoice that has already been paid.');
    }
    if (before.status === 'VOID') {
      throw new BadRequestException('This invoice is already void.');
    }

    const invoice = await this.platformPrisma.client.invoice.update({
      where: { id },
      data: { status: 'VOID', voidedAt: new Date() },
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      tenantId: invoice.tenantId,
      actorType: 'PLATFORM_USER',
      actorPlatformUserId,
      action: AUDIT_ACTIONS.INVOICE_VOIDED,
      module: AUDIT_MODULES.BILLING,
      entityType: 'Invoice',
      entityId: id,
      before: { status: before.status },
      after: { status: invoice.status },
    });

    return invoice;
  }

  /** Render (and persist) the invoice PDF, then return a short-lived signed download URL.
   *  Generation is lazy + deterministic — if the stored key is missing (failed upload, storage
   *  purge) the document is rebuilt from the invoice rows on demand. */
  /** Tenant self-service PDF: ownership-checked wrapper over getInvoicePdfUrl. */
  async getTenantInvoicePdfUrl(tenantId: string, id: string) {
    const invoice = await this.platformPrisma.client.invoice.findUniqueOrThrow({ where: { id } });
    if (invoice.tenantId !== tenantId) {
      throw new ForbiddenException('This invoice does not belong to your tenant.');
    }
    return this.getInvoicePdfUrl(id);
  }

  async getInvoicePdfUrl(id: string): Promise<{ url: string; invoiceNumber: string }> {
    const invoice = await this.platformPrisma.client.invoice.findUniqueOrThrow({
      where: { id },
      include: { lineItems: true, subscription: { include: { plan: true } } },
    });
    const tenant = await this.platformPrisma.client.tenant.findUniqueOrThrow({ where: { id: invoice.tenantId } });
    const config = await this.billingConfig.get();

    let key = invoice.pdfStorageKey;
    if (!key) {
      const buffer = buildInvoicePdf({
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        currency: invoice.currency,
        subtotalCents: invoice.subtotalCents,
        taxCents: invoice.taxCents,
        totalCents: invoice.totalCents,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        issuedAt: invoice.issuedAt ?? invoice.createdAt,
        dueAt: invoice.dueAt,
        paidAt: invoice.paidAt,
        taxName: config.taxName,
        taxRateBps: config.taxRateBps,
        tenantName: tenant.name,
        billingEmail: tenant.billingEmail,
        planName: invoice.subscription?.plan.name ?? 'College ERP',
        lineItems: invoice.lineItems,
      });
      const candidate = `tenants/${invoice.tenantId}/billing/invoice-${invoice.invoiceNumber}.pdf`;
      try {
        await this.storage.uploadBuffer(candidate, buffer, 'application/pdf');
        await this.platformPrisma.client.invoice.update({ where: { id }, data: { pdfStorageKey: candidate } });
        key = candidate;
      } catch {
        // Storage unavailable — keep key null; a later call can regenerate.
        key = null;
      }
    }

    const url = key ? await this.storage.getDownloadUrl(invoice.tenantId, key, { contentType: 'application/pdf' }) : null;
    return { url: url ?? '', invoiceNumber: invoice.invoiceNumber };
  }
}