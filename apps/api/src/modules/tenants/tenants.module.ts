import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { TenantResolutionMiddleware } from '../../common/middleware/tenant-resolution.middleware';
import { TenantLookupService } from '../../common/tenant/tenant-lookup.service';
import { RbacModule } from '../rbac/rbac.module';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [CommonGuardsModule, RbacModule],
  controllers: [TenantsController],
  providers: [TenantsService, TenantProvisioningService, TenantLookupService, TenantResolutionMiddleware],
  exports: [TenantLookupService, TenantResolutionMiddleware],
})
export class TenantsModule {}
