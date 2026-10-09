import type { JobsOptions } from 'bullmq';
import { QUEUE_NAMES, type QueueName } from '@college-erp/types';

/**
 * Retry/backoff policy for one queue. Every job enqueued through
 * {@link defaultJobOptions} inherits BullMQ `attempts` + exponential `backoff`, so retry is a
 * platform-wide invariant instead of something each enqueue site has to remember.
 */
export interface QueueRetryPolicy {
  /** Total delivery attempts (initial + retries). 1 disables retries. */
  attempts: number;
  /** First backoff delay in ms; BullMQ doubles it per attempt (exponential). */
  backoffDelayMs: number;
  /** Completed jobs kept for inspection. A number caps the retained window. */
  removeOnComplete: number | boolean;
  /** Failed jobs kept until they are moved to the dead-letter queue. */
  removeOnFail: number | boolean;
}

export const DEFAULT_RETRY_POLICY: QueueRetryPolicy = {
  attempts: 3,
  backoffDelayMs: 5_000,
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
};

/**
 * Per-queue policy overrides. Only queues that must differ from the default appear here; the
 * lookup in {@link defaultJobOptions} falls back to {@link DEFAULT_RETRY_POLICY}.
 */
export const QUEUE_RETRY_POLICIES: Partial<Record<QueueName, QueueRetryPolicy>> = {
  // Real-time transports: retry a handful of times, and keep failures long enough for operators
  // to inspect before the dead-letter sweep has moved them on.
  [QUEUE_NAMES.EMAILS]: { attempts: 5, backoffDelayMs: 10_000, removeOnComplete: 1_000, removeOnFail: 5_000 },
  [QUEUE_NAMES.SMS]: { attempts: 5, backoffDelayMs: 10_000, removeOnComplete: 1_000, removeOnFail: 5_000 },
  [QUEUE_NAMES.WHATSAPP]: { attempts: 5, backoffDelayMs: 10_000, removeOnComplete: 1_000, removeOnFail: 5_000 },
  // Document/PDF rendering is CPU-bound and deterministic; two retries are enough.
  [QUEUE_NAMES.PDF_GENERATION]: { attempts: 3, backoffDelayMs: 3_000, removeOnComplete: 1_000, removeOnFail: 5_000 },
  [QUEUE_NAMES.CERTIFICATE_GENERATION]: { attempts: 3, backoffDelayMs: 3_000, removeOnComplete: 1_000, removeOnFail: 5_000 },
  // Payment reconciliation must not hammer a gateway: fewer, slower attempts.
  [QUEUE_NAMES.PAYMENT_RECONCILIATION]: { attempts: 4, backoffDelayMs: 30_000, removeOnComplete: 500, removeOnFail: 5_000 },
  // Recurring sweeps are cheap to re-run and should not accumulate history.
  [QUEUE_NAMES.ANALYTICS_REFRESH]: { attempts: 2, backoffDelayMs: 60_000, removeOnComplete: 100, removeOnFail: 500 },
  [QUEUE_NAMES.WORKFLOW_ESCALATION]: { attempts: 2, backoffDelayMs: 60_000, removeOnComplete: 100, removeOnFail: 500 },
  [QUEUE_NAMES.SUBSCRIPTION_LIFECYCLE]: { attempts: 2, backoffDelayMs: 60_000, removeOnComplete: 100, removeOnFail: 500 },
  [QUEUE_NAMES.HELPDESK_SLA]: { attempts: 2, backoffDelayMs: 60_000, removeOnComplete: 100, removeOnFail: 500 },
  [QUEUE_NAMES.DOCUMENT_RETENTION]: { attempts: 2, backoffDelayMs: 60_000, removeOnComplete: 100, removeOnFail: 500 },
  [QUEUE_NAMES.INTEGRATION_SYNC]: { attempts: 2, backoffDelayMs: 60_000, removeOnComplete: 100, removeOnFail: 1_000 },
  // The dead-letter queue itself never fails into another dead-letter queue.
  [QUEUE_NAMES.DEAD_LETTER]: { attempts: 1, backoffDelayMs: 5_000, removeOnComplete: 5_000, removeOnFail: false },
};

/**
 * Build the BullMQ job options for a queue, mixing the centralized retry policy with any
 * per-enqueue overrides. Callers should spread this so a specific job can still raise `attempts`
 * or add a `delay`/`jobId` without losing the shared backoff contract.
 */
export function defaultJobOptions(queue: QueueName, overrides: JobsOptions = {}): JobsOptions {
  const policy = QUEUE_RETRY_POLICIES[queue] ?? DEFAULT_RETRY_POLICY;
  return {
    attempts: policy.attempts,
    backoff: { type: 'exponential', delay: policy.backoffDelayMs },
    removeOnComplete: policy.removeOnComplete,
    removeOnFail: policy.removeOnFail,
    ...overrides,
  };
}
