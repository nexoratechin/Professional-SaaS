import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { platformPrismaClient } from '@college-erp/database';
import { defaultRegistry, probe, recordHealthCheck, recordRedisPing } from '@college-erp/observability';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { WORKER_REDIS_CLIENT } from './redis.constants';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

interface JsonBody {
  [key: string]: unknown;
}

/**
 * The worker's Docker/Kubernetes-facing surface (default :3100, disabled by WORKER_HEALTH_ENABLED):
 *
 *   GET /health        — liveness + build info (no dependency I/O)
 *   GET /health/live   — alias of /health
 *   GET /health/ready  — PostgreSQL + Redis probes; 503 when either is down
 *   GET /metrics       — Prometheus text exposition (token-gated when METRICS_TOKEN is set)
 *
 * Deliberately plain node:http with zero controller machinery: the worker is an application
 * context with no HTTP stack, and adding one for probes would drag in platform-layer surface it
 * does not need.
 */
@Injectable()
export class WorkerHealthServerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerHealthServerService.name);
  private server?: Server;

  constructor(
    private readonly config: AppConfigService,
    private readonly heartbeat: WorkerHeartbeatService,
    @Inject(WORKER_REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('WORKER_HEALTH_ENABLED')) {
      this.logger.log('Worker health server disabled (WORKER_HEALTH_ENABLED=false).');
      return;
    }
    const port = this.config.get('WORKER_HEALTH_PORT');
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    this.server.on('error', (error) => {
      // A busy port must not take the worker down — jobs still process without probes.
      this.logger.error(`Worker health server error: ${error.message}`);
    });
    this.server.listen(port, () => {
      this.logger.log(`Worker health server listening on :${port} (/health, /health/ready, /metrics).`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => {
      this.server?.close(() => resolve());
    });
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const path = (request.url ?? '/').split('?', 1)[0] ?? '/';
    try {
      if (path === '/health' || path === '/health/live') {
        this.respondJson(response, 200, {
          status: 'ok',
          service: 'worker',
          version: process.env.APP_VERSION ?? 'dev',
          workerId: this.heartbeat.id,
          uptimeSeconds: Math.round(process.uptime()),
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (path === '/health/ready') {
        await this.readiness(response);
        return;
      }
      if (path === '/metrics') {
        this.metrics(request, response);
        return;
      }
      this.respondJson(response, 404, { statusCode: 404, error: 'Not Found' });
    } catch (error) {
      this.logger.warn(`Health request failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!response.headersSent) {
        this.respondJson(response, 500, { statusCode: 500, error: 'Internal Server Error' });
      }
    }
  }

  private async readiness(response: ServerResponse): Promise<void> {
    const timeoutMs = this.config.get('HEALTH_CHECK_TIMEOUT_MS');
    const [database, redis] = await Promise.all([
      probe(() => platformPrismaClient.$queryRaw`SELECT 1`, timeoutMs, 'database'),
      probe(() => this.redis.ping(), timeoutMs, 'redis'),
    ]);
    recordHealthCheck('database', database.ok, database.latencyMs);
    recordRedisPing(redis.latencyMs, redis.ok);
    recordHealthCheck('redis', redis.ok, redis.latencyMs);

    const ok = database.ok && redis.ok;
    this.respondJson(response, ok ? 200 : 503, {
      status: ok ? 'ok' : 'down',
      service: 'worker',
      checks: {
        database: { ok: database.ok, latencyMs: round2(database.latencyMs), ...(database.error ? { error: database.error } : {}) },
        redis: { ok: redis.ok, latencyMs: round2(redis.latencyMs), ...(redis.error ? { error: redis.error } : {}) },
      },
      timestamp: new Date().toISOString(),
    });
  }

  private metrics(request: IncomingMessage, response: ServerResponse): void {
    if (!this.config.get('METRICS_ENABLED')) {
      this.respondJson(response, 404, { statusCode: 404, error: 'Not Found' });
      return;
    }
    const token = this.config.get('METRICS_TOKEN');
    if (token) {
      const header = request.headers.authorization ?? '';
      const bearer = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
      const provided = bearer ?? (request.headers['x-metrics-token'] as string | undefined);
      if (provided !== token) {
        this.respondJson(response, 401, { statusCode: 401, error: 'Unauthorized' });
        return;
      }
    }
    response.writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' });
    response.end(defaultRegistry.render());
  }

  private respondJson(response: ServerResponse, status: number, body: JsonBody): void {
    const payload = JSON.stringify(body);
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
    response.end(payload);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
