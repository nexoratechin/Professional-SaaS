import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { TenantConfigurationController } from './tenant-configuration.controller';
import { TenantConfigurationService } from './tenant-configuration.service';

@Module({
  imports: [CommonGuardsModule],
  controllers: [TenantConfigurationController],
  providers: [TenantConfigurationService],
  exports: [TenantConfigurationService],
})
export class TenantConfigurationModule {}
