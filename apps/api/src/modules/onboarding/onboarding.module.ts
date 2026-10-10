import { Module } from '@nestjs/common';
import { BrandingModule } from '../branding/branding.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationModule } from '../organization/organization.module';
import { RbacModule } from '../rbac/rbac.module';
import { TenantConfigurationModule } from '../tenant-configuration/tenant-configuration.module';
import { TenantsModule } from '../tenants/tenants.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';

/**
 * Self-service college onboarding wizard. Composes the existing tenant/provisioning,
 * configuration, branding, organization, entitlements and notification engines into one public,
 * resumable ten-step flow — it owns no business logic those modules already provide, only the
 * OnboardingSession lifecycle that sequences them.
 */
@Module({
  imports: [
    TenantsModule,
    TenantConfigurationModule,
    BrandingModule,
    OrganizationModule,
    RbacModule,
    NotificationsModule,
  ],
  controllers: [OnboardingController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
