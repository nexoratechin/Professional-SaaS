import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { HelpdeskSlaSchedulerService } from './helpdesk-sla-scheduler.service';
import { HelpdeskSlaProcessor } from './helpdesk-sla.processor';

@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.HELPDESK_SLA }, { name: QUEUE_NAMES.NOTIFICATIONS })],
  providers: [HelpdeskSlaProcessor, HelpdeskSlaSchedulerService],
})
export class HelpdeskSlaProcessorModule {}
