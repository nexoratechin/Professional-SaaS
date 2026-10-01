import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type AnalyticsRefreshSweepJobData } from '@college-erp/types';

/**
 * Hourly, not daily.
 *
 * DAILY buckets are the product of this job, and a daily bucket can only be computed once it has
 * closed - so a once-a-day sweep would leave the newest chart point up to 48 hours old. Hourly gives
 * every closed daily bucket (and the newest closed monthly bucket) a fresh row within the hour,
 * while the write is an idempotent upsert on (scope, scopeKey, granularity, periodStart) so running
 * it more often than strictly necessary costs an update, never a duplicate.
 */
const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Self-registers its own recurring sweep on worker startup — a fixed jobId makes BullMQ dedupe
 * this across restarts, so re-registering on every boot never produces duplicate schedules. */
@Injectable()
export class AnalyticsRefreshSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AnalyticsRefreshSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ANALYTICS_REFRESH)
    private readonly queue: Queue<AnalyticsRefreshSweepJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'analytics-refresh-sweep' });
    this.logger.log(`Registered analytics refresh sweep, repeating every ${SWEEP_INTERVAL_MS / 60_000} minutes.`);
  }
}
