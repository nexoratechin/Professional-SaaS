import { normalizeUrl, routePathOf, statusClass, truncateLabel } from './route-normalizer';

describe('route-normalizer', () => {
  it('prefers the matched Express route pattern', () => {
    expect(
      routePathOf({ route: { path: '/students/:id' }, baseUrl: '/api', originalUrl: '/api/students/abc' }),
    ).toBe('/api/students/:id');
  });

  it('normalizes unmatched URLs by templating identifier segments', () => {
    expect(normalizeUrl('/students/550e8400-e29b-41d4-a716-446655440000/grades?term=1')).toBe('/students/:id/grades');
    expect(normalizeUrl('/fees/receipts/12345')).toBe('/fees/receipts/:id');
    expect(normalizeUrl('/webhooks/whk_9f8e7d6c5b4a3210abcdef')).toBe('/webhooks/:id');
    expect(normalizeUrl('/students')).toBe('/students');
  });

  it('keeps short static segments untouched', () => {
    expect(normalizeUrl('/health/ready')).toBe('/health/ready');
    expect(normalizeUrl('/api/docs')).toBe('/api/docs');
  });

  it('drops query strings and hashes', () => {
    expect(normalizeUrl('/reports/export?format=pdf#section')).toBe('/reports/export');
    expect(normalizeUrl('')).toBe('/');
  });

  it('buckets statuses into classes', () => {
    expect(statusClass(200)).toBe('2xx');
    expect(statusClass(301)).toBe('3xx');
    expect(statusClass(404)).toBe('4xx');
    expect(statusClass(503)).toBe('5xx');
    expect(statusClass(99)).toBe('other');
  });

  it('truncates long label values', () => {
    expect(truncateLabel('abcdef', 5)).toBe('abcde…');
    expect(truncateLabel('abc', 5)).toBe('abc');
  });
});
