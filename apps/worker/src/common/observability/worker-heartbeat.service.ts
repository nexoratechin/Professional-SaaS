import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { hostname } from 'node:os';
import { recordWorkerHeartbeat, workerHeartbeatKey } from '@college-erp/observability';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { WORKER_REDIS_CLIENT } from './redis.constants';

/**
 * Publishes this replica's liveness into Redis every WORKER_HEARTBEAT_INTERVAL_MS:
 * `obs:worker:heartbeat:<host:pid>` = instance metadata, TTL WORKER_HEARTBEAT_TTL_SECONDS. The
 * API's readiness probe and `worker_offline` alert rule count live keys, so a crashed or wedged
 * worker disappears from the fleet within one TTL — no cleanup process required. The local
 * heartbeat gauge/timestamp feed the worker's own /metrics endpoint.
 */
@Injectable()
export class WorkerHeartbeatService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHeartbeatService.name);
  private readonly workerId = `${hostname()}:${process.pid}`;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: AppConfigService,
    @Inject(WORKER_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  get id(): string {
    return this.workerId;
  }

  onModuleInit(): void {
    const intervalMs = this.config.get('WORKER_HEARTBEAT_INTERVAL_MS');
    // TTL must comfortably exceed the write interval or a slow tick flips the fleet red.
    const ttlSeconds = Math.max(this.config.get('WORKER_HEARTBEAT_TTL_SECONDS'), Math.ceil(intervalMs / 1000) + 5);

    this.timer = setInterval(() => {
      void this.write(ttlSeconds);
    }, intervalMs);
    this.timer.unref();
    void this.write(ttlSeconds);

    this.logger.log(`Worker heartbeat started for ${this.workerId} (every ${intervalMs}ms, ttl ${ttlSeconds}s).`);
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    try {
      await this.redis.del(workerHeartbeatKey(this.workerId));
    } catch {
      // Losing the delete only costs one TTL of stale liveness.
    }
  }

  private async write(ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(
        workerHeartbeatKey(this.workerId),
        JSON.stringify({
          workerId: this.workerId,
          pid: process.pid,
          startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
        }),
        'EX',
        ttlSeconds,
      );
      recordWorkerHeartbeat(this.workerId);
    } catch (error) {
      this.logger.warn(`Heartbeat write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
