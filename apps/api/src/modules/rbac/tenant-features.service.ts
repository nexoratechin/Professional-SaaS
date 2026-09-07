import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { FEATURE_KEYS, type FeatureKey } from '@college-erp/auth';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

const CACHE_TTL_SECONDS = 60;
const ACTIVE_SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'] as const;

function cacheKey(tenantId: string): string {
  return `features:${tenantId}`;
}

/** Effective feature flags = active subscription's plan mapping, then TenantFeatureFlag
 * overrides applied on top (override always wins). Redis-cached (60s), invalidated whenever a
 * tenant's subscription/plan/override changes — this is what lets plan/entitlement changes take
 * effect without a code deploy. */
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

    const [activeSubscription, overrides] = await Promise.all([
      this.tenantPrisma.client.subscription.findFirst({
        where: { status: { in: [...ACTIVE_SUBSCRIPTION_STATUSES] } },
        orderBy: { createdAt: 'desc' },
        include: { plan: { include: { planFeatures: { include: { featureFlag: true } } } } },
      }),
      this.tenantPrisma.client.tenantFeatureFlag.findMany({ include: { featureFlag: true } }),
    ]);

    const effective = Object.fromEntries(Object.values(FEATURE_KEYS).map((key) => [key, false])) as Record<
      FeatureKey,
      boolean
    >;

    if (activeSubscription) {
      for (const planFeature of activeSubscription.plan.planFeatures) {
        effective[planFeature.featureFlag.key as FeatureKey] = true;
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
