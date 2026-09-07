import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { platformPrismaClient } from '@college-erp/database';

/**
 * Unscoped Prisma access — for platform-admin (control-plane) services ONLY (saas/ module) and
 * for the narrow, documented exceptions where tenant scoping must be applied manually
 * (tenant lookup in TenantResolutionMiddleware, credential lookup in AuthService.login before a
 * JWT/tenant context exists). Domain/tenant services must inject TenantScopedPrismaService
 * instead.
 */
@Injectable()
export class PlatformPrismaService implements OnModuleDestroy {
  readonly client = platformPrismaClient;

  async onModuleDestroy() {
    await this.client.$disconnect();
  }
}
