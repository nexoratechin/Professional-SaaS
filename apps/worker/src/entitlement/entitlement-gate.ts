import { Injectable, Logger } from '@nestjs/common';
import { platformPrismaClient } from '@college-erp/database';
import { ENTITLEMENT_MODULE_MAP, type EntitlementKey, type FeatureKey } from '@college-erp/auth';

/**
 * Lightweight, framework-light entitlement gate for the worker's background jobs.
 *
 * Background jobs run outside any HTTP request context, so there is no TenantResolutionMiddleware
 * and no request-scoped NestJS provider graph to inject into (the worker builds a tenant-scoped
 * Prisma client lazily and uses the unscoped platformPrismaClient for cross-tenant sweeps). These
 * jobs still must not perform work for a tenant that isn't entitled to it — e.g. don't fan out
 * AI-asstistant or advanced-analytics processing when the tenant's plan stripped that capability.
 *
 * It reads the same self-healing, materialized Entitlement table the API's
 * EntitlementsGatewayService does (rows carry effectiveUntil = currentPeriodEnd on recompute), so
 * an expired/suspended subscription's entitlements stop reading as enabled with no worker action.
 * Module-fallback is applied for granular keys exactly as the gateway does, so behavior matches.
 *
 * Every check is a plain SELECT; a failed check should lead the job to skip that tenant's work,
 * not throw (callers get a boolean).
 */
@Injectable()
export class EntitlementGate {
  private readonly logger = new Logger(EntitlementGate.name);

  /** Granular entitlement check WITH module fallback — mirrors EntitlementsGatewayService.canUse. */
  async canUse(tenantId: string, key: EntitlementKey): Promise<boolean> {
    const now = new Date();
    const row = await platformPrismaClient.entitlement.findFirst({
      where: { tenantId, key, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    });
    if (row?.boolValue === true) {
      return true;
    }
    const moduleKey = ENTITLEMENT_MODULE_MAP[key];
    return this.isFeatureEnabled(tenantId, moduleKey);
  }

  /** Module-level feature flag check — mirrors TenantFeaturesService.isEnabled but read straight
   * from the materialized row (no Redis cache in the worker). */
  async isFeatureEnabled(tenantId: string, feature: FeatureKey): Promise<boolean> {
    const now = new Date();
    const row = await platformPrismaClient.entitlement.findFirst({
      where: { tenantId, key: feature, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
    });
    const enabled = row?.boolValue === true;
    if (!enabled) {
      this.logger.debug(`Entitlement gap for tenant ${tenantId}: "${feature}"`);
    }
    return enabled;
  }
}