import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { DataImportProcessor } from './data-import.processor';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.DATA_IMPORTS })],
  providers: [DataImportProcessor],
})
export class DataImportProcessorModule {}
