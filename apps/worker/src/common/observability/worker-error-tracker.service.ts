import { Inject, Injectable, Logger } from '@nestjs/common';
import { platformPrismaClient, type Prisma } from '@college-erp/database';
import {
  bumpWindow,
  createWebhookSink,
  ErrorTracker,
  WINDOW_COUNTERS,
  type TrackedErrorEvent,
} from '@college-erp/observability';
import type Redis from 'ioredis';
import { AppConfigService } from '../../config/app-config.service';
import { WORKER_REDIS_CLIENT } from './redis.constants';

/**
 * Worker-side error tracker. Same pipeline as the API's (webhook sink, Redis window bump,
 * deduplicated SystemErrorEvent persistence) with source=worker, so dead-letter moves, queue
 * event failures and process-level crashes all land in the same error ledger and alert window.
 */
@Injectable()
export class WorkerErrorTrackerService {
  private readonly logger = new Logger(WorkerErrorTrackerService.name);
  private readonly tracker: ErrorTracker;

  constructor(
    config: AppConfigService,
    @Inject(WORKER_REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.tracker = new ErrorTracker({
      source: 'worker',
      enabled: config.get('ERROR_TRACKING_ENABLED'),
    });

    const webhookUrl = config.get('ERROR_TRACKING_WEBHOOK_URL');
    if (webhookUrl) {
      this.tracker.addSink(createWebhookSink({ url: webhookUrl }));
    }

    this.tracker.addSink(() => {
      void bumpWindow(this.redis, WINDOW_COUNTERS.trackedErrors).catch(() => undefined);
    });

    if (config.get('ERROR_TRACKING_PERSIST')) {
      this.tracker.addSink((event) => this.persist(event));
    }
  }

  capture(error: unknown, context: Parameters<ErrorTracker['capture']>[1] = {}): TrackedErrorEvent | null {
    return this.tracker.capture(error, context);
  }

  private async persist(event: TrackedErrorEvent): Promise<void> {
    const common = {
      level: event.level,
      source: event.source,
      name: event.name,
      message: event.message,
      stack: event.stack ?? null,
      route: event.route ?? null,
      method: event.method ?? null,
      requestId: event.requestId ?? null,
      tenantId: event.tenantId ?? null,
      userId: event.userId ?? null,
    };
    const context = buildContextJson(event);
    try {
      await platformPrismaClient.systemErrorEvent.upsert({
        where: { fingerprint: event.fingerprint },
        create: {
          fingerprint: event.fingerprint,
          ...common,
          ...(context ? { context } : {}),
        },
        update: {
          ...common,
          ...(context ? { context } : {}),
          count: { increment: 1 },
          lastSeenAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to persist tracked error ${event.fingerprint}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function buildContextJson(event: TrackedErrorEvent): Prisma.InputJsonValue | undefined {
  const context: Record<string, unknown> = {
    ...(event.statusCode !== undefined ? { statusCode: event.statusCode } : {}),
    ...(event.path ? { path: event.path } : {}),
    ...(event.jobId ? { jobId: event.jobId } : {}),
    ...(event.queue ? { queue: event.queue } : {}),
    ...(event.context ?? {}),
  };
  return Object.keys(context).length > 0 ? (context as Prisma.InputJsonValue) : undefined;
}
