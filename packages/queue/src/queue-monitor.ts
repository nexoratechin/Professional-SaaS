import { Queue, type ConnectionOptions } from 'bullmq';
import { QUEUE_NAMES, type QueueName } from '@college-erp/types';
import { MONITORED_QUEUES, summarizeQueue, type QueueHealthSnapshot, type QueueJobCounts } from './monitoring';

/**
 * Read-only queue telemetry. Wraps a `Queue` per monitored name against a shared connection so a
 * health endpoint or a periodic worker log can report backlog without each caller managing Queue
 * instances. Plain class (no Nest coupling) shared by both apps.
 */
export class QueueMonitor {
  private readonly queues = new Map<string, Queue>();

  constructor(private readonly connection: ConnectionOptions) {}

  private queue(name: string): Queue {
    const existing = this.queues.get(name);
    if (existing) return existing;
    const queue = new Queue(name, { connection: this.connection });
    this.queues.set(name, queue);
    return queue;
  }

  async counts(name: QueueName): Promise<QueueJobCounts> {
    return (await this.queue(name).getJobCounts()) as QueueJobCounts;
  }

  async snapshot(): Promise<QueueHealthSnapshot[]> {
    return Promise.all(
      MONITORED_QUEUES.map(async (name) => summarizeQueue(name, await this.counts(name))),
    );
  }

  /** Number of jobs awaiting operator attention on the dead-letter queue. */
  async deadLetterBacklog(): Promise<number> {
    const counts = await this.counts(QUEUE_NAMES.DEAD_LETTER);
    return (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0);
  }

  async close(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }
}
