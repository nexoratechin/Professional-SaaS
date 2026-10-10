import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { FEATURE_KEYS } from '@college-erp/auth';
import {
  createTenantScopedClient,
  platformPrismaClient,
  type IntegrationSyncRecordStatus,
  type Prisma,
  type TenantScopedPrismaClient,
} from '@college-erp/database';
import {
  IntegrationAdapterError,
  IntegrationAdapterRegistry,
  categorySupports,
  classifyIntegrationFailure,
  contentHash,
  countPushOutcomes,
  decideRecordChanges,
  deriveRunStatus,
  emptyCounters,
  healthFromSyncStatus,
  redactForLog,
  shouldContinueSync,
  truncateResponse,
  type ClassifiedFailure,
  type IntegrationAdapterContext,
  type PullPage,
} from '@college-erp/integrations';
import { processorOptions } from '@college-erp/queue';
import { QUEUE_NAMES } from '@college-erp/types';
import { EntitlementGate } from '../../entitlement/entitlement-gate';
import { IntegrationWorkerAdapterContextFactory } from './integration-operations.processor';

const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 1_000;
/**
 * Hard bound on pages per run. This loop runs unattended against third-party systems, and a provider
 * that keeps claiming `hasMore` would otherwise be pulled forever — turning a maintenance sweep into
 * a load generator pointed at a customer's vendor.
 */
const MAX_PAGES_PER_RUN = 50;
/** Wall-clock budget for one run. Exceeding it stops cleanly and leaves the cursor for the next run. */
const RUN_TIME_BUDGET_MS = 15 * 60_000;

type TenantClient = TenantScopedPrismaClient;

/**
 * Synchronization runs.
 *
 * Handles two job kinds on the same queue: `run` (one specific IntegrationSyncRun, queued by the API
 * when an operator or a webhook triggers a sync) and `sweep` (the recurring cross-tenant pass that
 * finds every ACTIVE integration with a periodic sync configured and starts one).
 *
 * The sweep follows the established cross-tenant convention in this worker: read through the
 * unscoped platform client to FIND candidates, then do every mutation through a client built from
 * that candidate's own tenantId.
 */
