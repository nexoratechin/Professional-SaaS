import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { PdfGenerationProcessor } from './pdf-generation.processor';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.PDF_GENERATION })],
  providers: [PdfGenerationProcessor],
})
export class PdfGenerationProcessorModule {}
