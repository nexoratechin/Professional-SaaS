import { Global, Injectable, Logger, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  TenantDatabaseSecretCipher,
  descriptorsToTargets,
  platformPrismaClient,
  tenantConnectionRegistry,
} from '@college-erp/database';
import { AppConfigService } from '../../config/app-config.service';

const REFRESH_INTERVAL_MS = 60_000;

/**
 * Loads enterprise tenants' dedicated-store connections into the process-local registry so
 * `createTenantScopedClient(tenantId)` (used throughout the worker's processors) routes each job
 * to the tenant's schema/database. Refreshes on an interval so a store provisioned after the
 * worker started is picked up without a restart.
 */
@Injectable()
export class TenantConnectionBootstrapService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantConnectionBootstrapService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly config: AppConfigService) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get('TENANT_DB_ISOLATION_ENABLED')) return;
    await this.refresh();
    this.timer = setInterval(() => void this.refresh(), REFRESH_INTERVAL_MS);
    // Do not keep the process alive solely for the refresh timer.
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private async refresh(): Promise<void> {
    const key = this.config.get('TENANT_DB_SECRET_KEY');
    if (!key) return;
    try {
      const cipher = new TenantDatabaseSecretCipher(key);
      const rows = await platformPrismaClient.tenantDatabase.findMany({
        where: { mode: { not: 'SHARED' }, status: 'READY' },
      });
      tenantConnectionRegistry.replaceAll(descriptorsToTargets(rows, cipher));
    } catch (error) {
      this.logger.warn(
        `Could not refresh enterprise tenant connections: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

@Global()
@Module({
  providers: [TenantConnectionBootstrapService],
})
export class TenantConnectionModule {}
