import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@college-erp/types';

const SWEEP_INTERVAL_MS = 10 * 60_000;

/**
 * Self-registers the recurring payment reconciliation sweep on worker startup. A fixed jobId makes
 * BullMQ dedupe it, so re-registering on every boot never stacks up duplicate sweeps.
 */
@Injectable()
export class PaymentReconciliationSchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(PaymentReconciliationSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.PAYMENT_RECONCILIATION) private readonly queue: Queue,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.add(
      'sweep',
      {},
      { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'payment-reconciliation-sweep' },
    );
    this.logger.log(`Payment reconciliation sweep registered (every ${SWEEP_INTERVAL_MS / 60_000} min).`);
  }
}
