import { QUEUE_NAMES } from '@college-erp/types';
import {
  DEFAULT_QUEUE_CONCURRENCY,
  DEFAULT_RETRY_POLICY,
  QUEUE_RETRY_POLICIES,
  defaultJobOptions,
  processorOptions,
} from './queue-options';

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

describe('processorOptions', () => {
  afterEach(() => {
    delete process.env.WORKER_QUEUE_CONCURRENCY;
    delete process.env.WORKER_CONCURRENCY_EMAILS;
  });

  it('applies a per-queue default concurrency greater than 1 for high-fan-out queues', () => {
    expect(processorOptions(QUEUE_NAMES.EMAILS).concurrency).toBe(DEFAULT_QUEUE_CONCURRENCY[QUEUE_NAMES.EMAILS]);
    expect(processorOptions(QUEUE_NAMES.SMS).concurrency).toBeGreaterThan(1);
    expect(processorOptions(QUEUE_NAMES.REPORT_EXPORTS).concurrency).toBeGreaterThan(1);
  });

  it('falls back to 1 for queues with no configured concurrency', () => {
    expect(processorOptions(QUEUE_NAMES.DEAD_LETTER).concurrency).toBe(1);
  });

  it('honours a global override', () => {
    process.env.WORKER_QUEUE_CONCURRENCY = '7';
    expect(processorOptions(QUEUE_NAMES.EMAILS).concurrency).toBe(7);
  });

  it('lets a per-queue override win over the global one', () => {
    process.env.WORKER_QUEUE_CONCURRENCY = '7';
    process.env.WORKER_CONCURRENCY_EMAILS = '33';
    expect(processorOptions(QUEUE_NAMES.EMAILS).concurrency).toBe(33);
  });

  it('ignores invalid overrides and clamps absurd ones', () => {
    process.env.WORKER_QUEUE_CONCURRENCY = 'not-a-number';
    expect(processorOptions(QUEUE_NAMES.EMAILS).concurrency).toBe(DEFAULT_QUEUE_CONCURRENCY[QUEUE_NAMES.EMAILS]);
    process.env.WORKER_QUEUE_CONCURRENCY = '100000';
    expect(processorOptions(QUEUE_NAMES.EMAILS).concurrency).toBe(100);
  });
});
