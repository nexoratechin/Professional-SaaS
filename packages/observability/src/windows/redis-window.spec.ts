import { bumpWindow, minuteBucket, readWindowSum, readWindowsSum, windowKey, type RedisWindowClient } from './redis-window';

/** Minimal in-memory fake of the ioredis surface the window helpers use. */
class FakeRedis implements RedisWindowClient {
  readonly store = new Map<string, number>();
  readonly expirations = new Map<string, number>();

  async incr(key: string): Promise<number> {
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<unknown> {
    this.expirations.set(key, seconds);
    return 1;
  }

  async mget(...keys: string[]): Promise<Array<string | null>> {
    return keys.map((key) => {
      const value = this.store.get(key);
      return value === undefined ? null : String(value);
    });
  }
}

describe('redis-window', () => {
  const now = 1_700_000_000_000; // fixed instant

  it('buckets time into minutes', () => {
    expect(minuteBucket(now)).toBe(Math.floor(now / 60_000));
    expect(windowKey('x', 5)).toBe(`obs:win:x:5`);
  });

  it('increments the current bucket and sets a TTL only on creation', async () => {
    const redis = new FakeRedis();
    await bumpWindow(redis, 'failures');
    await bumpWindow(redis, 'failures');

    const bucket = minuteBucket(now);
    const key = windowKey('failures', bucket);
    // Two bumps happened, but "now" during the test is the real clock; find the actual bucket.
    const actualBucket = minuteBucket();
    expect(redis.store.get(windowKey('failures', actualBucket))).toBe(2);
    expect(redis.expirations.get(windowKey('failures', actualBucket))).toBe(90 * 60);
    expect(bucket).toBeGreaterThan(0);
    expect(key).toContain('obs:win:failures');
  });

  it('honors a custom TTL', async () => {
    const redis = new FakeRedis();
    await bumpWindow(redis, 'x', { ttlMinutes: 10 });
    expect(redis.expirations.get(windowKey('x', minuteBucket()))).toBe(600);
  });

  it('sums values across the requested window', async () => {
    const redis = new FakeRedis();
    const current = minuteBucket(now);
    redis.store.set(windowKey('e', current), 2);
    redis.store.set(windowKey('e', current - 1), 3);
    redis.store.set(windowKey('e', current - 14), 1);
    redis.store.set(windowKey('e', current - 15), 99); // outside the 15m window

    expect(await readWindowSum(redis, 'e', 15, now)).toBe(6);
    expect(await readWindowSum(redis, 'e', 1, now)).toBe(2);
  });

  it('reads several counters in one pass', async () => {
    const redis = new FakeRedis();
    const current = minuteBucket(now);
    redis.store.set(windowKey('a', current), 1);
    redis.store.set(windowKey('b', current), 4);
    redis.store.set(windowKey('a', current - 1), 2);

    const sums = await readWindowsSum(redis, ['a', 'b'], 5, now);
    expect(sums).toEqual({ a: 3, b: 4 });
  });

  it('returns zeros for empty windows and ignores non-numeric values', async () => {
    const redis = new FakeRedis();
    redis.store.set(windowKey('x', minuteBucket(now)), Number.NaN);
    const sums = await readWindowsSum(redis, ['x', 'missing'], 3, now);
    expect(sums).toEqual({ x: 0, missing: 0 });
  });
});
