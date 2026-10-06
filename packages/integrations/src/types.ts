/**
 * The adapter contract — the single seam between the ERP and every external system.
 *
 * ## The vendor-neutrality argument, stated as a type
 *
 * Nothing in this file mentions a vendor. An adapter is handed a `IntegrationAdapterContext`
 * (non-secret config + decrypted credentials) and returns a normalized `IntegrationAdapterResult`.
 * Everything above this line — the API module, the worker, the sync engine, the webhook pipeline —
 * speaks only these types. That is what "do not couple the ERP to one provider" means concretely:
 * swapping a vendor changes the *contents of a config row*, never a call site.
 *
 * ## Three optional capabilities instead of one fat interface
 *
 * `IntegrationAdapter` requires only `execute`. Connection testing, pulling remote records and
 * pushing local records are separate optional interfaces, resolved via the `supports` map. A
 * webhook-only adapter (e.g. an SMS provider that only ever calls us) should not be forced to
 * implement a meaningless `pull()`. The registry only exposes a capability when the adapter actually
 * implements it, so callers get a precise "this adapter cannot pull" rather than a runtime
 * `undefined is not a function`.
 */

import type { FailureCategory } from './retry';

/** Everything an adapter needs to talk to a provider. Secrets are already decrypted by the caller. */
export interface IntegrationAdapterContext {
  /** Stable tenant-unique handle, sent as a header for provider-side support correlation. */
  integrationKey: string;
  /** Non-secret settings (baseUrl, authStyle, timeoutSec, headers, …). */
  config: Record<string, unknown>;
  /** Decrypted credentials (token, apiKey, username/password). Never logged, never persisted. */
  credentials: Record<string, unknown>;
  /** Effective timeout after policy resolution. Adapters must honour it. */
  timeoutMs: number;
  /** Stable per-operation key; also the provider-facing idempotency key. */
  idempotencyKey?: string | null;
}

export interface IntegrationAdapterResult {
  /** Provider's id for this call, when it returns one. Stored for reconciliation. */
  providerReference?: string | null;
  /** Parsed response body, already redacted by the adapter's caller. */
  response?: unknown;
  /** Anything worth surfacing to the operator (a warning, a partial-success note). */
  message?: string | null;
}

/**
 * A failure an adapter raises. Carries the classification explicitly so an adapter that learns
 * something better than the status-code heuristic (e.g. a provider-specific 409 that means
 * "already processed, treat as success") can say so.
 */
export class IntegrationAdapterError extends Error {
  readonly category: FailureCategory;
  readonly retryable: boolean;
  readonly status?: number | null;
  readonly providerCode?: string | null;
  /** Provider's Retry-After, when honoured. */
  readonly retryAfterMs?: number | null;
  override readonly cause: unknown;

  constructor(
    message: string,
    options: {
      category: FailureCategory;
      retryable: boolean;
      status?: number | null;
      providerCode?: string | null;
      retryAfterMs?: number | null;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = 'IntegrationAdapterError';
    this.category = options.category;
    this.retryable = options.retryable;
    this.status = options.status ?? null;
    this.providerCode = options.providerCode ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.cause = options.cause;
  }
}

/** The one required capability: perform a logical operation against the provider. */
export interface IntegrationAdapter {
  /** Adapter key as stored on `Integration.provider`. */
  readonly name: string;

