import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { computeInvoiceTotals, formatInvoiceNumber } from '@college-erp/auth';
import { platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type SubscriptionLifecycleSweepJobData } from '@college-erp/types';

/** Subscription statuses still "in flight" — eligible to age forward into PAST_DUE (via an
 *  overdue invoice) or EXPIRED (via the current billing period elapsing). SUSPENDED and CANCELED
 *  are deliberately not swept forward except where lifecycle explicitly allows (see below). */
const IN_FLIGHT_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/** advancePeriod: for MONTHLY/ANNUAL add exactly one billing cycle (Date arithmetic handles
 *  short months naturally, e.g. Jan 31 → Feb 28/Mar 28). ONE_TIME is not renewable — the renewal
 *  sweep skips it and it ages to EXPIRED once currentPeriodEnd passes. */
function advancePeriod(start: Date, cycle: string): Date {
  const next = new Date(start);
  if (cycle === 'MONTHLY') {
    next.setMonth(next.getMonth() + 1);
  } else if (cycle === 'ANNUAL') {
    next.setFullYear(next.getFullYear() + 1);
  }
  return next;
}

/**
 * Periodic maintenance sweep (see SubscriptionLifecycleSchedulerService). Responsibilities added
 * by the billing phase, in run order:
 *   0. renewActiveSubscriptions  — ACTIVE subscriptions whose period just ended: honor a
 *      cancelAtPeriodEnd flag (→ CANCELED) or roll the period forward, emit the next invoice,
 *      and record an automatic OFFLINE 'auto-renew' SUCCEEDED payment that settles it.
 *   1. markOverdueInvoices       — ISSUED past dueAt → OVERDUE.
 *   2. markPastDueSubscriptions  — subscription with an OVERDUE invoice → PAST_DUE (still entitled).
 *   3. retryFailedPayments       — PAST_DUE subscriptions: reopen the stale OVERDUE invoice as
 *      ISSUED and record a fresh PENDING attempt (a real gateway's dunning would own this once
 *      Phase 6 lands; until then each run is a configurable "retry").
 *   4. suspendPastGrace          — PAST_DUE subscriptions whose OVERDUE invoice is beyond dueAt +
 *      BillingConfig.gracePeriodDays → SUSPENDED (access cut by the entitlements gate).
 *   5. markExpiredSubscriptions  — in-flight subscriptions past currentPeriodEnd → EXPIRED
 *      (reporting only; entitlement rows self-expire via effectiveUntil).
 *
 * Runs purely on the unscoped platformPrismaClient (cross-tenant by nature) and writes its own
 * audit rows, same convention as WorkflowEscalationProcessor — the worker can't inject NestJS
 * services. It mirrors InvoicesService.generateForSubscriptionPeriod where invoice shape must
 * match (tax + sequential numbering are identical helpers).
 */
@Processor(QUEUE_NAMES.SUBSCRIPTION_LIFECYCLE)
export class SubscriptionLifecycleProcessor extends WorkerHost {
  private readonly logger = new Logger(SubscriptionLifecycleProcessor.name);

  async process(_job: Job<SubscriptionLifecycleSweepJobData>): Promise<void> {
    const now = new Date();

    const renewedCount = await this.renewActiveSubscriptions(now);
    const overdueInvoiceCount = await this.markOverdueInvoices(now);
    const pastDueCount = await this.markPastDueSubscriptions();
    const retriedCount = await this.retryFailedPayments(now);
    const suspendedCount = await this.suspendPastGraceSubscriptions(now);
    const expiredCount = await this.markExpiredSubscriptions(now);

    this.logger.log(
      `Subscription lifecycle sweep: ${renewedCount} renewed, ${overdueInvoiceCount} invoice(s) OVERDUE, ` +
        `${pastDueCount} PAST_DUE, ${retriedCount} payment(s) retried, ${suspendedCount} SUSPENDED, ` +
        `${expiredCount} EXPIRED.`,
    );
  }

