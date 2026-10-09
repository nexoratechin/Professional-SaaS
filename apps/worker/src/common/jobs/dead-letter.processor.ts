import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type DeadLetterJobData } from '@college-erp/types';

/**
 * Sink for jobs that exhausted their retries. Rather than silently dropping them, each dead-letter
 * delivery is recorded as an immutable PlatformAuditLog entry (the BackgroundJob row was already
 * flipped to DEAD_LETTERED by DeadLetterService) so operators have a durable, queryable trail and
 * can replay the verbatim payload by hand. The queue itself retains the recent jobs
 * (removeOnComplete) for inspection.
 */
@Processor(QUEUE_NAMES.DEAD_LETTER)
export class DeadLetterProcessor extends WorkerHost {
  private readonly logger = new Logger(DeadLetterProcessor.name);

  async process(job: Job<DeadLetterJobData>): Promise<void> {
    const data = job.data;
    this.logger.warn(
      `Dead-letter received from ${data.sourceQueue}#${data.sourceJobId ?? 'na'} (${data.jobName}): ${data.failedReason}`,
    );

    await platformPrismaClient.platformAuditLog.create({
      data: {
        scope: data.tenantId ? 'TENANT' : 'PLATFORM',
        tenantId: data.tenantId ?? null,
        actorType: 'SYSTEM',
        action: 'BACKGROUND_JOB_DEAD_LETTERED',
        entityType: 'BackgroundJob',
        entityId: data.sourceJobId ?? undefined,
        after: {
          sourceQueue: data.sourceQueue,
          jobName: data.jobName,
          attemptsMade: data.attemptsMade,
          maxAttempts: data.maxAttempts,
          failedReason: data.failedReason,
          failedAt: data.failedAt,
        },
      },
    });
  }
}