  /**
   * Performs `operation` (a dotted logical name like `payment.create` or `student.push`).
   *
   * Must throw `IntegrationAdapterError` for a classified failure and return normally for success.
   * Must be safe to call again with the same `idempotencyKey`: the framework retries automatically,
   * so a non-idempotent adapter would double-charge a card on an ambiguous timeout.
   */
  execute(operation: string, payload: unknown, ctx: IntegrationAdapterContext): Promise<IntegrationAdapterResult>;
}

/** Optional capability: probe liveness/credentials without performing business work. */
export interface ConnectionTester {
  testConnection(ctx: IntegrationAdapterContext): Promise<IntegrationTestResult>;
}

/**
 * Optional capability: react to a verified inbound delivery.
 *
 * Kept separate from `IntegrationAdapter` (like ConnectionTester / PullSynchronizer) because most
 * adapters never receive anything, and forcing a no-op `handleWebhook` onto them would make a
 * *missing* implementation indistinguishable from a deliberate one.
 *
 * Contract: throwing marks the event FAILED so the provider's own retry takes over. Returning normally
 * marks it PROCESSED. The framework has already verified the signature and de-duplicated by external
 * id before calling this, so an implementation never has to re-authenticate the caller.
 */
export interface WebhookHandler {
  handleWebhook(event: unknown, ctx: IntegrationAdapterContext): Promise<void>;
}

export interface IntegrationTestResult {
  ok: boolean;
  /** Operator-facing detail: "Authenticated as acct_123", "403 on /v1/charges". */
  message: string;
  latencyMs: number;
  /** 2xx/3xx/4xx/5xx, or null when the request never completed (DNS failure, timeout). */
  status?: number | null;
  /** Sanitized response excerpt for the operator. */
  responseExcerpt?: unknown;
}

/** Optional capability: fetch a batch of remote records to reconcile locally. */
export interface PullSynchronizer {
  /**
   * Returns one page of remote records plus the cursor for the next page.
   *
   * Returning `hasMore: true` with a `nextCursor` is what makes an interrupted sync resumable: the
   * caller persists `nextCursor` onto `IntegrationSyncRun.cursorAfter` as it goes, so a crash
   * resumes instead of restarting from the provider's beginning.
   */
  pull(input: {
    entityType: string;
    cursor: string | null;
    limit: number;
    since?: string | null;
  }, ctx: IntegrationAdapterContext): Promise<PullPage>;
}

export interface PullPage {
  records: Array<{ externalId: string; payload: unknown; contentHash?: string | null }>;
  nextCursor: string | null;
  hasMore: boolean;
}

/** Optional capability: send local records to the provider. */
export interface PushSynchronizer {
  /**
   * Pushes one batch. Returns per-record outcomes rather than throwing on a partial failure,
   * because a 200 response routinely means "3 of 50 accepted" — collapsing that into a single
   * success/failure would misreport a sync as clean.
   */
  push(input: {
    entityType: string;
    records: Array<{ externalId: string; payload: unknown; idempotencyKey?: string | null }>;
  }, ctx: IntegrationAdapterContext): Promise<PushOutcome[]>;
}

export interface PushOutcome {
  externalId: string;
  ok: boolean;
  providerReference?: string | null;
  error?: string | null;
}

/** Capability → optional-interface map. The registry resolves against this. */
export interface AdapterCapabilities {
  connectionTest?: ConnectionTester;
  pullSync?: PullSynchronizer;
  pushSync?: PushSynchronizer;
  /**
   * Inbound handling. Present on the resolved capabilities only when the adapter implements
   * `handleWebhook`, so the webhook controller branches on its presence rather than on a duck-typed
   * cast at the call site — an adapter that omits it is a real, visible "cannot handle events".
   */
  webhook?: WebhookHandler;
}

/** The map an adapter publishes so the registry knows what it can do. */
export const ADAPTER_CAPABILITIES: readonly (keyof AdapterCapabilities)[] = [
  'connectionTest',
  'pullSync',
  'pushSync',
  'webhook',
];

/** Reads one config value as a finite number, falling back when absent/unparseable. */
export function configNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function configString(config: Record<string, unknown>, key: string, fallback = ''): string {
  const value = config[key];
  return typeof value === 'string' ? value : fallback;
}

export function configBoolean(config: Record<string, unknown>, key: string, fallback = false): boolean {
  const value = config[key];
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
}

export function credentialString(credentials: Record<string, unknown>, key: string): string | undefined {
  const value = credentials[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}
