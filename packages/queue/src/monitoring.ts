import { QUEUE_NAMES, type QueueName } from '@college-erp/types';

/** BullMQ job-count snapshot for one queue (the shape returned by `Queue.getJobCounts()`). */
export interface QueueJobCounts {
  active: number;
  waiting: number;
  delayed: number;
  completed: number;
  failed: number;
  paused: number;
  [key: string]: number;
}

export interface QueueHealthSnapshot {
  name: QueueName;
  counts: QueueJobCounts;
  /** Total work not yet finished (active + waiting + delayed). */
  backlog: number;
  healthy: boolean;
}

/**
 * A queue is "healthy" when it is not accumulating a pathological backlog and nothing is stuck
 * active. These thresholds are intentionally generous — they flag a queue that has stopped making
 * progress, not ordinary bursts.
 */
export const BACKLOG_WARNING_THRESHOLD = 1_000;
export const FAILED_WARNING_THRESHOLD = 100;

export const MONITORED_QUEUES: readonly QueueName[] = Object.values(QUEUE_NAMES);

export function summarizeQueue(name: QueueName, counts: QueueJobCounts): QueueHealthSnapshot {
  const backlog = (counts.active ?? 0) + (counts.waiting ?? 0) + (counts.delayed ?? 0);
  // The dead-letter queue is a sink, not a pipeline: a rising failure count there is expected and
  // is surfaced separately (see DeadLetterService.pendingCount), so it never flips health itself.
  const healthy = name === QUEUE_NAMES.DEAD_LETTER || (
    backlog < BACKLOG_WARNING_THRESHOLD && (counts.failed ?? 0) < FAILED_WARNING_THRESHOLD
  );
  return { name, counts, backlog, healthy };
}
