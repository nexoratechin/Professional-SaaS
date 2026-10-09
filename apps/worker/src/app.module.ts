import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AppConfigService } from './config/app-config.service';
import { ConfigModule } from './config/config.module';
import { EntitlementModule } from './entitlement/entitlement.module';
import { JobsModule } from './common/jobs/jobs.module';
import { AiDocumentProcessingProcessorModule } from './queues/ai/ai-document-processing-processor.module';
import { AnalyticsRefreshProcessorModule } from './queues/analytics-refresh/analytics-refresh-processor.module';
import { CertificateGenerationProcessorModule } from './queues/certificate-generation/certificate-generation-processor.module';
import { DataImportProcessorModule } from './queues/data-imports/data-import-processor.module';
import { DocumentRetentionProcessorModule } from './queues/document-retention/document-retention-processor.module';
import { DocumentVirusScanProcessorModule } from './queues/document-virus-scan/document-virus-scan-processor.module';
import { HelpdeskSlaProcessorModule } from './queues/helpdesk-sla/helpdesk-sla-processor.module';
import { IntegrationsProcessorModule } from './queues/integrations/integrations-processor.module';
import { ChannelDeliveryProcessorModule } from './queues/notifications/channel-delivery-processor.module';
import { NotificationsProcessorModule } from './queues/notifications/notifications-processor.module';
import { NotificationsCampaignProcessorModule } from './queues/notifications/notifications-campaign-processor.module';
import { PaymentReconciliationProcessorModule } from './queues/payment-reconciliation/payment-reconciliation-processor.module';
import { PdfGenerationProcessorModule } from './queues/pdf-generation/pdf-generation-processor.module';
import { ReportExportProcessorModule } from './queues/report-exports/report-export-processor.module';
import { SubscriptionLifecycleProcessorModule } from './queues/subscription-lifecycle/subscription-lifecycle-processor.module';
import { TransportGpsSweepProcessorModule } from './queues/transport-gps/transport-gps-sweep-processor.module';
import { WorkflowEscalationProcessorModule } from './queues/workflow-escalation/workflow-escalation-processor.module';

@Module({
  imports: [
    ConfigModule,
    EntitlementModule,
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => {
        const redisUrl = new URL(config.get('REDIS_URL'));
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port || 6379),
            maxRetriesPerRequest: null,
          },
        };
      },
    }),
    // Cross-cutting job infrastructure (dead-letter sink, queue-events → status/DLQ bridge,
    // monitoring). Must be registered before/with the processors that emit events.
    JobsModule,
    NotificationsProcessorModule,
    ChannelDeliveryProcessorModule,
    NotificationsCampaignProcessorModule,
    WorkflowEscalationProcessorModule,
    SubscriptionLifecycleProcessorModule,
    TransportGpsSweepProcessorModule,
    HelpdeskSlaProcessorModule,
    DocumentVirusScanProcessorModule,
    DocumentRetentionProcessorModule,
    ReportExportProcessorModule,
    AnalyticsRefreshProcessorModule,
    AiDocumentProcessingProcessorModule,
    IntegrationsProcessorModule,
    DataImportProcessorModule,
    PdfGenerationProcessorModule,
    CertificateGenerationProcessorModule,
    PaymentReconciliationProcessorModule,
  ],
})
export class AppModule {}
