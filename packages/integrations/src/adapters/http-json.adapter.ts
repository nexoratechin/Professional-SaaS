/**
 * `http_json` — the generic REST adapter.
 *
 * This is the single most important file for the "do not couple the ERP to one provider" requirement.
 * A large share of real integrations — payment gateways, accounting REST APIs, LMS APIs, SMS/WhatsApp
 * gateways, e-signature providers, document services, even most IdP management APIs — are ultimately
 * "POST some JSON to a URL, read the JSON that comes back". This adapter makes that case work with
 * configuration alone: base URL, auth style, method/path/body template, and where to read the
 * provider's id out of the response. A new vendor is a config row, not a code change and not a
 * dependency.
 *
 * stdlib-only (`fetch`) — no vendor SDK, consistent with @college-erp/notifications' HTTP gateway
 * provider. Where a vendor genuinely needs a bespoke protocol (signed canonical requests, OAuth
 * token exchange, mTLS), register a dedicated adapter instead of overloading this one.
 *
 * ## Why `{{placeholder}}` interpolation instead of a request DSL
 *
 * A templating string is enough to cover the long tail and keeps the stored config reviewable by a
 * human in the admin UI. Anything more expressive would need its own parser, its own validation and
 * its own test suite, and would still not cover vendor-specific signing.
 */

import { IntegrationAdapterError } from '../types';
import {
  configString,
  credentialString,
  type ConnectionTester,
  type IntegrationAdapter,
  type IntegrationAdapterContext,
  type IntegrationAdapterResult,
  type IntegrationTestResult,
  type PullPage,
  type PullSynchronizer,
  type PushOutcome,
  type PushSynchronizer,
} from '../types';
import { classifyIntegrationFailure } from '../retry';
import { truncateResponse } from '../redact';
import { assertSafeOutboundUrl } from '../ssrf';

const DEFAULT_USER_AGENT = 'college-erp-integrations/1.0';
const MAX_RESPONSE_CHARS = 8_000;

/** Replaces `{{name}}` in a string from a flat variable map. Unknown names are left untouched so a
 *  literal `{{` in a body is not silently swallowed. */
export function interpolate(value: unknown, vars: Record<string, string>): unknown {
  if (typeof value === 'string') {
    return value.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (match, key: string) => vars[key] ?? match);
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, vars));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = interpolate(val, vars);
    }
    return out;
  }
  return value;
}

/** Variables available to templates. `payload` is the object itself; scalars are hoisted for
 *  convenience so `{{reference}}` works as well as `{{payload.reference}}`. */
function templateVars(payload: unknown, extra: Record<string, string>): Record<string, string> {
  const vars: Record<string, string> = { ...extra };
  vars.json = JSON.stringify(payload ?? {});
  if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)) {
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        vars[key] = String(value);
      }
    }
  }
  return vars;
}

/** Applies the configured auth style to a header set. */
function applyAuth(
  headers: Record<string, string>,
  ctx: IntegrationAdapterContext,
  url: URL,
): void {
  const style = configString(ctx.config, 'authStyle', 'bearer');
  switch (style) {
    case 'bearer': {
      const token = credentialString(ctx.credentials, 'token');
      if (token) headers['authorization'] = `Bearer ${token}`;
      break;
    }
    case 'api_key_header': {
      const apiKey = credentialString(ctx.credentials, 'apiKey');
      const headerName = configString(ctx.config, 'apiKeyHeader', 'x-api-key');
      if (apiKey) headers[headerName.toLowerCase()] = apiKey;
      break;
    }
    case 'basic': {
      const username = credentialString(ctx.credentials, 'username') ?? '';
      const password = credentialString(ctx.credentials, 'password') ?? '';
      if (username || password) {
        headers['authorization'] = `Basic ${Buffer.from(`${username}:${password}`, 'utf8').toString('base64')}`;
      }
      break;
    }
    case 'query': {
      const apiKey = credentialString(ctx.credentials, 'apiKey');
      if (apiKey) url.searchParams.set(configString(ctx.config, 'apiKeyQueryParam', 'api_key'), apiKey);
      break;
    }
    case 'none':
      break;
    default:
      break;
  }
}

