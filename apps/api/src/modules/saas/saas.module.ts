import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { BillingModule } from '../billing/billing.module';
import { RbacModule } from '../rbac/rbac.module';
import { SaasController } from './saas.controller';
import { SaasService } from './saas.service';
import { TenantSubscriptionsController } from './tenant-subscriptions.controller';

@Module({
  imports: [CommonGuardsModule, RbacModule, BillingModule],
  controllers: [SaasController, TenantSubscriptionsController],
  providers: [SaasService],
})
export class SaasModule {}