import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { WorkerStorageModule } from '../../common/storage/worker-storage.module';
import { CertificateGenerationProcessor } from './certificate-generation.processor';

@Module({
  imports: [WorkerStorageModule, BullModule.registerQueue({ name: QUEUE_NAMES.CERTIFICATE_GENERATION })],
  providers: [CertificateGenerationProcessor],
})
export class CertificateGenerationProcessorModule {}