@Processor(QUEUE_NAMES.INTEGRATION_SYNC, processorOptions(QUEUE_NAMES.INTEGRATION_SYNC))
export class IntegrationSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(IntegrationSyncProcessor.name);
  private readonly registry = new IntegrationAdapterRegistry();

  constructor(
    private readonly entitlementGate: EntitlementGate,
    private readonly contextFactory: IntegrationWorkerAdapterContextFactory,
    @InjectQueue(QUEUE_NAMES.INTEGRATION_SYNC) private readonly queue: Queue,
  ) {
    super();
  }

  async process(
    job: Job<{ tenantId?: string; integrationId?: string; syncRunId?: string; entityType?: string; mode?: string }>,
  ): Promise<void> {
    if (job.name === 'sweep') {
      await this.sweep();
      return;
    }

    const { tenantId, syncRunId } = job.data;
    if (!tenantId) {
      throw new Error('Integration sync job is missing tenantId; refusing to process.');
    }

    if (!(await this.entitlementGate.isFeatureEnabled(tenantId, FEATURE_KEYS.INTEGRATIONS))) {
      this.logger.warn(
        `Tenant ${tenantId} no longer holds the integrations entitlement; skipping sync ${syncRunId ?? 'sweep run'}.`,
      );
      return;
    }

    if (syncRunId) {
      await this.executeRun(
        tenantId,
        syncRunId,
        job.data.entityType,
        (job.data.mode as 'PULL_SYNC' | 'PUSH_SYNC') ?? 'PULL_SYNC',
      );
      return;
    }

    // Queued by the sweep with an integrationId but no run id: create the run row here so the sweep
    // itself stays a cheap "decide what to run" pass with no tenant-scoped writes of its own.
    if (!job.data.integrationId) {
      throw new Error('Integration sync job is missing both syncRunId and integrationId; refusing to process.');
    }
    await this.startRunForIntegration(tenantId, job.data.integrationId, job.data.entityType ?? 'unknown');
  }

  /** Creates the IntegrationSyncRun for a sweep-discovered integration, then executes it inline.
   *
   * Run state is created HERE rather than in the sweep so the run's own tenantId is the only tenant
   * context involved in writing it — the sweep stays cross-tenant read-only by construction. */
  private async startRunForIntegration(tenantId: string, integrationId: string, entityType: string): Promise<void> {
    const tenantClient = createTenantScopedClient(tenantId);
    const integration = await tenantClient.integration.findFirst({ where: { id: integrationId } });
    if (!integration || integration.status !== 'ACTIVE') {
      return;
    }
    if (!categorySupports(integration.category, 'PULL_SYNC')) {
      return;
    }

    const run = await tenantClient.integrationSyncRun.create({
      data: {
        tenantId,
        integrationId,
        direction: 'INBOUND',
        status: 'PENDING',
        trigger: 'SCHEDULED',
        scope: { entityType },
        cursorBefore: integration.syncCursor,
      },
    });
    await this.executeRun(tenantId, run.id, entityType, 'PULL_SYNC');
  }

  /**
   * Finds every integration that asks for periodic sync and queues one run per tenant.
   *
   * Candidates are found platform-wide but each run is enqueued WITH its tenantId, so the actual work
   * still happens inside a tenant-scoped client — the sweep only decides *what* to run.
   */
  private async sweep(): Promise<void> {
    const candidates = await platformPrismaClient.integration.findMany({
      where: { status: 'ACTIVE', direction: { in: ['INBOUND', 'BIDIRECTIONAL'] } },
      select: {
        id: true,
        tenantId: true,
        key: true,
        category: true,
        config: true,
      },
    });

    let queued = 0;
    for (const candidate of candidates) {
      const config = (candidate.config as Record<string, unknown>) ?? {};
      // The schedule lives in the integration's own config, so a tenant opts in per connection
      // without any platform-wide setting.
      const everyMinutes = config.syncEveryMinutes;
      if (typeof everyMinutes !== 'number' || !Number.isFinite(everyMinutes) || everyMinutes <= 0) {
        continue;
      }
      const entityType = typeof config.syncEntityType === 'string' ? config.syncEntityType : null;
      if (!entityType) continue;
      if (!categorySupports(candidate.category, 'PULL_SYNC')) continue;

      // Already-running run for this integration: skip rather than pile up. A slow provider plus a
      // short interval would otherwise stack runs against the same vendor.
      const existing = await platformPrismaClient.integrationSyncRun.findFirst({
        where: { integrationId: candidate.id, status: { in: ['PENDING', 'RUNNING'] } },
        select: { id: true },
      });
      if (existing) continue;

      await this.queue.add(
        'run',
        { tenantId: candidate.tenantId, integrationId: candidate.id, entityType, mode: 'PULL_SYNC' },
        {
          attempts: 1,
          removeOnComplete: 1_000,
          removeOnFail: 5_000,
          // One run per integration per interval, enforced by a deterministic jobId.
          jobId: `integration-sync:${candidate.id}`,
          delay: Math.floor(everyMinutes * 60_000),
        },
      );
      queued += 1;
    }

    this.logger.log(`Integration sync sweep: ${candidates.length} candidate(s), ${queued} run(s) queued.`);
  }

  // ── Run execution ───────────────────────────────────────────────────────────

  private async executeRun(
    tenantId: string,
    runId: string,
    entityType: string | undefined,
    mode: 'PULL_SYNC' | 'PUSH_SYNC',
  ): Promise<void> {
    const tenantClient = createTenantScopedClient(tenantId);
    const run = await tenantClient.integrationSyncRun.findFirst({ where: { id: runId } });
    if (!run) {
      throw new Error(`Integration sync run ${runId} not found for tenant ${tenantId}.`);
    }
    if (run.status === 'CANCELED' || run.status === 'SUCCEEDED') {
      return;
    }

    const integration = await tenantClient.integration.findFirst({ where: { id: run.integrationId } });
    if (!integration) {
      await this.failRun(tenantClient, runId, tenantId, {
        category: 'CONFIGURATION',
        retryable: false,
        message: 'Integration no longer exists.',
      });
      return;
    }
    if (integration.status !== 'ACTIVE') {
      await this.failRun(tenantClient, runId, tenantId, {
        category: 'CONFIGURATION',
        retryable: false,
        message: `Integration is ${integration.status}; the run was not started.`,
      });
      return;
    }

    const scope = (run.scope as Record<string, unknown>) ?? {};
    const resolvedEntityType = entityType ?? String(scope.entityType ?? 'unknown');
    const pageSize = clampPageSize(scope.pageSize);
    const resolved = this.registry.resolve(integration.category, integration.provider);
    const ctx = this.contextFactory.build(integration as never);

    await tenantClient.integrationSyncRun.update({
      where: { id: runId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    let counters = emptyCounters();
    let completed = false;
    let failure: ClassifiedFailure | null = null;
    let cursor: string | null = run.cursorBefore;
    let hasMore = false;
    const deadline = Date.now() + RUN_TIME_BUDGET_MS;

    try {
      for (let page = 0; page < MAX_PAGES_PER_RUN; page += 1) {
        if (Date.now() > deadline) {
          this.logger.warn(`Sync run ${runId} stopped at its time budget; it resumes from its cursor next run.`);
          break;
        }
        // Re-read each page so an operator's cancel takes effect promptly rather than after a large
        // page finishes.
        const current = await tenantClient.integrationSyncRun.findUniqueOrThrow({
          where: { id: runId },
          select: { status: true },
        });
        if (current.status === 'CANCELED') break;

        const pageResult =
          mode === 'PULL_SYNC'
            ? await this.runPullPage({ tenantClient, tenantId, runId, integrationId: integration.id, entityType: resolvedEntityType, pageSize, cursor, ctx, resolved })
            : await this.runPushPage({ tenantClient, tenantId, runId, integrationId: integration.id, entityType: resolvedEntityType, cursor, ctx, resolved });

        counters = {
          attempted: counters.attempted + pageResult.attempted,
          succeeded: counters.succeeded + pageResult.succeeded,
          failed: counters.failed + pageResult.failed,
          skipped: counters.skipped + pageResult.skipped,
        };
        cursor = pageResult.nextCursor;
        hasMore = pageResult.hasMore;

        // Written every page, not at the end: a crash at page 30 of 50 must resume at page 31.
        await tenantClient.integrationSyncRun.update({
          where: { id: runId },
          data: { ...counters, cursorAfter: cursor, hasMore },
        });

        if (!shouldContinueSync(deriveRunStatus(counters, { completed: true }), pageResult.hasMore)) {
          completed = true;
          break;
        }
      }
    } catch (error) {
      failure = classifySyncFailure(error);
      this.logger.error(`Sync run ${runId} aborted: ${failure.message}`);
    }

    const status = failure ? 'FAILED' : deriveRunStatus(counters, { completed: completed || !hasMore, hasMore });

    await tenantClient.integrationSyncRun.update({
      where: { id: runId },
      data: {
        status,
        ...counters,
        cursorAfter: cursor,
        hasMore,
        finishedAt: new Date(),
        ...(failure ? { errorMessage: truncateResponse(failure.message) } : {}),
      },
    });

    if (failure) {
      await tenantClient.integrationFailure.create({
        data: {
          tenantId,
          integrationId: integration.id,
          syncRunId: runId,
          category: failure.category,
          retryable: failure.retryable,
          providerCode: failure.providerCode ?? null,
          message: truncateResponse(failure.message),
          details: redactForLog({ entityType: resolvedEntityType, counters }) as Prisma.InputJsonValue,
        },
      });
    }

    // PARTIAL is DEGRADED, not UNHEALTHY: a run that synced 940 of 1000 records must not page anyone.
    const health = healthFromSyncStatus(status);
    await tenantClient.integration.update({
      where: { id: integration.id },
      data: {
        healthStatus: health,
        lastSuccessAt: health === 'HEALTHY' ? new Date() : integration.lastSuccessAt,
        lastFailureAt: status === 'FAILED' ? new Date() : integration.lastFailureAt,
        lastErrorMessage: failure ? truncateResponse(failure.message) : null,
        // The durable cursor only advances when the run finished: persisting it from a failed run
        // would silently skip every record between that cursor and the point of failure, forever.
        ...(status === 'SUCCEEDED' || status === 'PARTIAL' ? { syncCursor: cursor } : {}),
      },
    });

    this.logger.log(
      `Integration sync run ${runId} -> ${status} (${counters.succeeded}/${counters.attempted} succeeded, ${counters.failed} failed).`,
    );
  }

  /**
   * One pull page. Change detection is what keeps this cheap: an unchanged record costs one hash
   * comparison instead of a write plus whatever downstream work a write implies.
   */
  private async runPullPage(input: {
    tenantClient: TenantClient;
    tenantId: string;
    runId: string;
    integrationId: string;
    entityType: string;
    pageSize: number;
    cursor: string | null;
    ctx: IntegrationAdapterContext;
    resolved: ReturnType<IntegrationAdapterRegistry['resolve']>;
  }): Promise<PageResult> {
    const pull = input.resolved.pullSync;
    if (!pull) {
      throw new IntegrationAdapterError('Resolved adapter does not implement pull().', {
        category: 'CONFIGURATION',
        retryable: false,
      });
    }

    const page: PullPage = await pull.pull(
      { entityType: input.entityType, cursor: input.cursor, limit: input.pageSize },
      input.ctx,
    );

    const externalIds = page.records.map((record) => record.externalId);
    const known = await input.tenantClient.integrationSyncRecord.findMany({
      where: { integrationId: input.integrationId, entityType: input.entityType, externalId: { in: externalIds } },
      select: { externalId: true, contentHash: true },
    });
    const decisions = decideRecordChanges(
      page,
      Object.fromEntries(known.map((row) => [row.externalId, row.contentHash])),
    );

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const record of page.records) {
      const decision = decisions.find((d) => d.externalId === record.externalId);
      try {
        if (decision && !decision.changed) {
          // Unchanged: refresh only the bookkeeping, no content write.
          skipped += 1;
          await this.upsertLedger(input, record.externalId, {
            status: 'IN_SYNC',
            contentHash: decision.contentHash,
          });
          continue;
        }
        await this.upsertLedger(input, record.externalId, {
          status: 'IN_SYNC',
          contentHash: decision?.contentHash ?? contentHash(record.payload),
          // Redacted before storage: a provider's record can carry PII or a token, and this column
          // is surfaced in the sync UI.
          payload: redactForLog(record.payload) as Prisma.InputJsonValue,
          syncedAt: new Date(),
        });
        succeeded += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : 'Unknown ledger write failure';
        await this.upsertLedger(input, record.externalId, {
          status: 'FAILED',
          errorMessage: truncateResponse(message),
        });
      }
    }

    return { attempted: page.records.length, succeeded, failed, skipped, nextCursor: page.nextCursor, hasMore: page.hasMore };
  }

  /** One push page: send ERP records out, then fold the provider's per-record outcomes into counters. */
  private async runPushPage(input: {
    tenantClient: TenantClient;
    tenantId: string;
    runId: string;
    integrationId: string;
    entityType: string;
    cursor: string | null;
    ctx: IntegrationAdapterContext;
    resolved: ReturnType<IntegrationAdapterRegistry['resolve']>;
  }): Promise<PageResult> {
    const push = input.resolved.pushSync;
    if (!push) {
      throw new IntegrationAdapterError('Resolved adapter does not implement push().', {
        category: 'CONFIGURATION',
        retryable: false,
      });
    }

    // The push source is the ledger: records already marked PENDING/FAILED are what a push sends.
    // A vendor-specific push shape lives in the adapter, keeping the framework vendor-neutral.
    const pending = await input.tenantClient.integrationSyncRecord.findMany({
      where: {
        integrationId: input.integrationId,
        entityType: input.entityType,
        status: { in: ['PENDING', 'FAILED'] },
      },
      orderBy: { updatedAt: 'asc' },
      take: DEFAULT_PAGE_SIZE,
    });

    if (pending.length === 0) {
      return { attempted: 0, succeeded: 0, failed: 0, skipped: 0, nextCursor: null, hasMore: false };
    }

    const outcomes = await push.push(
      {
        entityType: input.entityType,
        records: pending.map((row) => ({
          externalId: row.externalId,
          payload: { internalId: row.internalId, data: row.payload },
          // Per-record key: a partially-accepted batch can be retried without duplicating the records
          // the provider already took.
          idempotencyKey: `push:${row.id}`,
        })),
      },
      input.ctx,
    );

    const counters = countPushOutcomes(outcomes);
    for (const outcome of outcomes) {
      await this.upsertLedger(input, outcome.externalId, {
        status: outcome.ok ? 'IN_SYNC' : 'FAILED',
        ...(outcome.ok
          ? { syncedAt: new Date() }
          : { errorMessage: truncateResponse(outcome.error ?? 'Provider rejected the record.') }),
      });
    }

    // hasMore when the page was full: there is probably more PENDING/FAILED behind it.
    return { ...counters, nextCursor: null, hasMore: counters.attempted === pending.length };
  }

  /**
   * Upsert onto the ledger. The unique index on (integrationId, entityType, externalId) is the
   * idempotency guarantee — a second run updates the same row instead of duplicating the entity.
   */
  private async upsertLedger(
    input: {
      tenantClient: TenantClient;
      runId: string;
      integrationId: string;
      entityType: string;
      /** The run's own tenantId. Required on the create path because IntegrationSyncRecord carries a
       *  mandatory tenant_id (which is what makes the DMMF-derived tenant guard auto-scope it). */
      tenantId: string;
    },
    externalId: string,
    data: {
      status: IntegrationSyncRecordStatus;
      contentHash?: string;
      payload?: Prisma.InputJsonValue;
      errorMessage?: string;
      syncedAt?: Date;
    },
  ): Promise<void> {
    const existing = await input.tenantClient.integrationSyncRecord.findFirst({
      where: {
        integrationId: input.integrationId,
        entityType: input.entityType,
        externalId,
      },
      select: { id: true },
    });
    if (existing) {
      await input.tenantClient.integrationSyncRecord.update({ where: { id: existing.id }, data });
      return;
    }
    await input.tenantClient.integrationSyncRecord.create({
      data: {
        tenantId: input.tenantId,
        integrationId: input.integrationId,
        syncRunId: input.runId,
        entityType: input.entityType,
        externalId,
        ...data,
      },
    });
  }

  private async failRun(client: TenantClient, runId: string, tenantId: string, failure: ClassifiedFailure): Promise<void> {
    await client.integrationSyncRun.update({
      where: { id: runId },
      data: {
        status: 'FAILED',
        errorMessage: truncateResponse(failure.message),
        finishedAt: new Date(),
      },
    });
    await client.integrationFailure.create({
      data: {
        tenantId,
        syncRunId: runId,
        category: failure.category,
        retryable: failure.retryable,
        message: truncateResponse(failure.message),
      },
    });
  }

}

interface PageResult {
  attempted: number;
  succeeded: number;
  failed: number;
  skipped: number;
  nextCursor: string | null;
  hasMore: boolean;
}

function clampPageSize(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PAGE_SIZE;
  return Math.min(MAX_PAGE_SIZE, Math.floor(parsed));
}

function classifySyncFailure(error: unknown): ClassifiedFailure {
  if (error instanceof IntegrationAdapterError) {
    return {
      category: error.category,
      retryable: error.retryable,
      message: error.message,
      providerCode: error.providerCode ?? null,
    };
  }
  return classifyIntegrationFailure({ error });
}
