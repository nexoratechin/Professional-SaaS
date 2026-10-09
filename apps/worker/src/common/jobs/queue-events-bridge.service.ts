import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import { backgroundJobService, MONITORED_QUEUES } from '@college-erp/queue';
import { bumpWindow, recordQueueJobCompleted, recordQueueJobFailed, WINDOW_COUNTERS } from '@college-erp/observability';
import { QUEUE_NAMES } from '@college-erp/types';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { WORKER_REDIS_CLIENT } from '../observability/redis.constants';
import { WorkerErrorTrackerService } from '../observability/worker-error-tracker.service';
import { DeadLetterService } from './dead-letter.service';

/**
 * Bridges every BullMQ queue's lifecycle events into the job-status registry, the dead-letter
 * queue and the observability pipeline — WITHOUT each processor having to know about any of them.
 * It subscribes to `QueueEvents` for each monitored queue and:
 *   - on `active`     → mark the registry row ACTIVE (+ first-seen startedAt);
 *   - on `completed`  → mark it COMPLETED + record duration/throughput metrics;
 *   - on `failed`     → record failure metrics + the queue_failures alert window, then either mark
 *                       RETRYING (more attempts left) or, when the job is terminal, move it to the
 *                       dead-letter queue, mark it DEAD_LETTERED and capture a tracked error.
 *
 * Terminality is read back off the concrete job (`attemptsMade >= opts.attempts`). The dead-letter
 * queue itself is excluded (a failed DLQ job must never re-enter the DLQ).
 */
@Injectable()
export class QueueEventsBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueEventsBridgeService.name);
  private readonly connection: ConnectionOptions;
  private readonly events: QueueEvents[] = [];
  private readonly queues = new Map<string, Queue>();

  constructor(
    private readonly config: AppConfigService,
    private readonly deadLetters: DeadLetterService,
    private readonly errorTracker: WorkerErrorTrackerService,
    @Inject(WORKER_REDIS_CLIENT) private readonly redis: Redis,
  ) {
    const redisUrl = new URL(this.config.get('REDIS_URL'));
    this.connection = { host: redisUrl.hostname, port: Number(redisUrl.port ?? 6379), maxRetriesPerRequest: null };
  }

  onModuleInit(): void {
    for (const name of MONITORED_QUEUES) {
      if (name === QUEUE_NAMES.DEAD_LETTER) continue;
      this.attach(name);
    }
    this.logger.log(`Observing ${this.events.length} queue(s) for status + dead-letter handling.`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.events.map((events) => events.close().catch(() => undefined)));
    await Promise.all([...this.queues.values()].map((queue) => queue.close().catch(() => undefined)));
    this.events.length = 0;
    this.queues.clear();
  }

  private queue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const queue = new Queue(name, { connection: this.connection });
    this.queues.set(name, queue);
    return queue;
  }

  private attach(name: string): void {
    const events = new QueueEvents(name, { connection: this.connection });
    events.on('active', ({ jobId }) => {
      void this.onActive(name, jobId);
    });
    events.on('completed', ({ jobId, returnvalue }) => {
      void this.onCompleted(name, jobId, returnvalue);
    });
    events.on('failed', ({ jobId, failedReason }) => {
      void this.onFailed(name, jobId, failedReason);
    });
    events.on('error', (error) => {
      this.logger.warn(`QueueEvents(${name}) error: ${error.message}`);
    });
    this.events.push(events);
  }

  private async onActive(queueName: string, jobId: string): Promise<void> {
    try {
      const job = await this.queue(queueName).getJob(jobId);
      if (!job) return;
      await backgroundJobService.markActive(queueName, jobId, job.attemptsMade);
    } catch (error) {
      this.logger.warn(`Failed to mark ${queueName}#${jobId} active: ${messageOf(error)}`);
    }
  }

  private async onCompleted(queueName: string, jobId: string, returnValue: unknown): Promise<void> {
    try {
      await backgroundJobService.markCompleted(queueName, jobId, returnValue);
      const job = await this.queue(queueName).getJob(jobId);
      const durationMs =
        job?.finishedOn && job.processedOn ? Math.max(0, job.finishedOn - job.processedOn) : undefined;
      recordQueueJobCompleted({ queue: queueName, ...(durationMs !== undefined ? { durationMs } : {}) });
    } catch (error) {
      this.logger.warn(`Failed to mark ${queueName}#${jobId} completed: ${messageOf(error)}`);
    }
  }

  private async onFailed(queueName: string, jobId: string, failedReason: string): Promise<void> {
    try {
      const job = await this.queue(queueName).getJob(jobId);
      if (!job) return;
      const maxAttempts = job.opts.attempts ?? 1;
      // BullMQ has already incremented attemptsMade for this failure, so it is terminal when the
      // job has used up its budget.
      const terminal = job.attemptsMade >= maxAttempts;
      recordQueueJobFailed({ queue: queueName, terminal });
      void bumpWindow(this.redis, WINDOW_COUNTERS.queueFailures).catch(() => undefined);

      if (terminal) {
        await this.deadLetters.move(job, new Error(failedReason), failedReason);
        this.errorTracker.capture(new Error(failedReason), {
          source: 'worker',
          queue: queueName,
          ...(job.id ? { jobId: job.id } : {}),
          ...((job.data as { tenantId?: string } | undefined)?.tenantId
            ? { tenantId: (job.data as { tenantId?: string }).tenantId as string }
            : {}),
          context: { jobName: job.name, attemptsMade: job.attemptsMade, maxAttempts },
        });
      } else {
        await backgroundJobService.markRetrying(queueName, jobId, failedReason, job.attemptsMade);
      }
    } catch (error) {
      this.logger.warn(`Failed to handle ${queueName}#${jobId} failure: ${messageOf(error)}`);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