  private async getConfig() {
    return platformPrismaClient.billingConfig.upsert({ where: { id: 'default' }, create: { id: 'default' }, update: {} });
  }

  private async allocateInvoiceNumber(txTime: Date, prefix: string, sequence: number): Promise<string> {
    return formatInvoiceNumber(prefix, sequence, txTime);
  }

  /** Atomic: increment sequence + insert invoice + line items + the auto-renew payment, so the
   *  invoice number and its settlement share one transaction with the config row's update lock. */
  private async renewActiveSubscriptions(now: Date): Promise<number> {
    const config = await this.getConfig();
    const subscriptions = await platformPrismaClient.subscription.findMany({
      where: { status: 'ACTIVE', currentPeriodEnd: { lte: now } },
      include: { plan: true, items: true },
    });

    let count = 0;
    for (const subscription of subscriptions) {
      if (subscription.billingCycle === 'ONE_TIME') {
        continue;
      }
      if (subscription.cancelAtPeriodEnd) {
        await platformPrismaClient.subscription.update({
          where: { id: subscription.id },
          data: { status: 'CANCELED', canceledAt: now },
        });
        await platformPrismaClient.platformAuditLog.create({
          data: {
            scope: 'PLATFORM',
            tenantId: subscription.tenantId,
            actorType: 'SYSTEM',
            action: 'SUBSCRIPTION_CANCELED',
            module: 'saas',
            entityType: 'Subscription',
            entityId: subscription.id,
            before: { status: 'ACTIVE', cancelAtPeriodEnd: true },
            after: { status: 'CANCELED', currentPeriodEnd: subscription.currentPeriodEnd },
          },
        });
        continue;
      }

      const periodStart = new Date(subscription.currentPeriodEnd);
      const periodEnd = advancePeriod(periodStart, subscription.billingCycle);

      const lineItems: Array<{ description: string; quantity: number; unitPriceCents: number; amountCents: number }> = [];
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
      if (lineItems.length === 0) {
        // Nothing billable (e.g. a $0 base with no items) — roll the period but don't invoice.
        await platformPrismaClient.subscription.update({
          where: { id: subscription.id },
          data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
        });
        continue;
      }

      const subtotalCents = lineItems.reduce((sum, line) => sum + line.amountCents, 0);
      const { taxCents, totalCents } = computeInvoiceTotals(subtotalCents, config.taxRateBps);
      const dueAt = new Date(periodStart.getTime() + config.renewalDueDays * DAY_MS);
      const issueAt = new Date(subscription.currentPeriodEnd);

      await platformPrismaClient.$transaction(async (tx) => {
        const seqRow = await tx.billingConfig.update({
          where: { id: 'default' },
          data: { nextInvoiceSequence: { increment: 1 } },
        });
        const invoiceNumber = await this.allocateInvoiceNumber(issueAt, seqRow.invoicePrefix, seqRow.nextInvoiceSequence - 1);

        const invoice = await tx.invoice.create({
          data: {
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            invoiceNumber,
            status: 'ISSUED',
            currency: subscription.plan.currency,
            subtotalCents,
            taxCents,
            totalCents,
            periodStart,
            periodEnd,
            issuedAt: issueAt,
            dueAt,
          },
        });
        await tx.invoiceLineItem.createMany({
          data: lineItems.map((item) => ({ tenantId: subscription.tenantId, invoiceId: invoice.id, ...item })),
        });
        await tx.payment.create({
          data: {
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            invoiceId: invoice.id,
            amountCents: totalCents,
            currency: subscription.plan.currency,
            status: 'SUCCEEDED',
            method: 'OFFLINE',
            gatewayReference: `auto-renew-${invoiceNumber}`,
            paidAt: issueAt,
          },
        });
        await tx.subscription.update({
          where: { id: subscription.id },
          data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
        });
        await tx.invoice.update({ where: { id: invoice.id }, data: { status: 'PAID', paidAt: issueAt } });
      });

      await platformPrismaClient.platformAuditLog.create({
        data: {
          scope: 'PLATFORM',
          tenantId: subscription.tenantId,
          actorType: 'SYSTEM',
          action: 'SUBSCRIPTION_RENEWED',
          module: 'saas',
          entityType: 'Subscription',
          entityId: subscription.id,
          before: { currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd },
          after: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
        },
      });
      count += 1;
    }

    return count;
  }

