import { Global, Module } from '@nestjs/common';
import { TenantMembershipService } from './tenant-membership.service';

/** Global so every account-creating flow (invite, SSO provisioning, onboarding) can record a
 * membership without importing a feature module. Depends only on the global PrismaModule. */
@Global()
@Module({
  providers: [TenantMembershipService],
  exports: [TenantMembershipService],
})
export class TenantMembershipModule {}
