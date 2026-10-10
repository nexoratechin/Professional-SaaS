import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { TenantConfigurationModule } from '../tenant-configuration/tenant-configuration.module';
import { BrandingService } from './branding.service';
import { PublicBrandingController } from './public-branding.controller';
import { TenantBrandingController } from './tenant-branding.controller';

/**
 * White-label tenant branding. The configuration document itself is owned by
 * TenantConfigurationModule (branding is a section of it); this module adds the public projection,
 * asset handling and the admin endpoints on top of that document.
 */
@Module({
  imports: [CommonGuardsModule, TenantConfigurationModule],
  controllers: [TenantBrandingController, PublicBrandingController],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
