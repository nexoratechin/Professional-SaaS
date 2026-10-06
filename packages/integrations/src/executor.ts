/**
 * The execution engine shared by apps/api and apps/worker.
 *
 * ## Why this lives in the package rather than in one app
 *
 * An outbound call has exactly one correct implementation. If apps/api (for `synchronous: true`
 * dispatches) and apps/worker (for queued dispatches) each had their own copy, they would drift —
 * and the drift would show up as "the same operation behaves differently depending on how it was
 * queued", which is close to impossible to debug in production.
 *
 * Both processes therefore run THIS code. What differs between them is only *where the rows are
 * written*, so the engine is parameterised over a narrow store interface instead of a Prisma client:
 * each app passes its own tenant-scoped client. The engine never sees an unscoped client, so it
 * structurally cannot read across tenants.
 *
 * ## What the engine is responsible for
 *
 *  - flipping PENDING -> IN_PROGRESS -> SUCCEEDED/FAILED on the operation row;
 *  - classifying the outcome (via retry.ts) so terminal vs transient is decided once;
 *  - writing the immutable failure row;
 *  - maintaining Integration.healthStatus / consecutiveFailures;
 *  - asking the caller to re-enqueue with the computed backoff delay.
 *
 * It deliberately does NOT decide how to re-enqueue: the API has a BullMQ queue injected, the worker
 * does not, and only the API enqueues in the normal flow.
 */

import type { IntegrationAdapterRegistry } from './registry';
import { redactForLog, truncateResponse } from './redact';
import {
  classifyIntegrationFailure,
  computeBackoffDelayMs,
  resolveRetryPolicy,
  shouldRetry,
  type ClassifiedFailure,
} from './retry';
import { IntegrationAdapterError, type IntegrationAdapterContext } from './types';
// Deliberately NOT importing from './index': this module is itself re-exported there, so an index
// import would make the barrel a cyclic dependency and pull the whole package in for one symbol.

/** The subset of a tenant-scoped Prisma client this engine uses. Structurally typed so the package
 *  stays free of a Prisma dependency. */
