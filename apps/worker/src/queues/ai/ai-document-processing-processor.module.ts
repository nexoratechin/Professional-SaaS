import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { AiDocumentProcessingProcessor } from './ai-document-processing.processor';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.AI_DOCUMENT_PROCESSING })],
  providers: [AiDocumentProcessingProcessor],
})
export class AiDocumentProcessingProcessorModule {}
