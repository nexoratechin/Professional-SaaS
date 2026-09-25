import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { DocumentRetentionSchedulerService } from './document-retention-scheduler.service';
import { DocumentRetentionSweepProcessor } from './document-retention.processor';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.DOCUMENT_RETENTION })],
  providers: [DocumentRetentionSweepProcessor, DocumentRetentionSchedulerService],
})
export class DocumentRetentionProcessorModule {}