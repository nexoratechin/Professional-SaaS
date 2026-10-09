import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { DeadLetterProcessor } from './dead-letter.processor';
import { DeadLetterService } from './dead-letter.service';
import { QueueEventsBridgeService } from './queue-events-bridge.service';
import { QueueMonitorService } from './queue-monitor.service';

/**
 * Cross-cutting background-job infrastructure: the dead-letter sink, the queue-events bridge that
 * keeps the job-status registry current and routes terminal failures to the DLQ, and periodic
 * queue telemetry. Global so any processor can inject DeadLetterService without re-importing it.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE_NAMES.DEAD_LETTER })],
  providers: [DeadLetterService, DeadLetterProcessor, QueueEventsBridgeService, QueueMonitorService],
  exports: [DeadLetterService],
})
export class JobsModule {}
