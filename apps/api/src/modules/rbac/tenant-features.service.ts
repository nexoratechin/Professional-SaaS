import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { FEATURE_KEYS, type FeatureKey } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

const CACHE_TTL_SECONDS = 60;

function cacheKey(tenantId: string): string {
  return `features:${tenantId}`;
}

/** Effective feature flags = the tenant's materialized Entitlement rows (kept up to date by
 * EntitlementsService.recompute — see its doc comment for the full subscription→entitlement
 * pipeline), then TenantFeatureFlag overrides applied on top (override always wins, unchanged
 * from before this was Entitlement-backed). Redis-cached (60s), invalidated whenever a tenant's
 * subscription/plan/override changes — this is what lets plan/entitlement changes take effect
 * without a code deploy. */
@Injectable()
export class TenantFeaturesService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getEffectiveFeatures(tenantId: string): Promise<Record<FeatureKey, boolean>> {
    const cached = await this.redis.get(cacheKey(tenantId));
    if (cached) {
      return JSON.parse(cached) as Record<FeatureKey, boolean>;
    }

    const [entitlements, overrides] = await Promise.all([
      this.tenantPrisma.client.entitlement.findMany({
        where: {
          type: 'BOOLEAN',
          OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
        },
      }),
      this.tenantPrisma.client.tenantFeatureFlag.findMany({ include: { featureFlag: true } }),
    ]);

    const effective = Object.fromEntries(Object.values(FEATURE_KEYS).map((key) => [key, false])) as Record<
      FeatureKey,
      boolean
    >;

    for (const entitlement of entitlements) {
      if (entitlement.key in effective) {
        effective[entitlement.key as FeatureKey] = entitlement.boolValue;
      }
    }
    for (const override of overrides) {
      effective[override.featureFlag.key as FeatureKey] = override.enabled;
    }

    await this.redis.set(cacheKey(tenantId), JSON.stringify(effective), 'EX', CACHE_TTL_SECONDS);
    return effective;
  }

  async isEnabled(tenantId: string, feature: FeatureKey): Promise<boolean> {
    const features = await this.getEffectiveFeatures(tenantId);
    return features[feature] === true;
  }

  async invalidate(tenantId: string): Promise<void> {
    await this.redis.del(cacheKey(tenantId));
  }
}
