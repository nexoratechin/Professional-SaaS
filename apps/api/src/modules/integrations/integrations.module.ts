import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { IntegrationAdapterRegistry } from '@college-erp/integrations';
import { QUEUE_NAMES } from '@college-erp/types';
import { AuditModule } from '../audit/audit.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { IntegrationWebhooksController, IntegrationWebhookService } from './integration-webhooks.controller';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsDispatchService } from './integrations-dispatch.service';
import { IntegrationsService } from './integrations.service';
import { IntegrationsSyncService } from './integrations-sync.service';

/**
 * The generic integration framework's Nest wiring.
 *
 * `IntegrationAdapterRegistry` is provided once per process and shared by dispatch, sync, connection
 * testing and webhook handling, so a provider registered at boot is immediately visible to all four.
 * The package also exports its own singleton for non-Nest callers (the worker); both resolve the same
 * shipped adapters, and registration in one process is independent of the other — which is correct,
 * since registration is a boot-time act in each process.
 */
@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.INTEGRATION_OPERATIONS }),
    BullModule.registerQueue({ name: QUEUE_NAMES.INTEGRATION_SYNC }),
    CommonGuardsModule,
    AuditModule,
  ],
  controllers: [IntegrationsController, IntegrationWebhooksController],
  providers: [
    IntegrationsService,
    IntegrationsDispatchService,
    IntegrationsSyncService,
    IntegrationWebhookService,
    // useFactory, not useValue: a `new` in the decorator object would be built at import time, before
    // any other module's onModuleInit had a chance to call register(). Built at DI time instead, so a
    // host app can add a vendor by injecting this registry in onModuleInit and the SAME instance is
    // what dispatch, sync and connection tests resolve.
    { provide: IntegrationAdapterRegistry, useFactory: () => new IntegrationAdapterRegistry() },
  ],
  exports: [IntegrationsService, IntegrationsDispatchService, IntegrationsSyncService],
})
export class IntegrationsModule {}
