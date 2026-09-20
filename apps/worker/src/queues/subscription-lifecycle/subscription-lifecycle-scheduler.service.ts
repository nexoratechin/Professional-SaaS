import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type SubscriptionLifecycleSweepJobData } from '@college-erp/types';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Self-registers its own recurring sweep on worker startup — a fixed jobId makes BullMQ dedupe
 * this across restarts, so re-registering on every boot never produces duplicate schedules. */
@Injectable()
export class SubscriptionLifecycleSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionLifecycleSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.SUBSCRIPTION_LIFECYCLE)
    private readonly queue: Queue<SubscriptionLifecycleSweepJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'subscription-lifecycle-sweep' });
    this.logger.log(`Registered subscription lifecycle sweep, repeating every ${SWEEP_INTERVAL_MS / 60_000} minutes.`);
  }
}
