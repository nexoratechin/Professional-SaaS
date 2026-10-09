import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { TenantResolutionMiddleware } from '../../common/middleware/tenant-resolution.middleware';
import { TenantConnectionModule } from '../../common/tenant/tenant-connection.module';
import { TenantLookupService } from '../../common/tenant/tenant-lookup.service';
import { RbacModule } from '../rbac/rbac.module';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, TenantConnectionModule],
  controllers: [TenantsController],
  providers: [
    TenantsService,
    TenantProvisioningService,
    TenantDatabaseService,
    TenantLookupService,
    TenantResolutionMiddleware,
  ],
  exports: [TenantLookupService, TenantResolutionMiddleware],
})
export class TenantsModule {}
