import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type AdmissionPortalMaintenanceJobData } from '@college-erp/types';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** Registers the recurring portal sweep on boot. The fixed jobId lets BullMQ dedupe it across
 *  restarts, exactly like the document-retention scheduler. */
@Injectable()
export class AdmissionPortalSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(AdmissionPortalSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.ADMISSION_PORTAL_MAINTENANCE)
    private readonly queue: Queue<AdmissionPortalMaintenanceJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'admission-portal-sweep' });
    this.logger.log('Admission portal maintenance scheduled hourly.');
  }
}
