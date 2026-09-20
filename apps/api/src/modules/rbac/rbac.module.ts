import { Module } from '@nestjs/common';
import { EntitlementsGatewayService } from './entitlements-gateway.service';
import { EntitlementsService } from './entitlements.service';
import { PermissionsService } from './permissions.service';
import { TenantFeaturesService } from './tenant-features.service';

@Module({
  providers: [PermissionsService, TenantFeaturesService, EntitlementsService, EntitlementsGatewayService],
  exports: [PermissionsService, TenantFeaturesService, EntitlementsService, EntitlementsGatewayService],
})
export class RbacModule {}
