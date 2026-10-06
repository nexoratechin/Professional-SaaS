import type { Request } from 'express';
import { buildIdempotencyKey, isIdempotencyCandidate } from './idempotency.util';

type HeaderBag = Record<string, string>;

function mockRequest(overrides: Record<string, unknown>): Request {
  const method = (overrides.method as string) ?? 'POST';
  // An explicit `headers` override REPLACES the default set entirely, so callers can test
  // "header missing" by passing `{}` (spreading would keep the default key).
  const headers: HeaderBag =
    overrides.headers !== undefined
      ? (overrides.headers as HeaderBag)
      : { 'idempotency-key': 'client-key-1' };
  return {
    method,
    path: overrides.path as string,
    header: (name: string) => headers[name.toLowerCase()],
    resolvedTenant: overrides.resolvedTenant,
    user: overrides.user,
  } as unknown as Request;
}

describe('isIdempotencyCandidate', () => {
  it('accepts a POST with the header', () => {
    expect(isIdempotencyCandidate(mockRequest({ method: 'POST', path: '/students' }))).toBe(true);
  });

  it('rejects non-mutating methods', () => {
    expect(isIdempotencyCandidate(mockRequest({ method: 'GET', path: '/students' }))).toBe(false);
  });

  it('rejects when the header is missing', () => {
    expect(isIdempotencyCandidate(mockRequest({ method: 'POST', path: '/students', headers: {} }))).toBe(false);
  });

  it.each(['/health', '/api/docs', '/platform/tenants', '/public/student-id', '/attendance/devices/ingest/abc', '/integrations/webhooks/x'])(
    'rejects callback/platform surface %s',
    (path) => {
      expect(isIdempotencyCandidate(mockRequest({ method: 'POST', path }))).toBe(false);
    },
  );
});

describe('buildIdempotencyKey', () => {
  it('is scoped to user, tenant, method, path and key', () => {
    const a = buildIdempotencyKey(
      mockRequest({ method: 'POST', path: '/students', resolvedTenant: { id: 'ten-1' }, user: { id: 'u-1' } }),
      'k1',
    );
    const b = buildIdempotencyKey(
      mockRequest({ method: 'POST', path: '/students', resolvedTenant: { id: 'ten-1' }, user: { id: 'u-1' } }),
      'k1',
    );
    const differentTenant = buildIdempotencyKey(
      mockRequest({ method: 'POST', path: '/students', resolvedTenant: { id: 'ten-2' }, user: { id: 'u-1' } }),
      'k1',
    );
    const differentPath = buildIdempotencyKey(
      mockRequest({ method: 'POST', path: '/students/5', resolvedTenant: { id: 'ten-1' }, user: { id: 'u-1' } }),
      'k1',
    );
    expect(a).toBe(b);
    expect(a).not.toBe(differentTenant);
    expect(a).not.toBe(differentPath);
    expect(a.startsWith('idem:')).toBe(true);
  });

  it('degrades to no-tenant/no-user scoping when unauthenticated', () => {
    const k = buildIdempotencyKey(
      mockRequest({ method: 'POST', path: '/auth/forgot-password', resolvedTenant: undefined, user: undefined }),
      'k1',
    );
    expect(k.startsWith('idem:')).toBe(true);
    expect(k.length).toBeGreaterThan(32);
  });
});