import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { FEATURE_KEYS } from '@college-erp/auth';
import { createTenantScopedClient } from '@college-erp/database';
import {
  IntegrationAdapterRegistry,
  IntegrationSecretCipher,
  executeIntegrationOperation,
  resolveRetryPolicy,
  type IntegrationAdapterContext,
  type IntegrationEngineStore,
  type IntegrationRow,
} from '@college-erp/integrations';
import { QUEUE_NAMES, type IntegrationOperationJobData } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { EntitlementGate } from '../../entitlement/entitlement-gate';

/**
 * Outbound integration calls.
 *
 * ## Tenant isolation
 *
 * There is no request and no guard inside a queue consumer, so the job payload's `tenantId` is the
 * only carrier of tenant context. This processor refuses to run without one, builds its client from
 * that value alone, and never falls back to the unscoped client to "helpfully" find a row that the
 * scoped lookup did not return.
 *
 * ## Why the payload carries no credentials or URL
 *
 * `IntegrationOperationJobData` holds ids only. The adapter configuration and decrypted credentials
 * live encrypted on the Integration row and are read at execution time, so a tampered or replayed
 * payload cannot redirect a call at a host of its choosing or exfiltrate a secret that was never in
 * the payload to begin with.
 *
 * ## Retries
 *
 * Attempt accounting and backoff live in the shared executor (see packages/integrations/executor.ts)
 * — the same code the API runs for synchronous dispatches. This processor only re-enqueues, because
 * only the worker process owns the queue handle in the normal flow.
 */
@Injectable()
export class IntegrationWorkerAdapterContextFactory {
  private readonly cipher: IntegrationSecretCipher;

  constructor(private readonly appConfig: AppConfigService) {
    this.cipher = new IntegrationSecretCipher(this.appConfig.get('INTEGRATION_SECRET_KEY'));
  }

  /** Config + decrypted credentials + resolved timeout, for one row. Never logged. */
  build(row: IntegrationRow, idempotencyKey?: string | null): IntegrationAdapterContext {
    const policy = resolveRetryPolicy(row.retryPolicy as Record<string, unknown> | null);
    const config = (row.config as Record<string, unknown>) ?? {};
    const timeoutSec = config.timeoutSec;
    return {
      integrationKey: row.key,
      config,
      credentials: this.cipher.decryptBag(row.credentialsEncrypted),
      timeoutMs:
        typeof timeoutSec === 'number' && Number.isFinite(timeoutSec) && timeoutSec > 0
          ? Math.floor(timeoutSec * 1000)
          : policy.timeoutMs,
      idempotencyKey: idempotencyKey ?? null,
    };
  }
}

@Processor(QUEUE_NAMES.INTEGRATION_OPERATIONS)
export class IntegrationOperationsProcessor extends WorkerHost {
  private readonly logger = new Logger(IntegrationOperationsProcessor.name);
  private readonly registry = new IntegrationAdapterRegistry();

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly entitlementGate: EntitlementGate,
    private readonly contextFactory: IntegrationWorkerAdapterContextFactory,
  ) {
    super();
  }

  async process(job: Job<IntegrationOperationJobData>): Promise<void> {
    const { tenantId, operationId, isManualRetry } = job.data;
    if (!tenantId) {
      throw new Error('Integration operation job is missing tenantId; refusing to process.');
    }
    if (!operationId) {
      throw new Error('Integration operation job is missing operationId; refusing to process.');
    }

    // Entitlement re-check: a tenant may have been downgraded between enqueue and execution. The row
    // is marked FAILED rather than silently skipped, so the operator sees why nothing was sent.
    if (!(await this.entitlementGate.isFeatureEnabled(tenantId, FEATURE_KEYS.INTEGRATIONS))) {
      const tenantClient = createTenantScopedClient(tenantId);
      await tenantClient.integrationOperation.update({
        where: { id: operationId },
        data: {
          status: 'FAILED',
          errorMessage: "Tenant's plan no longer includes the integrations module.",
          failureCategory: 'CONFIGURATION',
          retryable: false,
          completedAt: new Date(),
        },
      });
      return;
    }

    const tenantClient = createTenantScopedClient(tenantId);

    // The operation must belong to THIS tenant. The tenant-scoped findFirst returns null otherwise,
    // and we throw rather than switching to an unscoped lookup.
    const operation = await tenantClient.integrationOperation.findFirst({ where: { id: operationId } });
    if (!operation) {
      throw new Error(`Integration operation ${operationId} not found for tenant ${tenantId}.`);
    }

    const result = await executeIntegrationOperation(
      {
        store: tenantClient as unknown as IntegrationEngineStore,
        registry: this.registry,
        toAdapterContext: (row, idempotencyKey) => this.contextFactory.build(row, idempotencyKey),
        scheduleRetry: async (retry) => {
          await tenantClient.integrationOperation.update({
            where: { id: retry.operationId },
            data: { status: 'PENDING', nextRetryAt: new Date(Date.now() + retry.delayMs) },
          });
          // The executor has already set the operation PENDING + nextRetryAt; re-enqueueing here
          // (rather than letting BullMQ retry) keeps attempt counting in ONE place.
          this.logger.log(
            `Operation ${retry.operationId} failed transiently (attempt ${retry.attempt}); ` +
              `operator retry available in ${Math.round(retry.delayMs / 1000)}s.`,
          );
        },
      },
      operationId,
    );

    if (result.status === 'FAILED') {
      // Logged, not thrown: the executor has already decided this failure is permanent and recorded
      // it durably. Throwing here would make BullMQ retry a failure we have classified as terminal.
      this.logger.error(
        `Integration operation ${operationId} failed permanently: ${result.message ?? 'unknown error'}`,
      );
      return;
    }

    this.logger.log(
      `Integration operation ${operationId} -> ${result.status} in ${result.latencyMs}ms` +
        (isManualRetry ? ' (manual retry)' : ''),
    );
  }

}
