import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { AdmissionPortalMaintenanceProcessor } from './admission-portal-maintenance.processor';
import { AdmissionPortalSchedulerService } from './admission-portal-scheduler.service';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.ADMISSION_PORTAL_MAINTENANCE })],
  providers: [AdmissionPortalMaintenanceProcessor, AdmissionPortalSchedulerService],
})
export class AdmissionPortalProcessorModule {}