interface HttpCallOptions {
  method: string;
  /** Path appended to baseUrl. May be a `{{…}}` template. */
  path?: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  ctx: IntegrationAdapterContext;
  /** Extra headers merged over config headers (used for idempotency). */
  extraHeaders?: Record<string, string>;
}

interface HttpCallResult {
  status: number;
  body: unknown;
  rawText: string;
  latencyMs: number;
}

/**
 * Performs one HTTP request, translating transport/status failures into `IntegrationAdapterError`
 * with a classification. Never returns a non-2xx result — that is an error, so no caller can
 * accidentally treat a 500 as success.
 */
async function httpCall(options: HttpCallOptions): Promise<HttpCallResult> {
  const { ctx, method } = options;
  const baseUrl = configString(ctx.config, 'baseUrl');
  const vars = templateVars(options.body, {
    integrationKey: ctx.integrationKey,
    idempotencyKey: ctx.idempotencyKey ?? '',
  });

  const pathTemplate = typeof options.path === 'string' ? options.path : '';
  const path = String(interpolate(pathTemplate, vars) ?? '');
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(interpolate(String(value), vars)));
  }

  const headers: Record<string, string> = {
    accept: 'application/json',
    'user-agent': DEFAULT_USER_AGENT,
    // Lets a provider's support team find the tenant without us shipping identifying data.
    'x-college-erp-integration': ctx.integrationKey,
  };

  const configHeaders = ctx.config.headers;
  if (configHeaders && typeof configHeaders === 'object' && !Array.isArray(configHeaders)) {
    for (const [key, value] of Object.entries(configHeaders as Record<string, unknown>)) {
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        headers[key.toLowerCase()] = String(interpolate(String(value), vars));
      }
    }
  }

  applyAuth(headers, ctx, url);

  if (ctx.idempotencyKey) {
    const idempotencyHeader = configString(ctx.config, 'idempotencyHeader', 'idempotency-key');
    headers[idempotencyHeader.toLowerCase()] = ctx.idempotencyKey;
  }
  for (const [key, value] of Object.entries(options.extraHeaders ?? {})) {
    headers[key.toLowerCase()] = value;
  }

  let response: Response;
  const startedAt = Date.now();
  try {
    // SSRF guard: baseUrl/path/query are tenant-controlled config. Reject internal targets before
    // the request leaves the process, and never follow redirects (a public URL could otherwise
    // bounce to an internal one).
    await assertSafeOutboundUrl(url);
    response = await fetch(url, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      redirect: 'manual',
      // Rejecting self-signed certificates requires a custom dispatcher/agent that `fetch` does not
      // expose portably; `verifyTls: false` is therefore honoured only where the runtime supports
      // it, and is deliberately not a blanket "ignore TLS errors" switch.
      signal: AbortSignal.timeout(ctx.timeoutMs),
    });
  } catch (error) {
    const classified = classifyIntegrationFailure({ error });
    throw new IntegrationAdapterError(classified.message, {
      category: classified.category,
      retryable: classified.retryable,
      cause: error,
    });
  }

  const rawText = await response.text().catch(() => '');
  const latencyMs = Date.now() - startedAt;
  let body: unknown = null;
  if (rawText) {
    try {
      body = JSON.parse(rawText);
    } catch {
      body = rawText;
    }
  }

  if (!response.ok) {
    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterMs = retryAfterHeader ? parseRetryAfterMs(retryAfterHeader) : null;
    const classified = classifyIntegrationFailure({
      status: response.status,
      message: `HTTP ${response.status} from ${url.origin}${url.pathname}: ${truncateResponse(rawText, 400)}`,
      retryAfterMs,
    });
    throw new IntegrationAdapterError(classified.message, {
      category: classified.category,
      retryable: classified.retryable,
      status: response.status,
      retryAfterMs,
      providerCode: extractProviderCode(body),
    });
  }

  return { status: response.status, body, rawText, latencyMs };
}

/** Retry-After is either delta-seconds or an HTTP-date; both are accepted. */
function parseRetryAfterMs(value: string): number | null {
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return null;
}

