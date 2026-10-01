/**
 * HTTP surface of the AI ERP Assistant.
 *
 * ## Guard stack
 *
 * Mirrors `analytics.controller.ts` exactly: `JwtAuthGuard → TenantMatchGuard → PermissionsGuard →
 * FeatureFlagsGuard → EntitlementFlagsGuard`, with `@RequireFeature(ai)` and
 * `@RequireEntitlement(ai.assistant)` at class level. So the assistant is behind three independent
 * switches — a valid session, an RBAC grant, and a paid plan — and turning any one off takes the
 * whole surface down rather than one route at a time. (The plan gate alone would be enough for
 * commercial purposes; the RBAC gate is what makes it safe.)
 *
 * ## Why permissions escalate per-route rather than uniformly
 *
 * Reading your own assistant history is `ai.view`. Asking a question that reads student, fee or
 * attendance data is `ai.create` — the operation that touches tenant data. Deleting a conversation is
 * `ai.delete`. Reading the tenant-wide question log is `ai.manage`. Splitting them matters because a
 * deployment that wants read-only assistants (a principal browsing, say) can grant `ai.view` and
 * nothing else, and the routes below refuse rather than the service quietly returning nothing.
 *
 * The important caveat is stated by `ai.create` itself: it does **not** grant access to the underlying
 * data. That is enforced per question by `resolveAiScope`, which intersects `ai.view` with whichever
 * `sourcePermission` the detected intent reads under. A user with `ai.create` and no `fees.view` can
 * ask about fees and will be told their role does not cover it.
 */

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ENTITLEMENT_KEYS, FEATURE_KEYS, PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import type {
  AiCapabilitiesDto,
  AiConversationDetailDto,
  AiConversationDto,
  AiDocumentClassificationDto,
  AiDocumentClassificationListDto,
  AiDraftResponseDto,
  AiDraftSendResultDto,
  AiFeedbackDto,
  AiGeneratedReportDto,
  AiQueryLogListDto,
  AiQueryResponseDto,
  AiRiskInsightsDto,
} from '@college-erp/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { RequireEntitlement } from '../../common/decorators/require-entitlement.decorator';
import { RequireFeature } from '../../common/decorators/require-feature.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { EntitlementFlagsGuard } from '../../common/guards/entitlement-flag.guard';
import { FeatureFlagsGuard } from '../../common/guards/feature-flag.guard';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { AiAssistantService } from './ai-assistant.service';
import { AiDocumentClassificationService } from './ai-document-classification.service';
import { AiReportService } from './ai-report.service';
import {
  AskAiQuestionDto,
  AiRiskInsightsQueryDto,
  CreateAiConversationDto,
  GenerateAiDraftDto,
  GenerateAiReportDto,
  ListAiConversationsDto,
  ListAiDocumentClassificationsDto,
  ListAiQueryLogsDto,
  QueueAiDocumentClassificationDto,
  RecordAiFeedbackDto,
  ReviewAiDocumentClassificationDto,
  SendAiDraftDto,
  UpdateAiConversationDto,
} from './dto/ai-assistant.dto';

@ApiTags('ai-assistant')
@Controller('ai-assistant')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard, FeatureFlagsGuard, EntitlementFlagsGuard)
@RequireFeature(FEATURE_KEYS.AI)
@RequireEntitlement(ENTITLEMENT_KEYS.AI_ASSISTANT)
@RequirePermission(PERMISSION_KEYS.AI_VIEW)
export class AiAssistantController {
  constructor(
    private readonly assistant: AiAssistantService,
    private readonly reports: AiReportService,
    private readonly documents: AiDocumentClassificationService,
  ) {}

  // ── Capabilities ──────────────────────────────────────────────────────────

