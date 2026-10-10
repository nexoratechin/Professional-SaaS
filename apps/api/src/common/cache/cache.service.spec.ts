/**
 * CacheService contract: JSON get/set, a `remember` that only computes on a miss, SCAN-based
 * prefix invalidation, and — critically — graceful degradation to a cache miss when Redis itself
 * throws, so a cache outage can never fail the request it was trying to accelerate.
 */
import type Redis from 'ioredis';
import { CacheService } from './cache.service';

class FakeRedis {
  store = new Map<string, string>();
  failNext = false;

  private maybeThrow(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('redis down');
    }
  }

  async get(key: string): Promise<string | null> {
    this.maybeThrow();
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.maybeThrow();
    this.store.set(key, value);
    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    this.maybeThrow();
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }

  async scan(_cursor: string, _match: string, pattern: string): Promise<[string, string[]]> {
    this.maybeThrow();
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return ['0', [...this.store.keys()].filter((key) => key.startsWith(prefix))];
  }
}

function make() {
  const redis = new FakeRedis();
  return { redis, service: new CacheService(redis as unknown as Redis) };
}

describe('CacheService', () => {
  it('namespaces keys by domain and tenant', () => {
    const { service } = make();
    expect(service.key('students', 'tenant-1', 'summary', 'user-9')).toBe('cache:students:tenant-1:summary:user-9');
  });

  it('remember() computes once then serves the cached value', async () => {
    const { service } = make();
    const factory = jest.fn().mockResolvedValue({ total: 42 });
    const key = service.key('students', 'tenant-1', 'summary', 'u1');

    const first = await service.remember(key, 30, factory);
    const second = await service.remember(key, 30, factory);

    expect(first).toEqual({ total: 42 });
    expect(second).toEqual({ total: 42 });
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it('delByPrefix() invalidates only the targeted tenant/domain', async () => {
    const { service } = make();
    await service.set(service.key('students', 'tenant-1', 'summary', 'u1'), { a: 1 }, 30);
    await service.set(service.key('students', 'tenant-1', 'summary', 'u2'), { a: 2 }, 30);
    await service.set(service.key('students', 'tenant-2', 'summary', 'u1'), { a: 3 }, 30);

    await service.invalidateTenantDomain('students', 'tenant-1');

    expect(await service.get(service.key('students', 'tenant-1', 'summary', 'u1'))).toBeNull();
    expect(await service.get(service.key('students', 'tenant-1', 'summary', 'u2'))).toBeNull();
    expect(await service.get(service.key('students', 'tenant-2', 'summary', 'u1'))).toEqual({ a: 3 });
  });

  it('degrades to a cache miss when Redis throws', async () => {
    const { redis, service } = make();
    await service.set('cache:x:y', { v: 1 }, 30);
    redis.failNext = true;
    await expect(service.get('cache:x:y')).resolves.toBeNull();
  });
});
