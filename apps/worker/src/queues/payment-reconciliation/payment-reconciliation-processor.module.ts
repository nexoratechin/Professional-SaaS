import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { PaymentReconciliationProcessor } from './payment-reconciliation.processor';
import { PaymentReconciliationSchedulerService } from './payment-reconciliation-scheduler.service';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.PAYMENT_RECONCILIATION })],
  providers: [PaymentReconciliationProcessor, PaymentReconciliationSchedulerService],
})
export class PaymentReconciliationProcessorModule {}
