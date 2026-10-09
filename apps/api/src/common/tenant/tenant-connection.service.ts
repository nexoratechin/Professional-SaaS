import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  TenantDatabaseSecretCipher,
  descriptorToTarget,
  descriptorsToTargets,
  tenantConnectionRegistry,
  type TenantConnectionTarget,
} from '@college-erp/database';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../prisma/platform-prisma.service';

/**
 * Bridges the persisted `tenant_databases` rows and the process-local TenantConnectionRegistry
 * that `createTenantScopedClient` consults.
 *
 * For a DEDICATED_* tenant this decrypts the store's connection URL once and caches the target in
 * memory; the registry is then consulted synchronously on every Prisma call. A dedicated tenant
 * whose store is not READY is reported as unroutable, so the middleware rejects the request rather
 * than silently serving the shared database.
 */
@Injectable()
export class TenantConnectionService {
  private readonly logger = new Logger(TenantConnectionService.name);
  private cipher: TenantDatabaseSecretCipher | null = null;

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly config: AppConfigService,
  ) {}

  get isEnabled(): boolean {
    return this.config.get('TENANT_DB_ISOLATION_ENABLED') && this.getCipher() !== null;
  }

  private getCipher(): TenantDatabaseSecretCipher | null {
    if (this.cipher) return this.cipher;
    const key = this.config.get('TENANT_DB_SECRET_KEY');
    if (!key) return null;
    this.cipher = new TenantDatabaseSecretCipher(key);
    return this.cipher;
  }

  /** Loads every READY dedicated store into the registry (startup + periodic refresh). */
  async loadAll(): Promise<void> {
    const cipher = this.getCipher();
    if (!cipher) return;
    const rows = await this.platformPrisma.client.tenantDatabase.findMany({
      where: { mode: { not: 'SHARED' }, status: 'READY' },
    });
    tenantConnectionRegistry.replaceAll(descriptorsToTargets(rows, cipher));
  }

  /**
   * Ensures the registry knows how to route `tenantId`. Returns true when the tenant's dedicated
   * store is READY and registered; false when it is not (or no dedicated store exists).
   */
  async ensureRegistered(tenantId: string): Promise<boolean> {
    if (tenantConnectionRegistry.has(tenantId)) return true;
    const cipher = this.getCipher();
    if (!cipher) return false;

    const row = await this.platformPrisma.client.tenantDatabase.findUnique({ where: { tenantId } });
    if (!row) return false;
    const target = descriptorToTarget(row, cipher);
    if (!target) return false;
    tenantConnectionRegistry.upsert(target);
    return true;
  }

  remove(tenantId: string): void {
    tenantConnectionRegistry.remove(tenantId);
  }

  getTarget(tenantId: string): TenantConnectionTarget | undefined {
    return tenantConnectionRegistry.get(tenantId);
  }

  /** Registers an already-resolved target (used right after provisioning). */
  register(target: TenantConnectionTarget): void {
    tenantConnectionRegistry.upsert(target);
  }

  /** Rejects a request for a dedicated tenant whose store is not routable. */
  assertRoutable(tenantId: string): void {
    if (!tenantConnectionRegistry.has(tenantId)) {
      this.logger.error(`Dedicated store for tenant ${tenantId} is not READY/routable.`);
      throw new ServiceUnavailableException('This tenant\u2019s database is not available.');
    }
  }
}
