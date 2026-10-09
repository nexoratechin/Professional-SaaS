/**
 * Process-local registry of enterprise tenants' physical connection targets.
 *
 * `createTenantScopedClient(tenantId)` is synchronous and called from hundreds of places, so it
 * cannot do an async database lookup. This registry is the synchronous lookup it consults: an
 * empty registry (the default) means every tenant is SHARED, preserving today's behavior exactly.
 *
 * The registry is populated:
 *   - in apps/api, per request by TenantConnectionService when a DEDICATED_* tenant is resolved
 *     (and at startup);
 *   - in apps/worker, at startup and on an interval.
 *
 * A dedicated target is only ever registered once its store is READY, so a partially-provisioned
 * enterprise tenant can never silently fall back to the shared database.
 */
import type { TenantConnectionTarget, TenantIsolationMode } from './types';

export class TenantConnectionRegistry {
  private readonly targets = new Map<string, TenantConnectionTarget>();

  upsert(target: TenantConnectionTarget): void {
    this.targets.set(target.tenantId, target);
  }

  remove(tenantId: string): void {
    this.targets.delete(tenantId);
  }

  has(tenantId: string): boolean {
    return this.targets.has(tenantId);
  }

  get(tenantId: string): TenantConnectionTarget | undefined {
    return this.targets.get(tenantId);
  }

  list(): TenantConnectionTarget[] {
    return [...this.targets.values()];
  }

  get size(): number {
    return this.targets.size;
  }

  clear(): void {
    this.targets.clear();
  }

  /** Replaces the whole registry in one shot (used by the startup/interval loader). */
  replaceAll(targets: readonly TenantConnectionTarget[]): void {
    this.targets.clear();
    for (const target of targets) {
      this.targets.set(target.tenantId, target);
    }
  }

  /** True when a tenant is expected to route somewhere other than the shared database. */
  isDedicated(tenantId: string, mode: TenantIsolationMode): boolean {
    return mode !== 'SHARED' || this.targets.has(tenantId);
  }
}

/** The process-wide registry consumed by createTenantScopedClient. */
export const tenantConnectionRegistry = new TenantConnectionRegistry();
