import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Queue, QueueEvents, type ConnectionOptions } from 'bullmq';
import { backgroundJobService, MONITORED_QUEUES } from '@college-erp/queue';
import { QUEUE_NAMES } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { DeadLetterService } from './dead-letter.service';

/**
 * Bridges every BullMQ queue's lifecycle events into the job-status registry and the dead-letter
 * queue — WITHOUT each processor having to know about either. It subscribes to `QueueEvents` for
 * each monitored queue and:
 *   - on `active`     → mark the registry row ACTIVE (+ first-seen startedAt);
 *   - on `completed`  → mark it COMPLETED;
 *   - on `failed`     → either mark RETRYING (more attempts left) or, when the job is terminal,
 *                       move it to the dead-letter queue and mark it DEAD_LETTERED.
 *
 * Terminality is read back off the concrete job (`attemptsMade >= opts.attempts`) or the error is
 * an `UnrecoverableError`. The dead-letter queue itself is excluded (a failed DLQ job must never
 * re-enter the DLQ).
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
  ) {
    const redisUrl = new URL(this.config.get('REDIS_URL'));
    this.connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), maxRetriesPerRequest: null };
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
      // job has used up its budget. (UnrecoverableError short-circuits retries; those processors
      // move their own job to the DLQ, see the docs on DeadLetterService.)
      const terminal = job.attemptsMade >= maxAttempts;
      if (terminal) {
        await this.deadLetters.move(job, new Error(failedReason), failedReason);
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
