import { Injectable, Scope } from '@nestjs/common';

/**
 * Request-scoped tenant context. Populated once by TenantMatchGuard after it verifies the
 * JWT's tenantId matches the tenant resolved from the subdomain/header — every downstream
 * request-scoped provider in this same request (TenantScopedPrismaService, etc.) sees the same
 * instance and therefore the same tenantId.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantContextService {
  private _tenantId: string | null = null;
  private _tenantSlug: string | null = null;

  setTenant(tenantId: string, tenantSlug: string): void {
    this._tenantId = tenantId;
    this._tenantSlug = tenantSlug;
  }

  get tenantId(): string | null {
    return this._tenantId;
  }

  get tenantSlug(): string | null {
    return this._tenantSlug;
  }

  get isEstablished(): boolean {
    return this._tenantId !== null;
  }
}
