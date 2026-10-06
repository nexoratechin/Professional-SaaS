/**
 * `http_json` adapter — the config surface that makes a new vendor a config row instead of a
 * dependency.
 *
 * Every test here stubs `fetch`, because that is the only thing this adapter touches: config in,
 * request out. The properties pinned below are the ones an operator gets wrong in production:
 *
 *   - auth styles must not leak a secret into the URL, the body or a header of the wrong name;
 *   - `{{placeholder}}` interpolation must survive a payload field that *looks* like a template;
 *   - a non-2xx must throw a classified error, never resolve as success;
 *   - pull must not silently return an empty page when it is simply not configured.
 */

import { HttpJsonAdapter, interpolate } from './http-json.adapter';
import { IntegrationAdapterError } from '../types';
import type { IntegrationAdapterContext } from '../types';

/** Records the single request made, so assertions can inspect URL, method and headers. */
interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

let captured: Captured | null = null;

/** Replaces global fetch with a stub that records the request and returns `response`. */
function stubFetch(response: { status?: number; body?: unknown; headers?: Record<string, string>; text?: string }) {
  captured = null;
  const status = response.status ?? 200;
  global.fetch = jest.fn(async (input: unknown, init?: { method?: string; headers?: Record<string, string>; body?: string }) => {
    captured = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body === undefined ? undefined : JSON.parse(init.body),
    };
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (name: string) => response.headers?.[name.toLowerCase()] ?? null },
      text: async () => response.text ?? JSON.stringify(response.body ?? {}),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function ctx(overrides: Partial<IntegrationAdapterContext> = {}): IntegrationAdapterContext {
  return {
    integrationKey: 'stripe-payments',
    config: { baseUrl: 'https://api.vendor.test/v1', authStyle: 'none' },
    credentials: {},
    timeoutMs: 5_000,
    idempotencyKey: null,
    ...overrides,
  };
}

const adapter = new HttpJsonAdapter();

afterEach(() => {
  jest.restoreAllMocks();
});

describe('interpolate', () => {
  it('substitutes known placeholders and leaves unknown ones intact', () => {
    // Unknown names must survive: a JSON body containing a literal `{{` would otherwise be corrupted.
    expect(interpolate('order/{{reference}} and {{unknown}}', { reference: 'A-1' })).toBe(
      'order/A-1 and {{unknown}}',
    );
  });

  it('walks nested objects and arrays without mutating the input', () => {
    const input = { a: { b: ['{{x}}', { c: '{{x}}' }] } };
    const out = interpolate(input, { x: '1' });
    expect(out).toEqual({ a: { b: ['1', { c: '1' }] } });
    expect(input.a.b[0]).toBe('{{x}}');
  });

  it('tolerates whitespace inside the braces', () => {
    expect(interpolate('{{ reference }}', { reference: 'A' })).toBe('A');
  });

  it('passes non-strings through untouched', () => {
    expect(interpolate(7, {})).toBe(7);
    expect(interpolate(null, {})).toBeNull();
  });
});

describe('HttpJsonAdapter.execute', () => {
  it('sends the configured method/path and returns the reference at the configured path', async () => {
    stubFetch({ body: { data: { id: 'ch_123' } } });
    const result = await adapter.execute(
      'payment.create',
      { amount: 500 },
      ctx({
        config: {
          baseUrl: 'https://api.vendor.test/v1',
          authStyle: 'none',
          'method.payment.create': 'post',
          'path.payment.create': 'charges',
          'referencePath.payment.create': 'data.id',
        },
      }),
    );

    expect(captured?.method).toBe('POST');
    expect(captured?.url).toBe('https://api.vendor.test/v1/charges');
    expect(captured?.body).toEqual({ amount: 500 });
    expect(result.providerReference).toBe('ch_123');
  });

  it('does not double up slashes between baseUrl and path', async () => {
    // baseUrl conventionally ends in `/`; a naive concatenation would produce `v1//charges`, which
    // some providers answer with a 404 and others silently treat as a different route.
    stubFetch({ body: {} });
    await adapter.execute('x.y', {}, ctx({ config: { baseUrl: 'https://api.vendor.test/v1/', 'path.x.y': '/charges' } }));
    expect(captured?.url).toBe('https://api.vendor.test/v1/charges');
  });

  it('interpolates payload scalars into the path', async () => {
    stubFetch({ body: { id: '1' } });
    await adapter.execute('student.get', { studentId: 'S-9' }, ctx({ config: { baseUrl: 'https://v.test', 'path.student.get': 'students/{{studentId}}' } }));
    expect(captured?.url).toBe('https://v.test/students/S-9');
  });

  it('sends the idempotency key as a header under a configurable name', async () => {
    stubFetch({ body: {} });
    await adapter.execute(
      'payment.create',
      {},
      ctx({ config: { baseUrl: 'https://v.test', idempotencyHeader: 'x-request-id' }, idempotencyKey: 'idem-1' }),
    );
    expect(captured?.headers['x-request-id']).toBe('idem-1');
  });

  it('omits the idempotency header entirely when there is no key', async () => {
    stubFetch({ body: {} });
    await adapter.execute('x.y', {}, ctx({ config: { baseUrl: 'https://v.test' } }));
    expect(captured?.headers['idempotency-key']).toBeUndefined();
  });

  it('identifies the tenant connection to the provider via a correlation header', async () => {
    // Lets a vendor's support team find the connection without us shipping any tenant data.
    stubFetch({ body: {} });
    await adapter.execute('x.y', {}, ctx());
    expect(captured?.headers['x-college-erp-integration']).toBe('stripe-payments');
  });

  it('truncates an oversized response instead of writing megabytes into the log column', async () => {
    stubFetch({ body: { blob: 'x'.repeat(20_000) } });
    const result = await adapter.execute('x.y', {}, ctx());
    expect((result.response as { _truncated?: boolean })._truncated).toBe(true);
  });

  it('handles a non-JSON 2xx body without throwing', async () => {
    // A 200 "OK" text body is a real provider behaviour (health endpoints); JSON.parse would throw.
    stubFetch({ text: 'OK', body: undefined });
    const result = await adapter.execute('x.y', {}, ctx());
    expect(result.response).toBe('OK');
    expect(result.providerReference).toBeNull();
  });
});

describe('HttpJsonAdapter auth styles', () => {
  it('bearer: sends Authorization and never the raw token in the URL or body', async () => {
    stubFetch({ body: {} });
    await adapter.execute('x.y', {}, ctx({ config: { baseUrl: 'https://v.test', authStyle: 'bearer' }, credentials: { token: 'sec-token' } }));
    expect(captured?.headers['authorization']).toBe('Bearer sec-token');
    expect(captured?.url).not.toContain('sec-token');
    // The credential travels only in the header — the JSON body is the caller's payload, untouched.
    expect(captured?.body).toEqual({});
  });

  it('bearer with no token sends no Authorization header rather than "Bearer null"', async () => {
    stubFetch({ body: {} });
    await adapter.execute('x.y', {}, ctx({ config: { baseUrl: 'https://v.test', authStyle: 'bearer' }, credentials: {} }));
    expect(captured?.headers['authorization']).toBeUndefined();
  });

  it('api_key_header: uses the configured header name, lower-cased', async () => {
    stubFetch({ body: {} });
    await adapter.execute(
      'x.y',
      {},
      ctx({ config: { baseUrl: 'https://v.test', authStyle: 'api_key_header', apiKeyHeader: 'X-Vendor-Key' }, credentials: { apiKey: 'k-1' } }),
    );
    expect(captured?.headers['x-vendor-key']).toBe('k-1');
  });

  it('api_key_header defaults to x-api-key', async () => {
    stubFetch({ body: {} });
    await adapter.execute('x.y', {}, ctx({ config: { baseUrl: 'https://v.test', authStyle: 'api_key_header' }, credentials: { apiKey: 'k-1' } }));
    expect(captured?.headers['x-api-key']).toBe('k-1');
  });

  it('basic: encodes username:password as base64', async () => {
    stubFetch({ body: {} });
    await adapter.execute(
      'x.y',
      {},
      ctx({ config: { baseUrl: 'https://v.test', authStyle: 'basic' }, credentials: { username: 'u', password: 'p' } }),
    );
    expect(captured?.headers['authorization']).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });

  it('query: appends the key to the URL under a configurable param name', async () => {
    stubFetch({ body: {} });
    await adapter.execute(
      'x.y',
      {},
      ctx({ config: { baseUrl: 'https://v.test', authStyle: 'query', apiKeyQueryParam: 'access_token' }, credentials: { apiKey: 'k-1' } }),
    );
    expect(new URL(captured!.url).searchParams.get('access_token')).toBe('k-1');
    expect(captured?.headers['authorization']).toBeUndefined();
  });

  it('none: sends no credentials at all', async () => {
    stubFetch({ body: {} });
    await adapter.execute('x.y', {}, ctx({ config: { baseUrl: 'https://v.test', authStyle: 'none' }, credentials: { apiKey: 'k-1', token: 't' } }));
    expect(captured?.headers['authorization']).toBeUndefined();
    expect(captured?.url).not.toContain('k-1');
  });

  it('merges configured headers and still lets auth win over a same-named config header', async () => {
    // A config header must not be able to forge authentication, or a tenant's own config could
    // silently override the credential the adapter just decrypted.
    stubFetch({ body: {} });
    await adapter.execute(
      'x.y',
      {},
      ctx({
        config: { baseUrl: 'https://v.test', authStyle: 'bearer', headers: { 'x-tenant': 'acme', authorization: 'Bearer attacker' } },
        credentials: { token: 'real-token' },
      }),
    );
    expect(captured?.headers['x-tenant']).toBe('acme');
    expect(captured?.headers['authorization']).toBe('Bearer real-token');
  });
});

describe('HttpJsonAdapter error classification', () => {
  it('throws a retryable NETWORK error for an undici-shaped fetch failure', async () => {
    // The real shape: `TypeError: fetch failed` with the errno two levels down on `cause`.
    global.fetch = jest.fn(async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    }) as unknown as typeof fetch;

    await expect(adapter.execute('x.y', {}, ctx())).rejects.toMatchObject({ category: 'NETWORK', retryable: true });
  });

  it('classifies a transport errno that only appears in the message as retryable NETWORK', async () => {
    // A polyfilled/intercepted fetch surfaces a plain Error with the errno in the text. Treating it
    // as permanent UNKNOWN would stop the framework retrying a transient outage.
    global.fetch = jest.fn(async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.1:443');
    }) as unknown as typeof fetch;

    await expect(adapter.execute('x.y', {}, ctx())).rejects.toMatchObject({ category: 'NETWORK', retryable: true });
  });

  it('classifies an abort as a retryable TIMEOUT', async () => {
    global.fetch = jest.fn(async () => {
      throw Object.assign(new Error('aborted'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch;

    await expect(adapter.execute('x.y', {}, ctx())).rejects.toMatchObject({ category: 'TIMEOUT', retryable: true });
  });

  it('throws a non-retryable AUTHENTICATION error on 401', async () => {
    stubFetch({ status: 401, body: { error: { code: 'invalid_key' } } });
    // Non-retryable matters: retrying a rejected key burns the attempt budget and never succeeds.
    await expect(adapter.execute('x.y', {}, ctx())).rejects.toMatchObject({
      category: 'AUTHENTICATION',
      retryable: false,
      status: 401,
      providerCode: 'invalid_key',
    });
  });

  it('surfaces Retry-After from a 429 as the backoff hint', async () => {
    stubFetch({ status: 429, headers: { 'retry-after': '30' } });
    await expect(adapter.execute('x.y', {}, ctx())).rejects.toMatchObject({
      category: 'RATE_LIMIT',
      retryable: true,
      retryAfterMs: 30_000,
    });
  });

  it('never resolves a non-2xx as success', async () => {
    stubFetch({ status: 500, body: {} });
    await expect(adapter.execute('x.y', {}, ctx())).rejects.toBeInstanceOf(IntegrationAdapterError);
  });

  it('does not leak the secret into an error message', async () => {
    stubFetch({ status: 500, text: 'boom' });
    await expect(
      adapter.execute('x.y', {}, ctx({ config: { baseUrl: 'https://v.test', authStyle: 'bearer' }, credentials: { token: 'sup3r-secret' } })),
    ).rejects.toMatchObject({ message: expect.not.stringContaining('sup3r-secret') });
  });
});

describe('HttpJsonAdapter.testConnection', () => {
  it('defaults to a GET on `/` so a probe never creates a charge or sends an SMS', async () => {
    stubFetch({ status: 200, body: { ok: true } });
    const result = await adapter.testConnection(ctx({ config: { baseUrl: 'https://v.test', authStyle: 'none' } }));
    expect(captured?.method).toBe('GET');
    expect(result.ok).toBe(true);
    expect(result.message).toContain('200');
  });

  it('reports a failure as a value, not a throw — a failed probe is a legitimate outcome', async () => {
    stubFetch({ status: 401, body: {} });
    const result = await adapter.testConnection(ctx());
    expect(result.ok).toBe(false);
    // The category is in the message so "credentials rejected" is distinguishable from "DNS failed"
    // without the operator reading raw provider text.
    expect(result.message).toContain('AUTHENTICATION');
    expect(result.status).toBe(401);
  });
});

describe('HttpJsonAdapter.pull', () => {
  it('reads records, id and next cursor from the configured response paths', async () => {
    stubFetch({
      body: { data: [{ id: 's1', updated_at: 'h1' }, { id: 's2', updated_at: 'h2' }], meta: { next: 'c2' } },
    });
    const page = await adapter.pull(
      { entityType: 'student', cursor: 'c1', limit: 2 },
      ctx({ config: { baseUrl: 'https://v.test', authStyle: 'none', 'pullPath.student': 'students', 'pullCursorPath.student': 'meta.next' } }),
    );

    expect(new URL(captured!.url).searchParams.get('cursor')).toBe('c1');
    expect(page.records.map((r) => r.externalId)).toEqual(['s1', 's2']);
    expect(page.records[0]?.contentHash).toBe('h1');
    expect(page.nextCursor).toBe('c2');
  });

  it('honours a configured since param for incremental syncs', async () => {
    stubFetch({ body: { data: [] } });
    await adapter.pull(
      { entityType: 'student', cursor: null, limit: 10, since: '2026-01-01' },
      ctx({ config: { baseUrl: 'https://v.test', 'pullPath.student': 'students' } }),
    );
    expect(new URL(captured!.url).searchParams.get('updated_since')).toBe('2026-01-01');
  });

  it('fails loudly when pull is not configured, instead of returning a misleading empty page', async () => {
    // An empty first page would look like "no records changed" and mark the run SUCCEEDED forever.
    stubFetch({ body: { data: [] } });
    await expect(
      adapter.pull({ entityType: 'unknown', cursor: null, limit: 10 }, ctx({ config: { baseUrl: 'https://v.test' } })),
    ).rejects.toMatchObject({ category: 'CONFIGURATION', retryable: false });
  });

  it('drops entries with no usable external id rather than writing a blank ledger key', async () => {
    stubFetch({ body: { data: [{ id: 's1' }, { name: 'no id' }] } });
    const page = await adapter.pull(
      { entityType: 'student', cursor: null, limit: 10 },
      ctx({ config: { baseUrl: 'https://v.test', 'pullPath.student': 'students' } }),
    );
    expect(page.records).toHaveLength(1);
  });

  it('reads hasMore from a configured path when the provider gives one', async () => {
    stubFetch({ body: { data: [], meta: { more: false } } });
    const page = await adapter.pull(
      { entityType: 'student', cursor: null, limit: 10 },
      ctx({ config: { baseUrl: 'https://v.test', 'pullPath.student': 'students', 'pullHasMorePath.student': 'meta.more' } }),
    );
    expect(page.hasMore).toBe(false);
  });
});

describe('HttpJsonAdapter.push', () => {
  it('returns one outcome per record and attributes success to the right external id', async () => {
    // One request per record, so the response IS that record and `pushSuccessPath` applies directly.
    stubFetch({ body: { id: 'r1' } });
    const outcomes = await adapter.push(
      { entityType: 'student', records: [{ externalId: 's1', payload: { a: 1 } }, { externalId: 's2', payload: { a: 2 } }] },
      ctx({ config: { baseUrl: 'https://v.test', authStyle: 'none', 'pushPath.student': 'students' } }),
    );
    expect(outcomes.map((o) => o.ok)).toEqual([true, true]);
    expect(outcomes.map((o) => o.externalId)).toEqual(['s1', 's2']);
    expect(outcomes[0]?.providerReference).toBe('r1');
  });

  it('unwraps a list-shaped outcome path so a batch-style response still yields the reference', async () => {
    // Some batch-capable providers wrap the single record; the outcome path unwraps it without a
    // bespoke adapter.
    stubFetch({ body: { results: [{ id: 'r9' }] } });
    const outcomes = await adapter.push(
      { entityType: 'student', records: [{ externalId: 's1', payload: {} }] },
      ctx({ config: { baseUrl: 'https://v.test', 'pushPath.student': 'students', 'pushOutcomePath.student': 'results' } }),
    );
    expect(outcomes[0]?.providerReference).toBe('r9');
  });

  it('records a per-record failure instead of aborting the whole batch', async () => {
    // One bad record must not prevent the others from being pushed; a batch-wide throw would leave
    // the run with no ledger entries and no way to retry just the failed one.
    stubFetch({ status: 400, body: { error: 'bad request' } });
    const outcomes = await adapter.push(
      { entityType: 'student', records: [{ externalId: 's1', payload: {} }] },
      ctx({ config: { baseUrl: 'https://v.test', 'pushPath.student': 'students' } }),
    );
    expect(outcomes[0]).toMatchObject({ externalId: 's1', ok: false });
    expect(outcomes[0]?.error).toContain('400');
  });

  it("uses the record's own idempotency key so a retried record is not double-created", async () => {
    stubFetch({ body: { id: 'r1' } });
    await adapter.push(
      { entityType: 'student', records: [{ externalId: 's1', payload: {}, idempotencyKey: 'rec-key' }] },
      ctx({ config: { baseUrl: 'https://v.test', 'pushPath.student': 'students' }, idempotencyKey: 'run-key' }),
    );
    expect(captured?.headers['idempotency-key']).toBe('rec-key');
  });
});