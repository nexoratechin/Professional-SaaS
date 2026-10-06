import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { EntitlementModule } from '../../entitlement/entitlement.module';
import { IntegrationOperationsProcessor, IntegrationWorkerAdapterContextFactory } from './integration-operations.processor';
import { IntegrationSyncSchedulerService } from './integration-scheduler.service';
import { IntegrationSyncProcessor } from './integration-sync.processor';

/**
 * The worker's half of the integration framework: outbound dispatch, sync runs, and the recurring
 * sweep that finds integrations due for a periodic sync.
 *
 * Both processors rebuild their Prisma client from the job payload's `tenantId` and never fall back
 * to the unscoped client for a lookup, which is what keeps a cross-tenant mistake impossible rather
 * than merely discouraged.
 */
@Module({
  imports: [
    EntitlementModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.INTEGRATION_OPERATIONS }),
    BullModule.registerQueue({ name: QUEUE_NAMES.INTEGRATION_SYNC }),
  ],
  providers: [
    IntegrationWorkerAdapterContextFactory,
    IntegrationOperationsProcessor,
    IntegrationSyncProcessor,
    IntegrationSyncSchedulerService,
  ],
})
export class IntegrationsProcessorModule {}
