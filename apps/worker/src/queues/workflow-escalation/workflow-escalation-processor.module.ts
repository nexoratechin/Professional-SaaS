import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkflowEscalationSchedulerService } from './workflow-escalation-scheduler.service';
import { WorkflowEscalationProcessor } from './workflow-escalation.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.WORKFLOW_ESCALATION }, { name: QUEUE_NAMES.NOTIFICATIONS }),
  ],
  providers: [WorkflowEscalationProcessor, WorkflowEscalationSchedulerService],
})
export class WorkflowEscalationProcessorModule {}