/** Best-effort provider error code, used verbatim in the failure log. */
function extractProviderCode(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  for (const key of ['code', 'error_code', 'errorCode', 'type', 'error']) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
    // Many APIs nest it: { error: { code, message } }
    if (value !== null && typeof value === 'object') {
      const nested = (value as Record<string, unknown>).code;
      if (typeof nested === 'string' && nested.length > 0) return nested;
    }
  }
  return null;
}

/** Config-driven reference-id extraction: a dotted path into the response, e.g. `data.id`. */
function readPath(source: unknown, path: string): unknown {
  if (!path) return undefined;
  let current: unknown = source;
  for (const segment of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export class HttpJsonAdapter implements IntegrationAdapter, ConnectionTester, PullSynchronizer, PushSynchronizer {
  readonly name = 'http_json';

  // ── Outbound call ───────────────────────────────────────────────────────────

  async execute(operation: string, payload: unknown, ctx: IntegrationAdapterContext): Promise<IntegrationAdapterResult> {
    const method = configString(ctx.config, `method.${operation}`, 'POST').toUpperCase();
    const path = configString(ctx.config, `path.${operation}`, `/${operation}`);
    const queryTemplate = ctx.config[`query.${operation}`];
    const query =
      queryTemplate && typeof queryTemplate === 'object' && !Array.isArray(queryTemplate)
        ? (queryTemplate as Record<string, string>)
        : undefined;

    const result = await httpCall({ method, path, query, body: payload, ctx });

    const refPath = configString(ctx.config, `referencePath.${operation}`, 'id');
    const reference = readPath(result.body, refPath);

    return {
      providerReference:
        typeof reference === 'string' || typeof reference === 'number' ? String(reference) : null,
      response: truncateJson(result.body),
    };
  }

  // ── Connection test ─────────────────────────────────────────────────────────

  /**
   * Probes the configured test path. Deliberately a *read*: a connection test must never create a
   * charge, send an SMS or write to the provider's books. That is why the default is GET on a
   * configured `testPath` rather than an echo of the first real operation.
   */
  async testConnection(ctx: IntegrationAdapterContext): Promise<IntegrationTestResult> {
    const testPath = configString(ctx.config, 'testPath', '/');
    const testMethod = configString(ctx.config, 'testMethod', 'GET').toUpperCase();
    const startedAt = Date.now();

    try {
      const result = await httpCall({ method: testMethod, path: testPath, ctx });
      return {
        ok: true,
        message: `Reachable — ${testMethod} ${testPath} returned ${result.status}.`,
        latencyMs: Date.now() - startedAt,
        status: result.status,
        responseExcerpt: truncateJson(result.body),
      };
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      if (error instanceof IntegrationAdapterError) {
        return {
          ok: false,
          // Names the category so "credentials rejected" is distinguishable from "DNS failed"
          // without the operator having to read the raw message.
          message: `${error.category}: ${error.message}`,
          latencyMs,
          status: error.status ?? null,
        };
      }
      return { ok: false, message: 'Unexpected error while testing the connection.', latencyMs, status: null };
    }
  }

  // ── Pull sync ───────────────────────────────────────────────────────────────

  async pull(
    input: { entityType: string; cursor: string | null; limit: number; since?: string | null },
    ctx: IntegrationAdapterContext,
  ): Promise<PullPage> {
    const path = configString(ctx.config, `pullPath.${input.entityType}`, `/${input.entityType}`);
    const recordsPath = configString(ctx.config, `pullRecordsPath.${input.entityType}`, 'data');
    const cursorPath = configString(ctx.config, `pullCursorPath.${input.entityType}`);
    const idPath = configString(ctx.config, `pullIdPath.${input.entityType}`, 'id');

    const query: Record<string, string | number | boolean | undefined | null> = { limit: input.limit };
    if (input.cursor) query[configString(ctx.config, `pullCursorParam.${input.entityType}`, 'cursor')] = input.cursor;
    if (input.since) query[configString(ctx.config, `pullSinceParam.${input.entityType}`, 'updated_since')] = input.since;
    // A push-only provider has no pullPath configured; the empty path would fetch the collection
    // root and produce a confusing schema error, so fail with an actionable message instead.
    if (!ctx.config[`pullPath.${input.entityType}`] && !input.cursor) {
      throw new IntegrationAdapterError(
        `Pull sync for entity "${input.entityType}" is not configured: set config.pullPath.${input.entityType}.`,
        { category: 'CONFIGURATION', retryable: false },
      );
    }

    const result = await httpCall({ method: 'GET', path, query, ctx });
    const rawRecords = readPath(result.body, recordsPath);
    const list = Array.isArray(rawRecords) ? rawRecords : [];

    const records = list.slice(0, input.limit).map((entry) => {
      const externalId = readPath(entry, idPath);
      return {
        externalId: typeof externalId === 'string' || typeof externalId === 'number' ? String(externalId) : '',
        payload: entry,
        contentHash: typeof readPath(entry, 'updated_at') === 'string' ? String(readPath(entry, 'updated_at')) : null,
      };
    }).filter((record) => record.externalId !== '');

    const nextCursor = cursorPath ? readPath(result.body, cursorPath) : input.cursor;
    return {
      records,
      nextCursor: typeof nextCursor === 'string' || typeof nextCursor === 'number' ? String(nextCursor) : input.cursor,
      hasMore: Boolean(ctx.config[`pullHasMorePath.${input.entityType}`] ? readPath(result.body, String(ctx.config[`pullHasMorePath.${input.entityType}`])) : list.length >= input.limit),
    };
  }

  // ── Push sync ───────────────────────────────────────────────────────────────

  async push(
    input: {
      entityType: string;
      records: Array<{ externalId: string; payload: unknown; idempotencyKey?: string | null }>;
    },
    ctx: IntegrationAdapterContext,
  ): Promise<PushOutcome[]> {
    const path = configString(ctx.config, `pushPath.${input.entityType}`, `/${input.entityType}`);
    const successPath = configString(ctx.config, `pushSuccessPath.${input.entityType}`, 'id');
    const outcomePath = configString(ctx.config, `pushOutcomePath.${input.entityType}`);

    const outcomes: PushOutcome[] = [];
    // One request per record rather than a batched call: a batch response that fails gives no way
    // to attribute the failure to a record, which would make per-record retry impossible. Vendors
    // that want batching implement a bespoke adapter.
    for (const record of input.records) {
      try {
        const result = await httpCall({
          method: configString(ctx.config, `pushMethod.${input.entityType}`, 'POST'),
          path,
          body: record.payload,
          ctx: { ...ctx, idempotencyKey: record.idempotencyKey ?? ctx.idempotencyKey ?? null },
        });
        const perRecord = outcomePath ? readPath(result.body, outcomePath) : undefined;
        // A single-record request to a batch-shaped API still comes back wrapped in a list
        // (`{ "results": [ { … } ] }`). Taking [0] here is what makes one `pushOutcomePath` setting
        // work for both shapes; reading `.id` off the array itself would silently yield null and
        // lose the provider's reference for every record.
        const unwrapped = Array.isArray(perRecord) ? perRecord[0] : perRecord;
        const reference = readPath(unwrapped ?? result.body, successPath);
        outcomes.push({
          externalId: record.externalId,
          ok: true,
          providerReference: typeof reference === 'string' || typeof reference === 'number' ? String(reference) : null,
        });
      } catch (error) {
        outcomes.push({
          externalId: record.externalId,
          ok: false,
          error: error instanceof Error ? error.message : 'Push failed.',
        });
      }
    }
    return outcomes;
  }
}

/** Clamps a provider response before it can reach a JSONB log column. */
function truncateJson(body: unknown): unknown {
  if (typeof body === 'string') return truncateResponse(body, MAX_RESPONSE_CHARS);
  try {
    const json = JSON.stringify(body);
    if (json === undefined) return null;
    if (json.length <= MAX_RESPONSE_CHARS) return body;
    return { _truncated: true, _originalLength: json.length, excerpt: json.slice(0, MAX_RESPONSE_CHARS) };
  } catch {
    return null;
  }
}
