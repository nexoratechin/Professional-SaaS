/**
 * Outbound operation dispatch — the write path for IntegrationOperation.
 *
 * ## Why every outbound call goes through the queue
 *
 * A provider call is slow and unreliable by nature. Doing it inline in an HTTP request means a
 * hanging vendor holds a connection, a client, and a Nest event-loop slot, and the caller learns
 * about it only by timing out themselves. Instead: create the operation row PENDING, enqueue, and
 * return. The row is the durable record; the queue is only the transport.
 *
 * ## Why this does not re-implement "how to call a provider"
 *
 * `execute()` delegates to `executeIntegrationOperation` in @college-erp/integrations — literally the
 * same function apps/worker's IntegrationOperationsProcessor runs. Two copies would drift, and the
 * drift would surface as "the same operation behaves differently depending on how it was queued",
 * which is close to impossible to debug in production. This service's job is to *create* work; the
 * shared engine's job is to *do* it.
 *
 * ## Idempotency
 *
 * A caller-supplied `idempotencyKey` is the single most important safety property here: after an
 * ambiguous timeout (the request may have succeeded), the retry must not double-charge a card or
 * double-create a vendor invoice. When absent we derive a deterministic key from the integration +
 * operation, so at least the retries of one dispatch stay identical.
 */

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { createHash } from 'crypto';
import {
  IntegrationAdapterRegistry,
  executeIntegrationOperation,
  redactForLog,
  resolveRetryPolicy,
  type IntegrationEngineStore,
} from '@college-erp/integrations';
import { QUEUE_NAMES, type IntegrationOperationJobData } from '@college-erp/types';
import type { Prisma } from '@college-erp/database';
import { AuditService } from '../audit/audit.service';
import { IntegrationsService } from './integrations.service';
import type { DispatchOperationDto } from './dto/integrations.dto';

/**
 * BullMQ job options. `attempts: 1` on purpose: attempt accounting and backoff are the shared
 * engine's job (it re-enqueues with the computed delay itself), so letting BullMQ also retry would
 * double-count attempts and could re-send a request that failed permanently — a wrong API key.
 */
const JOB_OPTIONS = {
  attempts: 1,
  removeOnComplete: 1_000,
  removeOnFail: 5_000,
} as const;

@Injectable()
export class IntegrationsDispatchService {
  constructor(
    private readonly integrationsService: IntegrationsService,
    private readonly registry: IntegrationAdapterRegistry,
    private readonly auditService: AuditService,
    @InjectQueue(QUEUE_NAMES.INTEGRATION_OPERATIONS)
    private readonly queue: Queue<IntegrationOperationJobData>,
  ) {}

