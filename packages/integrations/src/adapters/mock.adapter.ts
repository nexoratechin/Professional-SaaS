/**
 * `mock` — the dev/test adapter.
 *
 * Two jobs:
 *
 *  1. Let the whole pipeline (dispatch → retry → operation log → failure log → health) be exercised
 *     end-to-end in CI and local development with no vendor account, no network and no secrets. The
 *     notification pipeline has the same `console` fallback; this is its integration-side analogue.
 *  2. Let an operator *prove* their ERP wiring before pointing it at production credentials.
 *
 * Failure simulation is config-driven rather than hard-coded so a QA environment can exercise the
 * retry path deterministically: set `mock.failUntilAttempt: 2` and the third call succeeds, which is
 * exactly the transient-then-recovered shape the retry policy exists for. Without that, the retry
 * code is only ever tested in theory.
 *
 * `mock.simulate: 'auth' | 'rate_limit' | 'timeout' | 'schema'` produces the corresponding failure
 * category so classification and the failure log can be verified too.
 */

import { IntegrationAdapterError } from '../types';
import { configBoolean, configNumber, configString, type ConnectionTester, type IntegrationAdapter, type IntegrationAdapterContext, type IntegrationAdapterResult, type IntegrationTestResult, type PullPage, type PullSynchronizer } from '../types';

export const MOCK_SIMULATIONS = ['auth', 'rate_limit', 'timeout', 'schema', 'network', 'rejected'] as const;
export type MockSimulation = (typeof MOCK_SIMULATIONS)[number];

export interface MockAdapterOptions {
  /** Injectable clock/attempt source so tests are deterministic. */
  now?: () => number;
}

export class MockAdapter implements IntegrationAdapter, ConnectionTester, PullSynchronizer {
  readonly name = 'mock';
  private readonly now: () => number;

  constructor(options: MockAdapterOptions = {}) {
    this.now = options.now ?? Date.now;
  }

  async execute(operation: string, payload: unknown, ctx: IntegrationAdapterContext): Promise<IntegrationAdapterResult> {
    const simulate = configString(ctx.config, 'mock.simulate', '') as MockSimulation | '';
    const attempt = configNumber(ctx.config, 'mock.attempt', 1);
    const failUntilAttempt = configNumber(ctx.config, 'mock.failUntilAttempt', 0);

    if (simulate === 'auth') {
      throw new IntegrationAdapterError('Mock: provider rejected the credentials (HTTP 401).', {
        category: 'AUTHENTICATION',
        retryable: false,
        status: 401,
      });
    }
    if (simulate === 'rejected') {
      throw new IntegrationAdapterError('Mock: provider rejected the request (HTTP 400).', {
        category: 'PROVIDER_REJECTED',
        retryable: false,
        status: 400,
        providerCode: 'mock_invalid_request',
      });
    }
    if (simulate === 'rate_limit') {
      throw new IntegrationAdapterError('Mock: provider rate limit reached (HTTP 429).', {
        category: 'RATE_LIMIT',
        retryable: true,
        status: 429,
        retryAfterMs: 1_000,
      });
    }
    if (simulate === 'timeout') {
      throw new IntegrationAdapterError('Mock: request to the provider timed out.', {
        category: 'TIMEOUT',
        retryable: true,
      });
    }
    if (simulate === 'network') {
      throw new IntegrationAdapterError('Mock: could not reach the provider.', {
        category: 'NETWORK',
        retryable: true,
      });
    }
    if (simulate === 'schema') {
      throw new IntegrationAdapterError('Mock: provider returned an unexpected response shape.', {
        category: 'SCHEMA',
        retryable: false,
        status: 200,
      });
    }

    if (attempt < failUntilAttempt) {
      throw new IntegrationAdapterError(
        `Mock: simulated transient failure on attempt ${attempt} (configured to fail until attempt ${failUntilAttempt}).`,
        { category: 'NETWORK', retryable: true, status: 503 },
      );
    }

    if (configBoolean(ctx.config, 'mock.requireToken', false) && !ctx.credentials.token) {
      throw new IntegrationAdapterError('Mock: a token credential is required but was not configured.', {
        category: 'CONFIGURATION',
        retryable: false,
      });
    }

    const reference =
      typeof (payload as { reference?: unknown })?.reference === 'string'
        ? String((payload as { reference: string }).reference)
        : null;

    return {
      providerReference: reference ?? `mock-${operation}-${this.now()}`,
      response: {
        mocked: true,
        operation,
        received: payload ?? null,
        at: new Date(this.now()).toISOString(),
      },
      message: 'Mock adapter: no real provider was contacted.',
    };
  }

  async testConnection(_ctx: IntegrationAdapterContext): Promise<IntegrationTestResult> {
    const startedAt = Date.now();
    return {
      ok: true,
      message: 'Mock adapter: the dispatch path is wired end-to-end, but no external system was contacted.',
      latencyMs: Math.max(0, Date.now() - startedAt),
      status: null,
      responseExcerpt: { mocked: true },
    };
  }

  /** Deterministic synthetic page, so sync can be demonstrated without a provider. */
  async pull(input: { entityType: string; cursor: string | null; limit: number }, _ctx: IntegrationAdapterContext): Promise<PullPage> {
    const offset = Number.parseInt(input.cursor ?? '0', 10) || 0;
    const size = Math.max(1, Math.min(input.limit, 10));
    const records = Array.from({ length: size }, (_, index) => {
      const n = offset + index;
      return {
        externalId: `${input.entityType}-${n}`,
        payload: { id: `${input.entityType}-${n}`, name: `Mock ${input.entityType} ${n}`, updated_at: new Date().toISOString() },
        contentHash: `mock-hash-${n}`,
      };
    });
    // Cap at 50 so a demo run terminates instead of looping forever.
    const nextOffset = offset + size;
    return { records, nextCursor: nextOffset >= 50 ? null : String(nextOffset), hasMore: nextOffset < 50 };
  }
}
