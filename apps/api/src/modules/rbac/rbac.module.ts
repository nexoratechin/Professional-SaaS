import { Module } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import { TenantFeaturesService } from './tenant-features.service';

@Module({
  providers: [PermissionsService, TenantFeaturesService],
  exports: [PermissionsService, TenantFeaturesService],
})
export class RbacModule {}
