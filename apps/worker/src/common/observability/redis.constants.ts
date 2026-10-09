/** DI token for the worker's own ioredis connection (heartbeat writes, window counters, probes).
 *  Kept separate from BullMQ's internal connections so health instrumentation never contends with
 *  job processing sockets. */
export const WORKER_REDIS_CLIENT = 'WORKER_REDIS_CLIENT';
