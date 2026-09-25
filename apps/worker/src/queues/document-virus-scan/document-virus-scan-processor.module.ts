import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { DocumentVirusScanProcessor } from './document-virus-scan.processor';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.DOCUMENT_VIRUS_SCAN })],
  providers: [DocumentVirusScanProcessor],
})
export class DocumentVirusScanProcessorModule {}