  /**
   * What this deployment and this caller can do.
   *
   * Deliberately readable at `ai.view` and *not* feature-gated separately: the UI needs it to decide
   * whether to render the assistant at all, which is the one question that has to be answerable before
   * a user tries anything.
   */
  @Get('capabilities')
  capabilities(@CurrentUser() user: AuthenticatedUser): Promise<AiCapabilitiesDto> {
    return this.assistant.capabilities(user);
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  @Get('conversations')
  listConversations(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListAiConversationsDto): Promise<AiConversationDto[]> {
    return this.assistant.listConversations(user, dto);
  }

  @Post('conversations')
  @RequirePermission(PERMISSION_KEYS.AI_CREATE)
  @Audit('AI_CONVERSATION_CREATED', 'AiConversation', 'ai')
  createConversation(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAiConversationDto): Promise<AiConversationDto> {
    return this.assistant.createConversation(user, dto);
  }

  @Get('conversations/:id')
  getConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<AiConversationDetailDto> {
    return this.assistant.getConversation(user, id);
  }

  @Patch('conversations/:id')
  @RequirePermission(PERMISSION_KEYS.AI_UPDATE)
  @Audit('AI_CONVERSATION_RENAMED', 'AiConversation', 'ai')
  updateConversation(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAiConversationDto,
  ): Promise<AiConversationDto> {
    return this.assistant.updateConversation(user, id, dto);
  }

  @Delete('conversations/:id')
  @RequirePermission(PERMISSION_KEYS.AI_DELETE)
  @Audit('AI_CONVERSATION_DELETED', 'AiConversation', 'ai')
  deleteConversation(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string): Promise<{ deleted: true }> {
    return this.assistant.deleteConversation(user, id);
  }

  // ── Asking ────────────────────────────────────────────────────────────────

  /**
   * One assistant turn.
   *
   * `ai.create` gates the route; `resolveAiScope` gates the *data*. Both refusals are recorded — the
   * first as a 403 from the guard stack, the second as a `FORBIDDEN` answer with an `AiQueryLog` row,
   * because "your role does not cover this data" is a different event from "you may not ask questions"
   * and compliance needs to tell them apart.
   */
  @Post('query')
  @RequirePermission(PERMISSION_KEYS.AI_CREATE)
  ask(@CurrentUser() user: AuthenticatedUser, @Body() dto: AskAiQuestionDto): Promise<AiQueryResponseDto> {
    return this.assistant.ask(user, dto);
  }

  @Post('messages/:id/feedback')
  @RequirePermission(PERMISSION_KEYS.AI_CREATE)
  recordFeedback(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RecordAiFeedbackDto,
  ): Promise<AiFeedbackDto> {
    return this.assistant.recordFeedback(user, id, dto);
  }

  // ── Risk insights ─────────────────────────────────────────────────────────

  /**
   * Standalone risk list for the dashboard's "at-risk students" panel.
   *
   * Same service and same weighted rules as the conversational answer, so the panel and the chat can
   * never disagree about who is flagged. Audited as its own action (`AI_RISK_INSIGHTS_VIEWED`).
   */
  @Get('risk-insights')
  riskInsights(@CurrentUser() user: AuthenticatedUser, @Query() dto: AiRiskInsightsQueryDto): Promise<AiRiskInsightsDto> {
    return this.assistant.riskInsightsEndpoint(user, dto);
  }

  // ── Drafts ────────────────────────────────────────────────────────────────

  @Post('drafts')
  @RequirePermission(PERMISSION_KEYS.AI_CREATE)
  generateDraft(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateAiDraftDto): Promise<AiDraftResponseDto> {
    return this.assistant.generateDraftEndpoint(user, dto);
  }

  /**
   * Sends a previously generated draft.
   *
   * `ai.export` here is not a naming convenience: sending is irreversible and reaches an external
   * provider, so it is gated like an export. `AiDraftService.sendDraft` additionally requires
   * `notifications.send`, so this route cannot become a way around the notification module's own
   * permission model. The request names only the stored draft and the recipient — the body itself
   * comes from the draft, never from the caller.
   */
  @Post('drafts/send')
  @RequirePermission(PERMISSION_KEYS.AI_EXPORT)
  @Audit('AI_DRAFT_SENT', 'Notification', 'ai')
  sendDraft(@CurrentUser() user: AuthenticatedUser, @Body() dto: SendAiDraftDto): Promise<AiDraftSendResultDto> {
    return this.assistant.sendDraftEndpoint(user, dto);
  }

  // ── Reports ───────────────────────────────────────────────────────────────

  @Get('reports/catalog')
  reportCatalog(@CurrentUser() user: AuthenticatedUser) {
    return this.reports.catalog(user);
  }

  @Post('reports/generate')
  @RequirePermission(PERMISSION_KEYS.AI_CREATE)
  generateReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateAiReportDto): Promise<AiGeneratedReportDto> {
    return this.assistant.generateReportEndpoint(user, dto);
  }

  @Post('reports/export')
  @RequirePermission(PERMISSION_KEYS.AI_EXPORT)
  @Audit('AI_REPORT_EXPORTED', 'SavedReport', 'ai')
  exportReport(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateAiReportDto) {
    return this.assistant.exportReportEndpoint(user, dto);
  }

  // ── Document classification ───────────────────────────────────────────────

  @Get('documents/classifications')
  listClassifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: ListAiDocumentClassificationsDto,
  ): Promise<AiDocumentClassificationListDto> {
    return this.documents.list(user, dto);
  }

  @Post('documents/classifications')
  @RequirePermission(PERMISSION_KEYS.AI_CREATE)
  queueClassification(@CurrentUser() user: AuthenticatedUser, @Body() dto: QueueAiDocumentClassificationDto) {
    return this.documents.queue(user, dto);
  }

  /**
   * Records a human decision on a machine suggestion.
   *
   * `ai.update` is the right level: it changes the assistant's own record, not the document. The
   * document's `documentTypeId` is deliberately NOT touched here — a classification suggestion is
   * advice, and promoting it to a filing decision is a separate, human-initiated action in the
   * documents module with its own permission.
   */
  @Patch('documents/classifications/:id')
  @RequirePermission(PERMISSION_KEYS.AI_UPDATE)
  @Audit('AI_DOCUMENT_CLASSIFICATION_REVIEWED', 'AiDocumentClassification', 'ai')
  reviewClassification(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ReviewAiDocumentClassificationDto,
  ): Promise<AiDocumentClassificationDto> {
    return this.documents.review(user, id, dto);
  }

  // ── Compliance ────────────────────────────────────────────────────────────

  /**
   * The tenant-wide AI question log. `ai.manage` only — this is a cross-user view, which is why it is
   * not folded into the per-user conversation endpoints above.
   */
  @Get('query-logs')
  @RequirePermission(PERMISSION_KEYS.AI_MANAGE)
  queryLogs(@CurrentUser() user: AuthenticatedUser, @Query() dto: ListAiQueryLogsDto): Promise<AiQueryLogListDto> {
    return this.assistant.listQueryLogs(user, dto);
  }
}