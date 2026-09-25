import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type DocumentRetentionSweepJobData } from '@college-erp/types';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Self-registers its own recurring retention sweep on worker startup — a fixed jobId makes
 *  BullMQ dedupe this across restarts, so re-registering on every boot never produces duplicate
 *  schedules. */
@Injectable()
export class DocumentRetentionSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(DocumentRetentionSchedulerService.name);

  constructor(@InjectQueue(QUEUE_NAMES.DOCUMENT_RETENTION) private readonly queue: Queue<DocumentRetentionSweepJobData>) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'document-retention-sweep' });
    this.logger.log(`Registered document retention sweep, repeating every ${SWEEP_INTERVAL_MS / 60_000} minutes.`);
  }
}