  /**
   * Creates the operation row and enqueues it. Returns immediately with the PENDING row so the
   * caller has a handle to poll even when the provider takes minutes to respond.
   */
  async dispatch(integrationId: string, dto: DispatchOperationDto, tenantId: string, actorUserId?: string) {
    const integration = await this.integrationsService.requireIntegration(integrationId);

    if (integration.status !== 'ACTIVE') {
      // DRAFT/DISABLED integrations must not receive traffic. This is the single gate that makes
      // "configure it, test it, then switch it on" a safe workflow.
      throw new BadRequestException(
        `Integration "${integration.key}" is ${integration.status}; only ACTIVE integrations can dispatch.`,
      );
    }

    const idempotencyKey = dto.idempotencyKey ?? deriveIdempotencyKey(integrationId, dto.operation);

    // A duplicate idempotency key must return the ORIGINAL operation, not create a second one. This
    // is what makes a client retry safe after a network blip on the ERP's own response.
    const existing = await this.integrationsService.tenantClient.integrationOperation.findFirst({
      where: { integrationId, idempotencyKey },
    });
    if (existing) {
      return { ...existing, deduplicated: true };
    }

    const operation = await this.integrationsService.tenantClient.integrationOperation.create({
      data: {
        tenantId,
        integrationId,
        operation: dto.operation,
        status: 'PENDING',
        attempt: 0,
        maxAttempts: resolveRetryPolicy(
          integration.retryPolicy as Record<string, unknown> | null,
        ).maxAttempts,
        idempotencyKey,
        // Sanitized at write time, not at read time: a secret that reached this column would already
        // be in the database, and the log tables are read by far more people than the config form.
        request: redactForLog(dto.payload) as Prisma.InputJsonValue,
      },
    });

    if (actorUserId) {
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'USER',
        actorUserId,
        action: AUDIT_ACTIONS.INTEGRATION_OPERATION_RETRIED,
        module: AUDIT_MODULES.INTEGRATIONS,
        entityType: 'IntegrationOperation',
        entityId: operation.id,
        after: { integrationId, operation: dto.operation, queued: true },
      });
    }

    if (dto.synchronous) {
      // Explicitly requested by the caller (a "send test message" button). Still runs the shared
      // engine, so the outcome is recorded identically to a queued dispatch.
      await this.enqueue(operation.id, { tenantId, integrationId, attempt: 0 });
      return this.execute(operation.id);
    }

    await this.enqueue(operation.id, { tenantId, integrationId, attempt: 0 });
    return { ...operation, queued: true };
  }

  /**
   * Performs one attempt using the shared engine. Used only by the synchronous dispatch path — the
   * worker runs the very same engine through its own processor.
   */
  async execute(operationId: string) {
    await executeIntegrationOperation(
      {
        store: this.integrationsService.tenantClient as unknown as IntegrationEngineStore,
        registry: this.registry,
        toAdapterContext: (row, idempotencyKey) =>
          this.integrationsService.toAdapterContext(row as never, idempotencyKey),
        // The API owns this queue handle, so it is the process that re-enqueues a retry. The delay is
        // the backoff: a provider that is rate-limiting us must not be hammered.
        //
        // integrationId is carried in the job purely so the payload is self-describing; the processor
        // re-reads the operation row and uses ITS integrationId, so a stale value here is harmless.
        scheduleRetry: async (retry) => {
          await this.enqueue(retry.operationId, {
            tenantId: retry.tenantId,
            integrationId: retry.integrationId,
            attempt: retry.attempt,
            delayMs: retry.delayMs,
            isManualRetry: retry.isManualRetry,
          });
        },
      },
      operationId,
    );

    return this.integrationsService.tenantClient.integrationOperation.findUniqueOrThrow({
      where: { id: operationId },
    });
  }

  /** Operator-triggered retry from the UI: resets a terminal operation and enqueues it again. */
  async requeueOperation(
    operationId: string,
    options: { tenantId: string; isManualRetry?: boolean },
  ) {
    const operation = await this.integrationsService.tenantClient.integrationOperation.findFirst({
      where: { id: operationId },
    });
    if (!operation) {
      throw new NotFoundException('Integration operation not found.');
    }
    if (operation.status === 'IN_PROGRESS') {
      throw new BadRequestException('This operation is currently in progress.');
    }

    await this.integrationsService.tenantClient.integrationOperation.update({
      where: { id: operationId },
      data: { status: 'PENDING', nextRetryAt: null, completedAt: null, errorMessage: null },
    });
    await this.enqueue(operationId, {
      tenantId: options.tenantId,
      integrationId: operation.integrationId,
      attempt: 0,
      isManualRetry: true,
    });

    return this.integrationsService.tenantClient.integrationOperation.findUniqueOrThrow({
      where: { id: operationId },
    });
  }

  /**
   * Enqueues one attempt. The `jobId` encodes the attempt number, which is what prevents two
   * duplicate jobs for the same attempt from both calling the provider.
   */
  private async enqueue(
    operationId: string,
    options: {
      tenantId: string;
      integrationId: string;
      attempt: number;
      delayMs?: number;
      isManualRetry?: boolean;
    },
  ) {
    const data: IntegrationOperationJobData = {
      tenantId: options.tenantId,
      integrationId: options.integrationId,
      operationId,
      ...(options.isManualRetry ? { isManualRetry: true } : {}),
    };
    await this.queue.add('dispatch', data, {
      ...JOB_OPTIONS,
      jobId: `integration-operation:${operationId}:${options.attempt}`,
      ...(options.delayMs ? { delay: Math.max(0, options.delayMs) } : {}),
    });
  }
}

/**
 * Deterministic idempotency key when the caller supplies none. Derived from the integration +
 * operation only, so all retries of one dispatch share it — which is the property that matters. Two
 * genuinely distinct requests through this path would collide, which is why callers that need
 * separate work (a payment per invoice) MUST pass their own key.
 */
function deriveIdempotencyKey(integrationId: string, operation: string): string {
  return createHash('sha256').update(`${integrationId}:${operation}`).digest('hex').slice(0, 40);
}