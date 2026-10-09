import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { buildDeadLetterPayload } from '@college-erp/queue';
import { backgroundJobService, defaultJobOptions } from '@college-erp/queue';
import { bumpWindow, recordDeadLetterMove, WINDOW_COUNTERS } from '@college-erp/observability';
import { QUEUE_NAMES, type DeadLetterJobData, type TenantJobData } from '@college-erp/types';
import type Redis from 'ioredis';
import { WORKER_REDIS_CLIENT } from '../observability/redis.constants';

/**
 * Moves a job that has exhausted its retries (or failed unrecoverably) onto the dead-letter queue
 * and flips its registry row to DEAD_LETTERED. The original payload is preserved verbatim so an
 * operator can replay the exact work from the DLQ.
 */
@Injectable()
export class DeadLetterService {
  private readonly logger = new Logger(DeadLetterService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.DEAD_LETTER) private readonly deadLetterQueue: Queue<DeadLetterJobData>,
    @Inject(WORKER_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async move(job: Job, error: Error, reason?: string): Promise<void> {
    const data = buildDeadLetterPayload({
      sourceQueue: job.queueName,
      sourceJobId: job.id,
      jobName: job.name,
      tenantId: (job.data as Partial<TenantJobData> | undefined)?.tenantId ?? null,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts.attempts ?? 1,
      failedReason: reason ?? error.message,
      payload: job.data,
    });

    await this.deadLetterQueue.add(
      'dead-letter',
      data,
      defaultJobOptions(QUEUE_NAMES.DEAD_LETTER, { jobId: `${job.queueName}-${job.id ?? 'na'}` }),
    );
    await backgroundJobService.markDeadLettered(job.queueName, job.id ?? 'unknown', data.failedReason, job.attemptsMade);

    // Observability: metric + the cross-process window the alert engine watches.
    recordDeadLetterMove(job.queueName);
    void bumpWindow(this.redis, WINDOW_COUNTERS.deadLetterMoves).catch(() => undefined);

    this.logger.error(
      `Job ${job.queueName}#${job.id} (${job.name}) exhausted ${job.attemptsMade}/${
        job.opts.attempts ?? 1
      } attempts and was moved to the dead-letter queue: ${data.failedReason}`,
    );
  }
}
