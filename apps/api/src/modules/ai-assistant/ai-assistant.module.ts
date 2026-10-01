import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';
import { AiDocumentClassificationService } from './ai-document-classification.service';
import { AiDraftService } from './ai-draft.service';
import { AiLlmProvider } from './ai-llm.provider';
import { AiQueriesService } from './ai-queries.service';
import { AiReportService } from './ai-report.service';
import { AiRiskInsightsService } from './ai-risk-insights.service';

/**
 * The AI ERP Assistant module.
 *
 * ## What it imports, and why each one is here rather than duplicated
 *
 *  - `CommonGuardsModule` — the guard stack (`JwtAuth → TenantMatch → Permissions → FeatureFlags →
 *    EntitlementFlags`) plus `PermissionsService` (re-exported through `RbacModule`). Scope is
 *    resolved from the *same* permission service the rest of the platform uses, so an assistant
 *    answer and a report cannot disagree about what a role may read.
 *  - `NotificationsModule` — `AiDraftService.sendDraft` delegates to `NotificationsService.send`
 *    unchanged. One delivery pipeline means one set of provider credentials, one retry policy and
 *    one audit action for every message the platform sends, whoever composed it.
 *  - `AnalyticsModule` — `ANALYTICS_OVERVIEW` reuses `CollegeAnalyticsService.overview` rather than
 *    re-deriving the same rollup, so the assistant's overview and the dashboard it summarizes can
 *    never drift. `AnalyticsModule` exports that service for exactly this reason.
 *  - the AI document-processing queue — the API only *enqueues* classification; the worker owns the
 *    OCR/classify execution (see apps/worker). Registering the queue here is what gives
 *    `AiDocumentClassificationService` a producer handle.
 *
 * `ConfigModule`, `PrismaModule` and `AuditModule` are global, so they are deliberately absent:
 * `AppConfigService`, the tenant-scoped Prisma client and `AuditService` are injectable without an
 * explicit import anywhere in the app.
 */
@Module({
  imports: [
    CommonGuardsModule,
    NotificationsModule,
    AnalyticsModule,
    BullModule.registerQueue({ name: QUEUE_NAMES.AI_DOCUMENT_PROCESSING }),
  ],
  controllers: [AiAssistantController],
  providers: [
    AiQueriesService,
    AiRiskInsightsService,
    AiDraftService,
    AiReportService,
    AiLlmProvider,
    AiDocumentClassificationService,
    AiAssistantService,
  ],
})
export class AiAssistantModule {}
