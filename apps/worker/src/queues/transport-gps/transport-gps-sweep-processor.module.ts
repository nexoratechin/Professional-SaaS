import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { TransportGpsSweepSchedulerService } from './transport-gps-sweep-scheduler.service';
import { TransportGpsSweepProcessor } from './transport-gps-sweep.processor';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.TRANSPORT_GPS_SWEEP }, { name: QUEUE_NAMES.NOTIFICATIONS }),
  ],
  providers: [TransportGpsSweepProcessor, TransportGpsSweepSchedulerService],
})
export class TransportGpsSweepProcessorModule {}