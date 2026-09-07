import { Injectable, Scope } from '@nestjs/common';
import { createTenantScopedClient, type TenantScopedPrismaClient } from '@college-erp/database';
import { TenantContextService } from './tenant-context.service';

/**
 * Every domain/tenant service injects this — never PlatformPrismaService directly. Wraps the
 * shared Prisma client with the tenant-guard extension (see packages/database/src/client.ts),
 * which auto-injects/validates tenantId on every operation for tenant-owned models. Client is
 * built lazily and memoized once per request, once TenantContextService has been populated by
 * TenantMatchGuard.
 */
@Injectable({ scope: Scope.REQUEST })
export class TenantScopedPrismaService {
  private cachedClient: TenantScopedPrismaClient | null = null;

  constructor(private readonly tenantContext: TenantContextService) {}

  get client(): TenantScopedPrismaClient {
    if (!this.tenantContext.tenantId) {
      throw new Error(
        'TenantScopedPrismaService accessed before tenant context was established — ' +
          'ensure TenantMatchGuard runs ahead of this provider on the route.',
      );
    }
    if (!this.cachedClient) {
      this.cachedClient = createTenantScopedClient(this.tenantContext.tenantId);
    }
    return this.cachedClient;
  }
}