export interface IntegrationEngineStore {
  integrationOperation: {
    findFirst(args: { where: { id: string } }): Promise<IntegrationOperationRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  integration: {
    findFirst(args: { where: { id: string } }): Promise<IntegrationRow | null>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
  integrationFailure: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  $transaction<T>(fn: (tx: IntegrationEngineStore) => Promise<T>): Promise<T>;
}

export interface IntegrationOperationRow {
  id: string;
  tenantId: string;
  integrationId: string;
  operation: string;
  status: string;
  attempt: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  request: unknown;
}

export interface IntegrationRow {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  category: string;
  provider: string;
  status: string;
  config: unknown;
  credentialsEncrypted: string | null;
  retryPolicy: unknown;
  syncCursor: string | null;
  lastSuccessAt: Date | null;
  lastLatencyMs: number | null;
  consecutiveFailures: number;
}

/** Consecutive failures before a connection is called UNHEALTHY rather than DEGRADED. */
const UNHEALTHY_AFTER = 5;

export interface IntegrationEngineDeps {
  store: IntegrationEngineStore;
  registry: IntegrationAdapterRegistry;
  /** Builds the adapter context (config + decrypted credentials + resolved timeout). */
  toAdapterContext: (row: IntegrationRow, idempotencyKey?: string | null) => IntegrationAdapterContext;
  /**
   * Called when a transient failure should be retried. The API implements this by adding a delayed
   * job; a caller that does not want automatic retry can omit it (the operation stays PENDING and
   * an operator can re-dispatch it from the UI).
   */
  scheduleRetry?: (input: {
    operationId: string;
    tenantId: string;
    integrationId: string;
    attempt: number;
    idempotencyKey: string | null;
    delayMs: number;
    /** True when the attempt was re-dispatched by an operator rather than by the backoff itself. */
    isManualRetry?: boolean;
  }) => Promise<void>;
}

export interface ExecuteOperationResult {
  operationId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING' | 'SKIPPED';
  providerReference?: string | null;
  latencyMs: number;
  message?: string | null;
  failure?: ClassifiedFailure | null;
}

/**
 * Performs one attempt of a queued operation and records the outcome.
 *
 * Idempotent under at-least-once delivery: a terminal SUCCEEDED operation is returned untouched, so
 * a duplicate job cannot call the provider (and therefore cannot double-charge a card) a second time.
 */
export async function executeIntegrationOperation(
  deps: IntegrationEngineDeps,
  operationId: string,
): Promise<ExecuteOperationResult> {
  const { store } = deps;

  const operation = await store.integrationOperation.findFirst({ where: { id: operationId } });
  if (!operation) {
    throw new Error(`Integration operation ${operationId} not found.`);
  }
  if (operation.status === 'SUCCEEDED') {
    // Duplicate delivery of an already-completed job. Returning SKIPPED keeps the caller's log
    // honest ("we did not do anything this time") without pretending it failed.
    return { operationId, status: 'SKIPPED', latencyMs: 0, message: 'Already completed.' };
  }

  const integration = await store.integration.findFirst({ where: { id: operation.integrationId } });
  if (!integration) {
    throw new Error(`Integration ${operation.integrationId} not found for operation ${operationId}.`);
  }

  // The integration may have been disabled while the job sat in the queue. Refusing here is what
  // makes "disable" a real kill switch rather than a suggestion.
  if (integration.status !== 'ACTIVE') {
    await store.integrationOperation.update({
      where: { id: operationId },
      data: {
        status: 'FAILED',
        errorMessage: `Integration is ${integration.status}; the operation was not sent.`,
        failureCategory: 'CONFIGURATION',
        retryable: false,
        completedAt: new Date(),
      },
    });
    return {
      operationId,
      status: 'FAILED',
      latencyMs: 0,
      failure: { category: 'CONFIGURATION', retryable: false, message: `Integration is ${integration.status}.` },
    };
  }

  const attempt = operation.attempt + 1;
  const policy = resolveRetryPolicy(integration.retryPolicy as Record<string, unknown> | null);
  await store.integrationOperation.update({ where: { id: operationId }, data: { status: 'IN_PROGRESS', attempt } });

  const ctx = deps.toAdapterContext(integration, operation.idempotencyKey);
  const startedAt = Date.now();

  try {
    const resolved = deps.registry.resolve(integration.category, integration.provider);
    const result = await resolved.adapter.execute(
      operation.operation,
      (operation.request as Record<string, unknown>) ?? {},
      ctx,
    );
    const latencyMs = Date.now() - startedAt;

    await store.$transaction(async (tx) => {
      await tx.integrationOperation.update({
        where: { id: operationId },
        data: {
          status: 'SUCCEEDED',
          response: redactForLog(result.response) as never,
          latencyMs,
          errorMessage: null,
          failureCategory: null,
          retryable: false,
          nextRetryAt: null,
          completedAt: new Date(),
        },
      });
      await tx.integration.update({
        where: { id: integration.id },
        data: {
          lastSuccessAt: new Date(),
          lastLatencyMs: latencyMs,
          lastErrorMessage: null,
          // One success clears the counter: keeping a stale failure count would leave a recovered
          // integration permanently DEGRADED.
          consecutiveFailures: 0,
          healthStatus: 'HEALTHY',
        },
      });
    });

    return {
      operationId,
      status: 'SUCCEEDED',
      providerReference: result.providerReference ?? null,
      latencyMs,
      message: result.message ?? null,
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const failure = classifyAdapterFailure(error);
    const willRetry = shouldRetry(failure, policy, attempt);
    const delayMs = willRetry ? computeBackoffDelayMs(policy, attempt) : 0;

    await recordFailure({
      store,
      operation,
      integration,
      failure,
      latencyMs,
      attempt,
      willRetry,
      nextRetryAt: willRetry ? new Date(Date.now() + delayMs) : null,
    });

    if (willRetry && deps.scheduleRetry) {
      await deps.scheduleRetry({
        operationId,
        tenantId: integration.tenantId,
        integrationId: integration.id,
        attempt,
        idempotencyKey: operation.idempotencyKey,
        delayMs,
        // A manual retry that is itself about to be retried automatically stays automatic from here:
        // the operator asked for one attempt, and the classification now asks for more.
        isManualRetry: false,
      });
    }

    return {
      operationId,
      status: willRetry ? 'PENDING' : 'FAILED',
      latencyMs,
      message: failure.message,
      failure,
    };
  }
}

/**
 * Writes the immutable failure row plus the operation/health updates, in one transaction.
 *
 * The failure row is written even when a retry is coming: "this failed twice before it worked" is
 * exactly what an operator needs, and a log that only shows the final success hides a flapping
 * integration.
 */
async function recordFailure(input: {
  store: IntegrationEngineStore;
  operation: IntegrationOperationRow;
  integration: IntegrationRow;
  failure: ClassifiedFailure;
  latencyMs: number;
  attempt: number;
  willRetry: boolean;
  nextRetryAt: Date | null;
}): Promise<void> {
  const { store, operation, integration, failure } = input;
  await store.$transaction(async (tx) => {
    await tx.integrationOperation.update({
      where: { id: operation.id },
      data: {
        status: input.willRetry ? 'PENDING' : 'FAILED',
        errorMessage: truncateResponse(failure.message),
        failureCategory: failure.category,
        retryable: failure.retryable,
        nextRetryAt: input.nextRetryAt,
        latencyMs: input.latencyMs,
        ...(input.willRetry ? {} : { completedAt: new Date() }),
      },
    });

    await tx.integrationFailure.create({
      data: {
        tenantId: integration.tenantId,
        integrationId: integration.id,
        operationId: operation.id,
        category: failure.category,
        retryable: failure.retryable,
        providerCode: failure.providerCode ?? null,
        message: truncateResponse(failure.message),
        details: redactForLog({ attempt: input.attempt, latencyMs: input.latencyMs }) as never,
      },
    });

    // Degrade rather than flip: one transient 503 should not look like a dead integration, but a
    // sustained run of them should.
    const consecutiveFailures = integration.consecutiveFailures + 1;
    await tx.integration.update({
      where: { id: integration.id },
      data: {
        lastFailureAt: new Date(),
        lastErrorMessage: truncateResponse(failure.message),
        lastLatencyMs: input.latencyMs,
        consecutiveFailures,
        healthStatus: consecutiveFailures >= UNHEALTHY_AFTER ? 'UNHEALTHY' : 'DEGRADED',
      },
    });
  });
}

/**
 * An `IntegrationAdapterError` already carries a category, because an adapter that knows better than
 * the status-code heuristic (a provider-specific 409 meaning "already processed") must be able to say
 * so. Everything else goes through the shared heuristic.
 */
export function classifyAdapterFailure(error: unknown): ClassifiedFailure {
  if (error instanceof IntegrationAdapterError) {
    return {
      category: error.category,
      retryable: error.retryable,
      message: error.message,
      providerCode: error.providerCode ?? (error.status ? String(error.status) : null),
    };
  }
  return classifyIntegrationFailure({ error });
}
