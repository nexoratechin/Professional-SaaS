import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type IntegrationSyncSweepJobData } from '@college-erp/types';

/** How often the cross-tenant sweep looks for integrations due for a periodic sync. */
const SWEEP_INTERVAL_MS = 15 * 60_000;

/**
 * Registers the recurring integration sync sweep on worker startup.
 *
 * A fixed `jobId` makes BullMQ dedupe this across restarts, so re-registering on every boot never
 * produces duplicate schedules — the same convention as the other sweep schedulers in this worker.
 */
@Injectable()
export class IntegrationSyncSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(IntegrationSyncSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.INTEGRATION_SYNC) private readonly queue: Queue<IntegrationSyncSweepJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'integration-sync-sweep' });
    this.logger.log(
      `Registered integration sync sweep, repeating every ${SWEEP_INTERVAL_MS / 60_000} minutes.`,
    );
  }
}
