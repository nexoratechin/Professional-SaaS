import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { TenantConnectionService } from './tenant-connection.service';

/** Loads every READY dedicated store into the registry at boot so the very first request for an
 * enterprise tenant is routed correctly (per-request registration is the fallback). */
@Injectable()
export class TenantConnectionBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(TenantConnectionBootstrapService.name);

  constructor(
    private readonly connection: TenantConnectionService,
    private readonly config: AppConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.get('TENANT_DB_ISOLATION_ENABLED')) return;
    try {
      await this.connection.loadAll();
      this.logger.log('Loaded enterprise tenant database connections.');
    } catch (error) {
      // Never block boot: per-request registration still routes correctly. A transient database
      // hiccup must not take the whole API down.
      this.logger.warn(
        `Could not preload enterprise tenant connections: ${error instanceof Error ? error.message : error}`,
      );
    }
  }
}

@Global()
@Module({
  providers: [TenantConnectionService, TenantConnectionBootstrapService],
  exports: [TenantConnectionService],
})
export class TenantConnectionModule {}