  private async markOverdueInvoices(now: Date): Promise<number> {
    const invoices = await platformPrismaClient.invoice.findMany({
      where: { status: 'ISSUED', dueAt: { lt: now } },
    });

    for (const invoice of invoices) {
      await platformPrismaClient.invoice.update({ where: { id: invoice.id }, data: { status: 'OVERDUE' } });
      await platformPrismaClient.platformAuditLog.create({
        data: {
          scope: 'PLATFORM',
          tenantId: invoice.tenantId,
          actorType: 'SYSTEM',
          action: 'INVOICE_OVERDUE',
          module: 'billing',
          entityType: 'Invoice',
          entityId: invoice.id,
          before: { status: 'ISSUED' },
          after: { status: 'OVERDUE', dueAt: invoice.dueAt },
        },
      });
    }

    return invoices.length;
  }

  private async markPastDueSubscriptions(): Promise<number> {
    const overdueInvoices = await platformPrismaClient.invoice.findMany({
      where: { status: 'OVERDUE', subscriptionId: { not: null } },
      select: { subscriptionId: true },
      distinct: ['subscriptionId'],
    });

    let count = 0;
    for (const { subscriptionId } of overdueInvoices) {
      if (!subscriptionId) continue;

      const subscription = await platformPrismaClient.subscription.findUnique({ where: { id: subscriptionId } });
      if (!subscription || !(['ACTIVE', 'TRIALING'] as const).includes(subscription.status as 'ACTIVE' | 'TRIALING')) {
        continue;
      }

      await platformPrismaClient.subscription.update({ where: { id: subscriptionId }, data: { status: 'PAST_DUE' } });
      await platformPrismaClient.platformAuditLog.create({
        data: {
          scope: 'PLATFORM',
          tenantId: subscription.tenantId,
          actorType: 'SYSTEM',
          action: 'SUBSCRIPTION_PAST_DUE',
          module: 'saas',
          entityType: 'Subscription',
          entityId: subscription.id,
          before: { status: subscription.status },
          after: { status: 'PAST_DUE' },
        },
      });
      count += 1;
    }

    return count;
  }

