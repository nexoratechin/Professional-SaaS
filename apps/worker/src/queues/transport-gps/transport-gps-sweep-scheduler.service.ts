import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type TransportGpsSweepJobData } from '@college-erp/types';

const SWEEP_INTERVAL_MS = 30 * 1000;

/** Self-registers its own recurring GPS polling sweep on worker startup — a fixed jobId makes
 * BullMQ dedupe this across restarts, so re-registering on every boot never produces duplicates. */
@Injectable()
export class TransportGpsSweepSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(TransportGpsSweepSchedulerService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.TRANSPORT_GPS_SWEEP) private readonly queue: Queue<TransportGpsSweepJobData>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.queue.add('sweep', {}, { repeat: { every: SWEEP_INTERVAL_MS }, jobId: 'transport-gps-sweep' });
    this.logger.log(`Registered transport GPS sweep, repeating every ${SWEEP_INTERVAL_MS / 1000} seconds.`);
  }
}