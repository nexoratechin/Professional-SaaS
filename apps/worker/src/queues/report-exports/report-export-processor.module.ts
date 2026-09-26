import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { ReportExportProcessor } from './report-export.processor';
import { ReportScheduleDispatcherService } from './report-schedule-dispatcher.service';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.REPORT_EXPORTS })],
  providers: [ReportExportProcessor, ReportScheduleDispatcherService],
})
export class ReportExportProcessorModule {}
