import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { TenantConfigurationModule } from '../tenant-configuration/tenant-configuration.module';
import { CertificatesController } from './certificates.controller';
import { PublicCertificatesController } from './public-certificates.controller';
import { CertificatesService } from './certificates.service';

@Module({
  imports: [
    CommonGuardsModule,
    RbacModule,
    TenantConfigurationModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.CERTIFICATE_GENERATION }),
    BullModule.registerQueue({ name: QUEUE_NAMES.PDF_GENERATION }),
  ],
  controllers: [CertificatesController, PublicCertificatesController],
  providers: [CertificatesService],
  exports: [CertificatesService],
})
export class CertificatesModule {}