import { Prisma, platformPrismaClient, type BackgroundJob, type BackgroundJobStatus } from '@college-erp/database';

export interface TrackEnqueuedInput {
  queue: string;
  name: string;
  bullJobId?: string | null;
  tenantId?: string | null;
  maxAttempts: number;
  /** Stable logical key; when present, re-enqueuing the same work reuses / revives the row. */
  idempotencyKey?: string | null;
  payload?: unknown;
}

export interface BackgroundJobFilter {
  queue?: string;
  status?: BackgroundJobStatus;
  tenantId?: string | null;
  take?: number;
  skip?: number;
}

/** JSON-safe conversion for Prisma's Json columns (drops undefined/functions/cycles). */
function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  } catch {
    return { unserializable: true } as Prisma.InputJsonValue;
  }
}

/**
 * Central job status/idempotency ledger. Control-plane data reached through the unscoped platform
 * client: `tenantId` is recorded for filtering/audit but is never used to scope the write (a
 * cross-tenant sweep legitimately has no tenant). This is a plain class (no Nest coupling) so both
 * apps/api's enqueue path and apps/worker's lifecycle listeners can share one implementation.
 */
export class BackgroundJobService {
  /** Record a job as enqueued. With an idempotency key this is an upsert, so a duplicate enqueue
   *  (same logical work) revives the existing row instead of creating a second one. */
  async trackEnqueued(input: TrackEnqueuedInput): Promise<BackgroundJob> {
    const payload = toJson(input.payload);
    if (input.tenantId === null || input.tenantId === undefined) {
      if (input.idempotencyKey) {
        return platformPrismaClient.backgroundJob.upsert({
          where: { queue_idempotencyKey: { queue: input.queue, idempotencyKey: input.idempotencyKey } },
          create: {
            queue: input.queue,
            name: input.name,
            bullJobId: input.bullJobId ?? null,
            tenantId: null,
            maxAttempts: input.maxAttempts,
            idempotencyKey: input.idempotencyKey,
            payload,
          },
          update: {
            name: input.name,
            bullJobId: input.bullJobId ?? null,
            maxAttempts: input.maxAttempts,
            status: 'QUEUED',
            attemptsMade: 0,
            error: null,
            finishedAt: null,
            payload,
          },
        });
      }
      return platformPrismaClient.backgroundJob.create({
        data: {
          queue: input.queue,
          name: input.name,
          bullJobId: input.bullJobId ?? null,
          tenantId: null,
          maxAttempts: input.maxAttempts,
          payload,
        },
      });
    }

    if (input.idempotencyKey) {
      return platformPrismaClient.backgroundJob.upsert({
        where: { queue_idempotencyKey: { queue: input.queue, idempotencyKey: input.idempotencyKey } },
        create: {
          queue: input.queue,
          name: input.name,
          bullJobId: input.bullJobId ?? null,
          tenantId: input.tenantId,
          maxAttempts: input.maxAttempts,
          idempotencyKey: input.idempotencyKey,
          payload,
        },
        update: {
          name: input.name,
          bullJobId: input.bullJobId ?? null,
          maxAttempts: input.maxAttempts,
          status: 'QUEUED',
          attemptsMade: 0,
          error: null,
          finishedAt: null,
          payload,
        },
      });
    }
    return platformPrismaClient.backgroundJob.create({
      data: {
        queue: input.queue,
        name: input.name,
        bullJobId: input.bullJobId ?? null,
        tenantId: input.tenantId,
        maxAttempts: input.maxAttempts,
        payload,
      },
    });
  }

  /** Find the registry row for a logical job so an enqueue helper can detect a duplicate. */
  async findByIdempotencyKey(queue: string, idempotencyKey: string): Promise<BackgroundJob | null> {
    return platformPrismaClient.backgroundJob.findUnique({
      where: { queue_idempotencyKey: { queue, idempotencyKey } },
    });
  }

  async findByBullJob(queue: string, bullJobId: string): Promise<BackgroundJob | null> {
    return platformPrismaClient.backgroundJob.findFirst({ where: { queue, bullJobId } });
  }

  async markActive(queue: string, bullJobId: string | number, attemptsMade: number): Promise<void> {
    const id = String(bullJobId);
    await platformPrismaClient.backgroundJob.updateMany({
      where: { queue, bullJobId: id, startedAt: null },
      data: { startedAt: new Date() },
    });
    await platformPrismaClient.backgroundJob.updateMany({
      where: { queue, bullJobId: id },
      data: { status: 'ACTIVE', attemptsMade },
    });
  }

  async markCompleted(queue: string, bullJobId: string | number, result?: unknown): Promise<void> {
    await platformPrismaClient.backgroundJob.updateMany({
      where: { queue, bullJobId: String(bullJobId) },
      data: { status: 'COMPLETED', finishedAt: new Date(), error: null, result: toJson(result) },
    });
  }

  async markRetrying(queue: string, bullJobId: string | number, error: string, attemptsMade: number): Promise<void> {
    await platformPrismaClient.backgroundJob.updateMany({
      where: { queue, bullJobId: String(bullJobId) },
      data: { status: 'RETRYING', error: error.slice(0, 2_000), attemptsMade },
    });
  }

  async markFailed(queue: string, bullJobId: string | number, error: string, attemptsMade?: number): Promise<void> {
    await platformPrismaClient.backgroundJob.updateMany({
      where: { queue, bullJobId: String(bullJobId) },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: error.slice(0, 2_000),
        ...(attemptsMade === undefined ? {} : { attemptsMade }),
      },
    });
  }

  async markDeadLettered(queue: string, bullJobId: string | number, error: string, attemptsMade: number): Promise<void> {
    await platformPrismaClient.backgroundJob.updateMany({
      where: { queue, bullJobId: String(bullJobId) },
      data: { status: 'DEAD_LETTERED', finishedAt: new Date(), error: error.slice(0, 2_000), attemptsMade },
    });
  }

  async markCancelled(queue: string, bullJobId: string | number, reason?: string): Promise<void> {
    await platformPrismaClient.backgroundJob.updateMany({
      where: { queue, bullJobId: String(bullJobId) },
      data: { status: 'CANCELLED', finishedAt: new Date(), error: reason ?? null },
    });
  }

  async findById(id: string): Promise<BackgroundJob | null> {
    return platformPrismaClient.backgroundJob.findUnique({ where: { id } });
  }

  async listRecent(filter: BackgroundJobFilter = {}): Promise<BackgroundJob[]> {
    return platformPrismaClient.backgroundJob.findMany({
      where: {
        ...(filter.queue ? { queue: filter.queue } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(filter.take ?? 50, 200),
      skip: filter.skip ?? 0,
    });
  }

  async countsByStatus(queue?: string): Promise<Array<{ status: BackgroundJobStatus; count: number }>> {
    const grouped = await platformPrismaClient.backgroundJob.groupBy({
      by: ['status'],
      where: queue ? { queue } : undefined,
      _count: { _all: true },
    });
    return grouped.map((row) => ({ status: row.status, count: row._count._all }));
  }
}

/** Shared singleton — both apps talk to the same registry table. */
export const backgroundJobService = new BackgroundJobService();
