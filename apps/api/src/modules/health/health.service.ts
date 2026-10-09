import { Inject, Injectable } from '@nestjs/common';
import {
  probe,
  recordHealthCheck,
  recordRedisPing,
  setWorkersOnline,
  WORKER_HEARTBEAT_PREFIX,
  type ProbeResult,
} from '@college-erp/observability';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { StorageService } from '../../common/storage/storage.service';

export interface DependencyCheck {
  ok: boolean;
  latencyMs?: number;
  error?: string;
  /** A failing critical check makes readiness fail (HTTP 503); non-critical degrades only. */
  critical: boolean;
}

export interface WorkerFleetCheck {
  online: number;
  expected: number;
  ok: boolean;
}

export interface ReadinessReport {
  status: 'ok' | 'degraded' | 'down';
  checks: {
    database: DependencyCheck;
    redis: DependencyCheck;
    storage: DependencyCheck;
    worker: WorkerFleetCheck;
  };
  timestamp: string;
  version: string;
  uptimeSeconds: number;
}

/**
 * Dependency probes backing GET /health (liveness), GET /health/live and GET /health/ready.
 *
 * Semantics (Kubernetes conventions):
 *  - liveness  — is the process itself alive; performs NO dependency I/O, so a database outage can
 *    never trigger a restart storm.
 *  - readiness — can this process serve traffic: database and Redis are critical (503 when down),
 *    storage and the worker fleet degrade the report but keep the API in the load-balancer pool,
 *    because document/async features failing should not remove synchronous tenant traffic.
 *
 * Every probe is timeout-bounded, recorded into the metrics registry (health_status gauge +
 * latency histogram), and the worker fleet is counted from TTL'd Redis heartbeat keys written by
 * worker replicas.
 */
@Injectable()
export class HealthService {
  constructor(
    private readonly config: AppConfigService,
    private readonly platformPrisma: PlatformPrismaService,
    private readonly storage: StorageService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  live(): { status: 'ok'; version: string; uptimeSeconds: number; timestamp: string } {
    return {
      status: 'ok',
      version: process.env.APP_VERSION ?? 'dev',
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  async readiness(): Promise<ReadinessReport> {
    const timeoutMs = this.config.get('HEALTH_CHECK_TIMEOUT_MS');

    const [database, redisCheck, storage, worker] = await Promise.all([
      this.checkDatabase(timeoutMs),
      this.checkRedis(timeoutMs),
      this.checkStorage(timeoutMs),
      this.checkWorkerFleet(),
    ]);

    const criticalOk = database.ok && redisCheck.ok;
    const degraded = !storage.ok || !worker.ok;
    const status: ReadinessReport['status'] = !criticalOk ? 'down' : degraded ? 'degraded' : 'ok';

    return {
      status,
      checks: { database, redis: redisCheck, storage, worker },
      timestamp: new Date().toISOString(),
      version: process.env.APP_VERSION ?? 'dev',
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  private async checkDatabase(timeoutMs: number): Promise<DependencyCheck> {
    const result = await probe(
      () => this.platformPrisma.client.$queryRaw`SELECT 1`,
      timeoutMs,
      'database',
    );
    recordHealthCheck('database', result.ok, result.latencyMs);
    return toCheck(result, true);
  }

  private async checkRedis(timeoutMs: number): Promise<DependencyCheck> {
    const result = await probe(() => this.redis.ping(), timeoutMs, 'redis');
    recordRedisPing(result.latencyMs, result.ok);
    recordHealthCheck('redis', result.ok, result.latencyMs);
    return toCheck(result, true);
  }

  private async checkStorage(timeoutMs: number): Promise<DependencyCheck> {
    const result = await probe(() => this.storage.checkConnectivity(), Math.max(timeoutMs, 3_000), 'storage');
    recordHealthCheck('storage', result.ok, result.latencyMs);
    return toCheck(result, false);
  }

  /** Counts live heartbeat keys; no heartbeat system configured still reports expected replicas. */
  private async checkWorkerFleet(): Promise<WorkerFleetCheck> {
    const expected = this.config.get('WORKER_EXPECTED_REPLICAS');
    let online = 0;
    try {
      let cursor = '0';
      do {
        const [next, batch] = await this.redis.scan(cursor, 'MATCH', `${WORKER_HEARTBEAT_PREFIX}*`, 'COUNT', 200);
        cursor = next;
        online += batch.length;
      } while (cursor !== '0');
    } catch {
      online = 0;
    }
    setWorkersOnline(online, expected);
    // configured worker fleet of 0 disables the check entirely.
    const ok = expected === 0 || online > 0;
    recordHealthCheck('worker_fleet', ok, 0);
    return { online, expected, ok };
  }
}

function toCheck(result: ProbeResult, critical: boolean): DependencyCheck {
  return {
    ok: result.ok,
    latencyMs: Math.round(result.latencyMs * 100) / 100,
    ...(result.error ? { error: result.error } : {}),
    critical,
  };
}
