import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { PlatformPrismaService } from '../prisma/platform-prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';
import type { ResolvedTenant } from '../types/tenant-request';

const CACHE_TTL_SECONDS = 60;

function cacheKey(slug: string): string {
  return `tenant:${slug}`;
}

/** Resolves a tenant slug to its id/status, Redis-cached (60s TTL). Falls back to Postgres via
 * the unscoped PlatformPrismaService — the one legitimate unscoped-lookup use case, since a
 * tenant can't be found "within" a tenant scope that doesn't exist yet. */
@Injectable()
export class TenantLookupService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async findBySlug(slug: string): Promise<ResolvedTenant | null> {
    const cached = await this.redis.get(cacheKey(slug));
    if (cached) {
      return JSON.parse(cached) as ResolvedTenant;
    }

    const tenant = await this.platformPrisma.client.tenant.findUnique({
      where: { slug },
      select: { id: true, slug: true, status: true },
    });
    if (!tenant) {
      return null;
    }

    await this.redis.set(cacheKey(slug), JSON.stringify(tenant), 'EX', CACHE_TTL_SECONDS);
    return tenant;
  }

  async invalidate(slug: string): Promise<void> {
    await this.redis.del(cacheKey(slug));
  }
}
