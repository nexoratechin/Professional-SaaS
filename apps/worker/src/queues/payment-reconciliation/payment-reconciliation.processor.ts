import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { UnrecoverableError, type Job, type Queue } from 'bullmq';
import { platformPrismaClient } from '@college-erp/database';
import { resolvePaymentGateway } from '@college-erp/payments';
import { defaultJobOptions, requireTenantId } from '@college-erp/queue';
import {
  QUEUE_NAMES,
  type PaymentReconciliationJobData,
  type PaymentReconciliationSweepJobData,
} from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';

/** A PENDING payment older than this is presumed stuck and eligible for the periodic sweep. */
const STALE_PENDING_MS = 15 * 60_000;
const SWEEP_BATCH = 200;

/**
 * Reconciles recorded gateway payments against the provider's current order status.
 *
 * SaaS billing `Payment` rows are control-plane data (like Invoice/Subscription) so they are read
 * and written through the unscoped platform client with an explicit tenantId filter — the payload's
 * tenantId is an ownership/audit check, never a tenant-guard scope. Two job shapes share one queue:
 *  - `reconcile` — reconcile a single payment (API-triggered);
 *  - `sweep`     — find stale PENDING payments across tenants and fan them out (recurring).
 *
 * Idempotent: a payment already in a terminal state is left untouched, and a deterministic jobId
 * prevents piling multiple reconciliation jobs onto the same payment.
 */
@Processor(QUEUE_NAMES.PAYMENT_RECONCILIATION)
export class PaymentReconciliationProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentReconciliationProcessor.name);

  constructor(
    private readonly config: AppConfigService,
    @InjectQueue(QUEUE_NAMES.PAYMENT_RECONCILIATION) private readonly queue: Queue,
  ) {
    super();
  }

  async process(job: Job<PaymentReconciliationJobData | PaymentReconciliationSweepJobData>): Promise<void> {
    if (job.name === 'sweep') {
      await this.sweep();
      return;
    }

    const tenantId = requireTenantId(job as Job<PaymentReconciliationJobData>);
    const { paymentId } = job.data as PaymentReconciliationJobData;
    await this.reconcile(tenantId, paymentId);
  }

  private async reconcile(tenantId: string, paymentId: string): Promise<void> {
    const payment = await platformPrismaClient.payment.findFirst({ where: { id: paymentId, tenantId } });
    if (!payment) {
      throw new UnrecoverableError(`Payment ${paymentId} not found for tenant ${tenantId}.`);
    }
    if (payment.status === 'SUCCEEDED' || payment.status === 'REFUNDED') {
      return; // terminal — nothing to reconcile
    }
    if (!payment.gatewayReference) {
      throw new UnrecoverableError(
        `Payment ${paymentId} has no gateway reference; it is a manual/offline payment and cannot be reconciled.`,
      );
    }

    const provider = resolvePaymentGateway(this.config.get('PAYMENTS_GATEWAY'));
    const event = await provider.fetchOrder(payment.gatewayReference);
    if (!event || event.status === payment.status) {
      this.logger.debug(`Payment ${paymentId} unchanged (${payment.status}).`);
      return;
    }

    const updated = await platformPrismaClient.payment.update({
      where: { id: payment.id },
      data: {
        status: event.status,
        method: event.method ?? payment.method,
        paidAt: event.paidAt ?? payment.paidAt,
        refundedAt: event.status === 'REFUNDED' ? new Date() : payment.refundedAt,
        failureReason: event.status === 'FAILED' ? 'Gateway reported a failure during reconciliation.' : null,
      },
    });

    await platformPrismaClient.platformAuditLog.create({
      data: {
        scope: 'TENANT',
        tenantId,
        actorType: 'SYSTEM',
        action: 'PAYMENT_RECONCILED',
        module: 'billing',
        entityType: 'Payment',
        entityId: payment.id,
        before: { status: payment.status },
        after: { status: updated.status, gatewayReference: payment.gatewayReference },
      },
    });

    this.logger.log(`Reconciled payment ${paymentId}: ${payment.status} -> ${updated.status}.`);
  }

  private async sweep(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_PENDING_MS);
    const stale = await platformPrismaClient.payment.findMany({
      where: { status: 'PENDING', gatewayReference: { not: null }, createdAt: { lt: cutoff } },
      select: { id: true, tenantId: true },
      orderBy: { createdAt: 'asc' },
      take: SWEEP_BATCH,
    });

    for (const payment of stale) {
      await this.queue.add(
        'reconcile',
        { tenantId: payment.tenantId, paymentId: payment.id } satisfies PaymentReconciliationJobData,
        defaultJobOptions(QUEUE_NAMES.PAYMENT_RECONCILIATION, { jobId: `reconcile-${payment.id}` }),
      );
    }
    this.logger.log(`Payment reconciliation sweep queued ${stale.length} stale payment(s).`);
  }
}
