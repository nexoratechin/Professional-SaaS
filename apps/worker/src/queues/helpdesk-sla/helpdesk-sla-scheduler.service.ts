import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type HelpdeskSlaSweepJobData } from '@college-erp/types';

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/** Self-registers its own recurring sweep on worker startup — a fixed jobId makes BullMQ dedupe
 * this across restarts, so re-registering on every boot never produces duplicate schedules. */
@Injectable()
export class HelpdeskSlaSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(HelpdeskSlaSchedulerService.name);

  constructor(@InjectQueue(QUEUE_NAMES.HELPDESK_SLA) private readonly queue: Queue<HelpdeskSlaSweepJobData>) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'helpdesk-sla-sweep' });
    this.logger.log(`Registered helpdesk SLA sweep, repeating every ${SWEEP_INTERVAL_MS / 60_000} minutes.`);
  }
}
