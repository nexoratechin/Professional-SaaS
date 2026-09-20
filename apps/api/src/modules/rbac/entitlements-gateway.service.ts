import { Injectable } from '@nestjs/common';
import type { EntitlementKey, FeatureKey } from '@college-erp/auth';
import { ENTITLEMENT_MODULE_MAP } from '@college-erp/auth';
import { EntitlementsService } from './entitlements.service';
import { TenantFeaturesService } from './tenant-features.service';

/**
 * Single centralized gateway for resolving EVERY feature/entitlement question in the system —
 * backend services, API route guards, the worker's background jobs, and (through the tenant
 * self-service entitlement endpoint) the frontend/navigation all funnel through this one service
 * so entitlement logic lives in exactly one place.
 *
 * It reconciles TWO catalogs:
 *   - Module-level boolean feature flags (FEATURE_KEYS), backed by the materialized Entitlement
 *     rows / TenantFeaturesService (Redis-cached effective flags).
 *   - Granular entitlements (ENTITLEMENT_KEYS, e.g. `attendance.qr`, `fees.online_payment`),
 *     backed by the materialized Entitlement rows themselves via EntitlementsService.
 *
 * If an entitlement key was never materialized (e.g. a brand-new key added after a tenant's last
 * recompute), the gateway falls back to the tenant's module flag for boolean granular keys: being
 * entitled to the module implies being entitled to a newly-introduced default sub-feature until
 * the next recompute. This keeps new granular capabilities instantly usable without requiring a
 * plan/module flush, while still letting a specific tenant/plan opt them out cleanly via an
 * override or by dropping the PlanModule.
 */
@Injectable()
export class EntitlementsGatewayService {
  constructor(
    private readonly entitlements: EntitlementsService,
    private readonly tenantFeatures: TenantFeaturesService,
  ) {}

  /** Is this tenant entitled to a module-level feature flag? Backs @RequireFeature(). */
  async isFeatureEnabled(tenantId: string, feature: FeatureKey): Promise<boolean> {
    return this.tenantFeatures.isEnabled(tenantId, feature);
  }

  /** All currently-effective module feature flags. */
  async getFeatures(tenantId: string): Promise<Record<FeatureKey, boolean>> {
    return this.tenantFeatures.getEffectiveFeatures(tenantId);
  }

  /** Is this tenant entitled to a granular entitlement key? */
  async isEntitled(tenantId: string, key: EntitlementKey): Promise<boolean> {
    return this.entitlements.isEntitled(tenantId, key);
  }

  /**
   * Granular entitlement check with module-fallback. Returns true when either the granular
   * entitlement row is materialized-and-enabled OR (no row exists yet) the tenant is entitled to
   * the *module* the key belongs to. See the class doc comment for the rationale.
   */
  async canUse(tenantId: string, key: EntitlementKey): Promise<boolean> {
    const directlyEntitled = await this.entitlements.isEntitled(tenantId, key);
    if (directlyEntitled) {
      return true;
    }
    const moduleKey = ENTITLEMENT_MODULE_MAP[key];
    return this.tenantFeatures.isEnabled(tenantId, moduleKey);
  }

  /** Every granular entitlement the tenant is currently effective-ly entitled to (incl. implied
   * via module flag). Used for the frontend/navigation to render nav items. */
  async listEffectiveEntitlements(tenantId: string): Promise<{
    entitlements: Record<string, boolean>;
    modules: Record<FeatureKey, boolean>;
  }> {
    const [features, rows] = await Promise.all([
      this.tenantFeatures.getEffectiveFeatures(tenantId),
      this.entitlements.listForTenant(tenantId),
    ]);

    const entitledKeys = new Set(rows.filter((row) => row.boolValue).map((row) => row.key));
    const entitlements: Record<string, boolean> = {};
    for (const entryKey of Object.keys(ENTITLEMENT_MODULE_MAP) as EntitlementKey[]) {
      const moduleEnabled = features[ENTITLEMENT_MODULE_MAP[entryKey]] === true;
      entitlements[entryKey] = entitledKeys.has(entryKey) || moduleEnabled;
    }

    return { entitlements, modules: features };
  }

  /** Quantity entitlement checked against a tenant's current count — e.g. multi_campus limit is
   * the canonical QUANTITY companion to the boolean multi_campus.enabled toggle. Returns true
   * until `limit` is not null AND `count` is at/over it. A null limit always passes. */
  async isWithinLimit(tenantId: string, key: string, count: number): Promise<boolean> {
    const limit = await this.entitlements.getLimit(tenantId, key);
    if (limit === null) {
      return true;
    }
    return count < limit;
  }

  async getLimit(tenantId: string, key: string): Promise<number | null> {
    return this.entitlements.getLimit(tenantId, key);
  }

  /** Convenience: one map of every granular capability for UI/hook consumption. */
  async getEntitlementMap(tenantId: string): Promise<Record<string, boolean>> {
    const { entitlements } = await this.listEffectiveEntitlements(tenantId);
    return entitlements;
  }
}