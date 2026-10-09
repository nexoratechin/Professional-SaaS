import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { TenantConfigurationModule } from '../tenant-configuration/tenant-configuration.module';
import { CampusAccessService } from './campus-access.service';
import { CampusAdminService } from './campus-admin.service';
import { CampusController } from './campus.controller';

/**
 * Multi-campus operations: university-level overview/comparison, per-campus configuration and the
 * institution-wide campus policy document. Reuses the org-scope/permission machinery configured in
 * CommonGuardsModule and the tenant configuration engine for the global policies document.
 */
@Module({
  imports: [CommonGuardsModule, TenantConfigurationModule],
  controllers: [CampusController],
  providers: [CampusAdminService, CampusAccessService],
})
export class CampusModule {}