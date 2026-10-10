import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

/**
 * JSON cache on the shared ioredis connection. Sits alongside the bespoke
 * `perms:`/`features:`/`search:suggest:` keys already in the codebase and gives
 * read-heavy endpoints (dashboards, catalogs, aggregate summaries) a single,
 * tenant-aware place to memoize a computed result.
 *
 * Design rules (all deliberate):
 *  • Every failure is swallowed and degrades to a cache miss — a Redis blip must
 *    never fail the request it was trying to accelerate.
 *  • Keys are namespaced `cache:<domain>:<tenantId>:…` so a tenant can be
 *    invalidated by prefix without touching another tenant's entries.
 *  • `delByPrefix` uses SCAN, never KEYS, so an invalidation cannot block Redis
 *    on a large keyspace.
 */
@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private static readonly PREFIX = 'cache';

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Builds a namespaced, tenant-scoped key: cache:<domain>:<tenantId>:<parts…>. */
  key(domain: string, tenantId: string, ...parts: Array<string | number>): string {
    return [CacheService.PREFIX, domain, tenantId, ...parts.map((p) => String(p))].join(':');
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (error) {
      this.logger.debug(`cache get failed for ${key}: ${(error as Error).message}`);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch (error) {
      this.logger.debug(`cache set failed for ${key}: ${(error as Error).message}`);
    }
  }

  /** Returns the cached value, or computes + stores it. Cache misses never throw. */
  async remember<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.debug(`cache del failed for ${key}: ${(error as Error).message}`);
    }
  }

  /**
   * Removes every entry under a namespaced prefix (e.g. invalidate one tenant's
   * cached dashboard). SCAN-based and bounded per call so it stays safe on the
   * shared Redis.
   */
  async delByPrefix(prefix: string): Promise<void> {
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch (error) {
      this.logger.debug(`cache delByPrefix failed for ${prefix}: ${(error as Error).message}`);
    }
  }

  /** Convenience for the common "invalidate a tenant's whole domain" case. */
  invalidateTenantDomain(domain: string, tenantId: string): Promise<void> {
    return this.delByPrefix(this.key(domain, tenantId));
  }
}