  /** Reopen the stale OVERDUE invoice (fresh dueAt = now + grace window) and record a new
   *  PENDING attempt, but only if the latest payment attempt has been FAILED/PENDING long
   *  enough to warrant the configured retry interval — this is the worker-side stand-in for a
   *  payment gateway's dunning retry (Phase 6 introduces the actual gateway webhooks). */
  private async retryFailedPayments(now: Date): Promise<number> {
    const config = await this.getConfig();
    const retryCutoff = new Date(now.getTime() - config.retryIntervalDays * DAY_MS);

    const overdueInvoices = await platformPrismaClient.invoice.findMany({ where: { status: 'OVERDUE', subscriptionId: { not: null } } });

    let count = 0;
    for (const invoice of overdueInvoices) {
      if (!invoice.subscriptionId) continue;
      const subscription = await platformPrismaClient.subscription.findUnique({ where: { id: invoice.subscriptionId } });
      if (!subscription || subscription.status !== 'PAST_DUE') continue;

      const latestAttempt = await platformPrismaClient.payment.findFirst({
        where: { invoiceId: invoice.id },
        orderBy: { createdAt: 'desc' },
      });
      if (!latestAttempt) continue;
      if (latestAttempt.createdAt > retryCutoff) continue;
      if (latestAttempt.status === 'SUCCEEDED' || latestAttempt.status === 'REFUNDED') continue;

      await platformPrismaClient.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id: invoice.id },
          data: { status: 'ISSUED', dueAt: new Date(now.getTime() + config.renewalDueDays * DAY_MS) },
        });
        await tx.payment.create({
          data: {
            tenantId: invoice.tenantId,
            subscriptionId: invoice.subscriptionId!,
            invoiceId: invoice.id,
            amountCents: invoice.totalCents,
            currency: invoice.currency,
            status: 'PENDING',
            method: 'OFFLINE',
          },
        });
      });

      await platformPrismaClient.platformAuditLog.create({
        data: {
          scope: 'PLATFORM',
          tenantId: invoice.tenantId,
          actorType: 'SYSTEM',
          action: 'PAYMENT_RETRIED',
          module: 'payments',
          entityType: 'Invoice',
          entityId: invoice.id,
          before: { status: 'OVERDUE', lastAttemptStatus: latestAttempt.status },
          after: { status: 'ISSUED', newAttemptStatus: 'PENDING' },
        },
      });
      count += 1;
    }

    return count;
  }

  /** SUSPENDED is normally a manual admin-only state, but a subscription that has sat PAST_DUE
   *  past its grace window (OVERDUE invoice's dueAt + gracePeriodDays) is auto-suspended:
   *  SUSPENDED is excluded from EntitlementsService's entitled statuses, so access genuinely
   *  stops until an admin reactivates or the balance clears (InvoicesService.markPaid /
   *  PaymentsService settle restore ACTIVE). */
  private async suspendPastGraceSubscriptions(now: Date): Promise<number> {
    const config = await this.getConfig();
    const overdueInvoices = await platformPrismaClient.invoice.findMany({
      where: { status: 'OVERDUE', subscriptionId: { not: null } },
      include: { subscription: true },
    });

    let count = 0;
    for (const invoice of overdueInvoices) {
      const subscription = invoice.subscription;
      if (!subscription || subscription.status !== 'PAST_DUE') continue;
      if (!invoice.dueAt) continue;

      const graceEnd = new Date(invoice.dueAt.getTime() + config.gracePeriodDays * DAY_MS);
      if (graceEnd >= now) continue;

      await platformPrismaClient.subscription.update({ where: { id: subscription.id }, data: { status: 'SUSPENDED' } });
      await platformPrismaClient.platformAuditLog.create({
        data: {
          scope: 'PLATFORM',
          tenantId: subscription.tenantId,
          actorType: 'SYSTEM',
          action: 'SUBSCRIPTION_SUSPENDED_FOR_NONPAYMENT',
          module: 'saas',
          entityType: 'Subscription',
          entityId: subscription.id,
          before: { status: 'PAST_DUE', overdueInvoiceId: invoice.id },
          after: { status: 'SUSPENDED', graceEnd },
        },
      });
      count += 1;
    }

    return count;
  }

  private async markExpiredSubscriptions(now: Date): Promise<number> {
    const subscriptions = await platformPrismaClient.subscription.findMany({
      where: { currentPeriodEnd: { lt: now }, status: { in: [...IN_FLIGHT_STATUSES] } },
    });

    for (const subscription of subscriptions) {
      await platformPrismaClient.subscription.update({ where: { id: subscription.id }, data: { status: 'EXPIRED' } });
      await platformPrismaClient.platformAuditLog.create({
        data: {
          scope: 'PLATFORM',
          tenantId: subscription.tenantId,
          actorType: 'SYSTEM',
          action: 'SUBSCRIPTION_EXPIRED',
          module: 'saas',
          entityType: 'Subscription',
          entityId: subscription.id,
          before: { status: subscription.status },
          after: { status: 'EXPIRED', currentPeriodEnd: subscription.currentPeriodEnd },
        },
      });
    }

    return subscriptions.length;
  }
}