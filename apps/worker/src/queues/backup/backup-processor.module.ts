import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupProcessor } from './backup.processor';
import { BackupService } from './backup.service';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.BACKUP })],
  providers: [BackupService, BackupProcessor, BackupSchedulerService],
})
export class BackupProcessorModule {}
