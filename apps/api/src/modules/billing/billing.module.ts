import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { BillingConfigController } from './billing-config.controller';
import { BillingConfigService } from './billing-config.service';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * SaaS billing: invoice generation (tax + sequential numbers), reconciliation of recorded
 * payments, SaaS-wide billing config, and on-demand invoice PDFs. Deliberately does NOT import
 * SaasModule (Saas→Billing, never the reverse) so the plan-change flow can reuse invoice
 * generation without a circular dependency.
 */
@Module({
  imports: [CommonGuardsModule],
  controllers: [InvoicesController, PaymentsController, BillingConfigController],
  providers: [BillingConfigService, InvoicesService, PaymentsService],
  exports: [BillingConfigService, InvoicesService, PaymentsService],
})
export class BillingModule {}