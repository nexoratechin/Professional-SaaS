import { QUEUE_NAMES } from '@college-erp/types';
import { DEFAULT_RETRY_POLICY, QUEUE_RETRY_POLICIES, defaultJobOptions } from './queue-options';

describe('defaultJobOptions', () => {
  it('applies the centralized default retry policy', () => {
    const options = defaultJobOptions(QUEUE_NAMES.DATA_IMPORTS);
    expect(options.attempts).toBe(DEFAULT_RETRY_POLICY.attempts);
    expect(options.backoff).toEqual({ type: 'exponential', delay: DEFAULT_RETRY_POLICY.backoffDelayMs });
    expect(options.removeOnComplete).toBe(DEFAULT_RETRY_POLICY.removeOnComplete);
    expect(options.removeOnFail).toBe(DEFAULT_RETRY_POLICY.removeOnFail);
  });

  it('uses a per-queue policy override when one is defined', () => {
    const options = defaultJobOptions(QUEUE_NAMES.EMAILS);
    expect(options.attempts).toBe(QUEUE_RETRY_POLICIES[QUEUE_NAMES.EMAILS]?.attempts);
    expect(options.backoff).toEqual({
      type: 'exponential',
      delay: QUEUE_RETRY_POLICIES[QUEUE_NAMES.EMAILS]?.backoffDelayMs,
    });
  });

  it('lets a caller override fields without losing the shared backoff contract', () => {
    const options = defaultJobOptions(QUEUE_NAMES.REPORT_EXPORTS, { jobId: 'report-123', delay: 500 });
    expect(options.jobId).toBe('report-123');
    expect(options.delay).toBe(500);
    expect(options.backoff).toEqual({ type: 'exponential', delay: DEFAULT_RETRY_POLICY.backoffDelayMs });
  });

  it('never retries the dead-letter queue into itself', () => {
    expect(QUEUE_RETRY_POLICIES[QUEUE_NAMES.DEAD_LETTER]?.attempts).toBe(1);
  });
});
