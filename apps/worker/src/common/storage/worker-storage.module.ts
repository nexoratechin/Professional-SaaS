import { Module } from '@nestjs/common';
import { WorkerStorageService } from './worker-storage.service';

@Module({
  providers: [WorkerStorageService],
  exports: [WorkerStorageService],
})
export class WorkerStorageModule {}