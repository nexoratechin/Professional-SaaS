/**
 * The assistant itself: conversation CRUD, the `ask()` orchestration, feedback, query logs, and the
 * capabilities probe.
 *
 * ## Why orchestration lives in one place
 *
 * A single assistant turn touches up to five subsystems — the router, the scope resolver, one query
 * service, the provider, and two audit trails (`AiQueryLog` plus `PlatformAuditLog`). Scattering that
 * across the query services would mean every future capability had to re-implement "resolve scope,
 * run query, persist the message, log the question, narrate optionally" — and the first one to forget
 * the query log would be the first thing nobody could audit. So the shape is fixed here:
 *
 *   route -> resolve scope -> (may throw: logged as FORBIDDEN/UNSUPPORTED) -> run query ->
 *   deterministic answer -> optional narration -> persist message + query log -> audit
 *
 * ## Every exit is logged
 *
 * Success, refusal, unrecognized phrasing, and execution failure all write an `AiQueryLog` row with
 * the question, the intent, the outcome and the scope that was in force. That is what makes "what did
 * this tenant ask the AI, and what could the asker see?" answerable with one query — including for
 * conversations that have since been deleted, which is why the log is a separate table with SetNull
 * relations rather than a cascade from the message.
 *
 * ## Failure is an answer, not an exception
 *
 * A capability the caller may not use returns a `FORBIDDEN` answer with the scope that applied, not a
 * bare 403 with nothing recorded. The caller learns *which* permission is missing, and the audit trail
 * records the attempt. (The HTTP layer still returns 403 for the controller's own guard failures — this
 * is about the in-conversation path.)
 */

import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import { AiIntent, type AiResponseKind, type Prisma } from '@college-erp/database';
import type { ReportFilters } from '@college-erp/reporting';
import type {
  AiAnswerPayloadDto,
  AiCapabilitiesDto,
  AiConversationDetailDto,
  AiConversationDto,
  AiDraftAudienceDto,
  AiDraftResponseDto,
  AiDraftSendResultDto,
  AiDraftToneDto,
  AiFeedbackDto,
  AiGeneratedReportDto,
  AiIntentDto,
  AiMessageDto,
  AiMetricDto,
  AiQueryLogListDto,
  AiQueryResponseDto,
  AiResponseKindDto,
  AiRiskInsightsDto,
  AiScopeSnapshotDto,
  AiTableColumnDto,
  AiTableDto,
  AiTableRowDto,
} from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { CollegeAnalyticsService } from '../analytics/college-analytics.service';
import type { AnalyticsQueryDto } from '../analytics/dto/analytics-query.dto';
import { PermissionsService } from '../rbac/permissions.service';
import { AiDraftService, type AiDraftChannel } from './ai-draft.service';
import { AiLlmProvider } from './ai-llm.provider';
import { AiQueriesService, type AiResolvedFilters } from './ai-queries.service';
import { AiReportService } from './ai-report.service';
import { aiRiskRows, aiRiskTable, AiRiskInsightsService } from './ai-risk-insights.service';
import {
  AI_INTENTS,
  assertKnownAiIntent,
  DEFAULT_WINDOW_DAYS,
  routeAiQuestion,
  type AiIntentDefinition,
  type AiResolvedSlots,
  type AiRouteResult,
} from './ai-intent-router';
import {
  assertRequestedNodeInScope,
  resolveAiScope,
  type ResolvedAiScope,
} from './ai-scope';
import type {
  AskAiQuestionDto,
  AiRiskInsightsQueryDto,
  CreateAiConversationDto,
  GenerateAiDraftDto,
  GenerateAiReportDto,
  ListAiConversationsDto,
  ListAiQueryLogsDto,
  RecordAiFeedbackDto,
  SendAiDraftDto,
  UpdateAiConversationDto,
} from './dto/ai-assistant.dto';

/** The empty-but-typed scope used when execution never got far enough to resolve one. */
const NO_SCOPE: AiScopeSnapshotDto = { entryGrants: [], sourceGrants: [], effectiveGrants: [], isGlobal: false };

/**
 * The named students a non-guardian draft is about, as a one-column table.
 *
 * A guardian-facing draft deliberately carries no names, so this returns null there — the absence is
 * information ("the audience is not enumerated"), not a rendering failure.
 */
function draftRecipientTable(names: string[]): AiTableDto | null {
  if (names.length === 0) return null;
  return {
    title: 'Students this draft is about',
    columns: [{ key: 'fullName', label: 'Student' }],
    rows: names.map((fullName) => ({ fullName })),
    totalCount: names.length,
    truncated: false,
  };
}

@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly permissions: PermissionsService,
    private readonly appConfig: AppConfigService,
    private readonly llm: AiLlmProvider,
    private readonly queries: AiQueriesService,
    private readonly draft: AiDraftService,
    private readonly reports: AiReportService,
    private readonly risk: AiRiskInsightsService,
    private readonly analytics: CollegeAnalyticsService,
    private readonly audit: AuditService,
  ) {}

  // ── Capabilities ──────────────────────────────────────────────────────────

  /**
   * What this deployment and this caller can do.
   *
   * The UI renders its affordances from this rather than from `permissions` alone, so a tenant on a
   * plan without the entitlement, or a user without a specific source permission, is never shown a
   * capability that will 403 on click. Server-side enforcement does not depend on it either way — this
   * is presentation, and the guards are the boundary.
   */
  async capabilities(user: AuthenticatedUser): Promise<AiCapabilitiesDto> {
    const enabled = this.llm.enabled;
    const provider = this.llm.provider;
    const effective = await this.permissions.getEffectivePermissionsWithScope(user.tenantId, user.id);
    const canView = Boolean(effective[PERMISSION_KEYS.AI_VIEW]?.length);

    const availableIntents = canView
      ? AI_INTENTS.filter((definition) => {
          if (definition.requiresReportsView && !effective[PERMISSION_KEYS.REPORTS_VIEW]?.length) return false;
          if (definition.sourcePermission === PERMISSION_KEYS.ANALYTICS_VIEW) return true; // resolved at query time
          return Boolean(effective[definition.sourcePermission]?.length);
        }).map((definition) => ({
          intent: definition.intent,
          label: definition.label,
          sourcePermission: definition.sourcePermission,
        }))
      : [];

    // Capabilities the caller holds but this deployment cannot serve. Reported separately rather than
    // dropped, because "you can draft, but no provider is configured" is a configuration fact an
    // administrator needs to see and a user does not need to guess at.
    const providerLimitedCapabilities: string[] = [];
    if (provider === 'none') {
      providerLimitedCapabilities.push('NARRATION', 'FREE_TEXT_DRAFTING');
      if (!this.llm.ocrConfigured) providerLimitedCapabilities.push('DOCUMENT_OCR');
    }

    return {
      enabled,
      provider,
      model: this.llm.model,
      maxRows: this.appConfig.get('AI_MAX_ROWS'),
      availableIntents,
      providerLimitedCapabilities,
      ocrConfigured: this.llm.ocrConfigured,
      autoAcceptConfidence: this.appConfig.get('AI_AUTO_ACCEPT_CONFIDENCE'),
    };
  }

  // ── Conversations ─────────────────────────────────────────────────────────

  async listConversations(user: AuthenticatedUser, dto: ListAiConversationsDto): Promise<AiConversationDto[]> {
    // Strictly the caller's own threads. A conversation is the full history of what one person was
    // able to see, so sharing one would share their scope — even between two people who happen to
    // hold identical grants today.
    const rows = await this.tenantPrisma.client.aiConversation.findMany({
      where: { ownerId: user.id, ...(dto.includeArchived ? {} : { isArchived: false }) },
      orderBy: { updatedAt: 'desc' },
      skip: dto.skip ?? 0,
      take: Math.min(dto.take ?? 20, 100),
      select: {
        id: true,
        title: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    return rows.map((row) => this.toConversationDto(row));
  }

  async getConversation(user: AuthenticatedUser, id: string): Promise<AiConversationDetailDto> {
    const conversation = await this.findOwnedConversation(user, id);
    const messages = await this.tenantPrisma.client.aiMessage.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        conversationId: true,
        role: true,
        intent: true,
        content: true,
        payload: true,
        responseKind: true,
        provider: true,
        model: true,
        latencyMs: true,
        createdAt: true,
        feedback: { select: { id: true, messageId: true, rating: true, comment: true, createdAt: true } },
      },
    });
    return {
      ...this.toConversationDto({ ...conversation, _count: { messages: messages.length } }),
      messages: messages.map((message) => this.toMessageDto(message)),
    };
  }

  async createConversation(user: AuthenticatedUser, dto: CreateAiConversationDto): Promise<AiConversationDto> {
    const created = await this.untypedCreate().aiConversation.create({
      data: { ownerId: user.id, title: dto.title ?? 'New conversation' },
    });
    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_CONVERSATION_CREATED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiConversation',
      entityId: created.id,
      after: { title: created.title },
    });
    return {
      id: created.id,
      title: created.title,
      isArchived: created.isArchived,
      messageCount: 0,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  async updateConversation(
    user: AuthenticatedUser,
    id: string,
    dto: UpdateAiConversationDto,
  ): Promise<AiConversationDto> {
    const conversation = await this.findOwnedConversation(user, id);
    const updated = await this.tenantPrisma.client.aiConversation.update({
      where: { id: conversation.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.isArchived !== undefined ? { isArchived: dto.isArchived } : {}),
      },
      select: { id: true, title: true, isArchived: true, createdAt: true, updatedAt: true, _count: { select: { messages: true } } },
    });
    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_CONVERSATION_RENAMED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiConversation',
      entityId: updated.id,
      before: { title: conversation.title, isArchived: conversation.isArchived },
      after: { title: updated.title, isArchived: updated.isArchived },
    });
    return this.toConversationDto(updated);
  }

  /**
   * Deletes a conversation and its messages.
   *
   * `AiQueryLog` rows are **kept** (their conversation/message relations are SetNull): deleting your
   * chat history is a reasonable privacy right, and it must not become a way to erase the record of
   * what was asked under your scope.
   */
  async deleteConversation(user: AuthenticatedUser, id: string): Promise<{ deleted: true }> {
    const conversation = await this.findOwnedConversation(user, id);
    await this.tenantPrisma.client.aiConversation.delete({ where: { id: conversation.id } });
    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_CONVERSATION_DELETED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiConversation',
      entityId: conversation.id,
      before: { title: conversation.title },
    });
    return { deleted: true };
  }

  // ── Ask ───────────────────────────────────────────────────────────────────

  /**
   * One assistant turn.
   *
   * Ordering matters and is the security property: **the scope is resolved before any query runs**, and
   * a resolution failure is caught here so it can be logged as FORBIDDEN rather than propagating as an
   * unrecorded 403. Nothing downstream of `resolveAiScope` re-checks authorization — there is nothing
   * to re-check, because every query narrows with the resolved filter.
   */
  async ask(user: AuthenticatedUser, dto: AskAiQuestionDto): Promise<AiQueryResponseDto> {
    if (!this.llm.enabled) {
      throw new ForbiddenException('The AI assistant is disabled for this deployment.');
    }

    const question = dto.question.trim();
    const started = Date.now();
    const conversation = dto.conversationId
      ? await this.findOwnedConversation(user, dto.conversationId)
      : await this.createConversationInternal(user, undefined);

    // 1. Intent. An explicit `intent` overrides the router; an unknown one is a 400 rather than a
    //    silent fallback, because "you asked for a capability that does not exist" and "you asked a
    //    question I could not route" are different bugs.
    const routed = dto.intent
      ? { definition: assertKnownAiIntent(dto.intent), intent: dto.intent as AiIntentDto, slots: { campusNames: [], departmentNames: [], programNames: [] } as AiResolvedSlots, matchedPatterns: [`explicit:${dto.intent}`] }
      : await this.route(question);

    if (!routed.definition) {
      return this.persistUnroutable(user, conversation.id, question, started, routed.matchedPatterns);
    }
    // Held in a `const` so the non-null check above narrows it for every use below (TypeScript does
    // not carry property-access narrowing through the `try`/`catch` that follows).
    const definition: AiIntentDefinition = routed.definition;

    // 2. Filters. Explicit request values beat router-extracted slots, which beat defaults — and
    //    whatever ends up applied is echoed back in `filters` so a reader never has to guess whether a
    //    window was stated or defaulted.
    const filters = this.buildFilters(dto, routed.slots);

    // 3. Scope. Throws ForbiddenException; caught below so the refusal is logged.
    let scope: ResolvedAiScope;
    try {
      scope = await resolveAiScope(this.tenantPrisma, this.permissions, user.tenantId, user.id, definition);
      await assertRequestedNodeInScope(this.tenantPrisma, scope, {
        ...(dto.campusId ? { campusId: dto.campusId } : {}),
        ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
        ...(dto.programId ? { programId: dto.programId } : {}),
      });
    } catch (err) {
      return this.persistForbidden(user, conversation.id, question, started, definition.intent, err);
    }

    try {
      const resolved = await this.execute(user, scope, definition.intent, question, filters, dto);
      // Narration is opt-in (`narrate: true`): it costs a provider round-trip and is never the source
      // of a figure, so a caller who wants plain numbers should not pay for prose they did not ask
      // for. `AiLlmProvider.complete` returns null with no provider configured either way.
      return await this.persistAnswer(
        user,
        conversation.id,
        question,
        resolved,
        scope,
        { definition, matchedPatterns: routed.matchedPatterns },
        filters,
        started,
        dto.narrate === true,
      );
    } catch (err) {
      return this.persistFailure(user, conversation.id, question, started, scope, definition.intent, err);
    }
  }

  // ── Feedback ──────────────────────────────────────────────────────────────

  /**
   * Thumbs up/down on an answer.
   *
   * The training signal for two things: which phrasings the router gets wrong (a `down` on a correct
   * answer means the *routing* was wrong, not the number), and which figures users dispute. Recorded
   * against the message the caller owns, so feedback is not writable about someone else's answer.
   */
  async recordFeedback(
    user: AuthenticatedUser,
    messageId: string,
    dto: RecordAiFeedbackDto,
  ): Promise<AiFeedbackDto> {
    const message = await this.tenantPrisma.client.aiMessage.findFirst({
      where: { id: messageId, conversation: { ownerId: user.id } },
      select: { id: true },
    });
    if (!message) throw new NotFoundException('Assistant message not found.');

    const saved = await this.untypedCreate().aiFeedback.upsert({
      where: { messageId },
      create: { messageId, userId: user.id, rating: dto.rating, ...(dto.comment ? { comment: dto.comment } : {}) },
      update: { rating: dto.rating, ...(dto.comment ? { comment: dto.comment } : {}) },
      select: { id: true, messageId: true, rating: true, comment: true, createdAt: true },
    });

    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_FEEDBACK_RECORDED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiFeedback',
      entityId: saved.id,
      after: { messageId, rating: dto.rating, hasComment: Boolean(dto.comment) },
    });

    return {
      id: saved.id,
      messageId: saved.messageId,
      rating: saved.rating as 'up' | 'down',
      comment: saved.comment,
      createdAt: saved.createdAt.toISOString(),
    };
  }

  // ── Standalone endpoints (outside a conversation) ─────────────────────────

  /**
   * The at-risk student list on its own, for the dashboard panel.
   *
   * Runs the same two-step scope resolution `ask()` performs — resolve `ai.view` × the intent's
   * source permission, then assert any explicitly named campus/department/program is inside the
   * result — because this is a second door onto the same per-student judgement and it must be locked
   * identically. Unlike `ask()`, a refusal here **throws** rather than returning a FORBIDDEN answer:
   * there is no conversation to record it in, and creating a thread for a read-only dashboard panel
   * would put messages in a user's history they never asked for. The view is still audited, inside
   * `recordInsightsViewed`.
   */
  async riskInsightsEndpoint(user: AuthenticatedUser, dto: AiRiskInsightsQueryDto): Promise<AiRiskInsightsDto> {
    if (!this.llm.enabled) throw new ForbiddenException('The AI assistant is disabled for this deployment.');

    const definition = assertKnownAiIntent('STUDENT_RISK_INSIGHTS');
    const filters = this.buildStandaloneFilters(dto);
    const scope = await resolveAiScope(this.tenantPrisma, this.permissions, user.tenantId, user.id, definition);
    await assertRequestedNodeInScope(this.tenantPrisma, scope, this.requestedNode(dto));

    const result = await this.risk.insights(user, scope, filters, dto);
    await this.risk.recordInsightsViewed(user, scope, result, dto.severity);
    return result;
  }

  /**
   * A standalone draft, outside any conversation.
   *
   * The topic in the question decides which scoped query supplies the facts, and therefore which
   * source permission is required (see `draftScopeDefinition`): "draft an email to guardians about
   * unpaid fees" is refused for a caller without `fees.view` even though they may read students. The
   * deterministic template is always produced — a provider only ever rewrites the wording — so this
   * endpoint is fully usable with `AI_PROVIDER=none`.
   *
   * The result is **persisted as an assistant message** (in an existing thread, or a new "Drafts"
   * one) even though it was generated outside a conversation. That is what makes sending possible:
   * `POST /drafts/send` takes a `messageId` and reads the body from storage, never from the request,
   * so a draft that was not stored could not be sent — and, just as importantly, could not be
   * audited after the fact. Generation and sending are two separately-permissioned steps over one
   * stored artefact.
   */
  async generateDraftEndpoint(user: AuthenticatedUser, dto: GenerateAiDraftDto): Promise<AiDraftResponseDto> {
    if (!this.llm.enabled) throw new ForbiddenException('The AI assistant is disabled for this deployment.');

    const started = Date.now();
    // Scope is resolved under the *fact* intent (fees/attendance/exams/placement), because that is
    // the query whose rows end up in the draft; the persisted message is filed as a draft.
    const factDefinition = this.draftScopeDefinition(dto.question);
    const filters = this.buildStandaloneFilters(dto);
    const scope = await resolveAiScope(this.tenantPrisma, this.permissions, user.tenantId, user.id, factDefinition);
    await assertRequestedNodeInScope(this.tenantPrisma, scope, this.requestedNode(dto));

    const audience = (dto.audience ?? 'GUARDIAN') as AiDraftAudienceDto;
    const facts = await this.draft.resolveFacts(scope, filters, dto.question, audience);
    const generated = await this.draft.generate(
      {
        channel: (dto.channel ?? 'EMAIL') as AiDraftChannel,
        tone: (dto.tone ?? 'FORMAL') as AiDraftToneDto,
        audience,
        question: dto.question,
        ...(dto.extraInstructions ? { extraInstructions: dto.extraInstructions } : {}),
      },
      facts,
    );
    await this.draft.recordGenerated(user, generated);

    // Named rows are only present for audiences where naming is appropriate (never guardians), so
    // this is the row set behind the aggregates — and, for the same reason, may be absent.
    const table = draftRecipientTable(facts.names ?? []);
    const answer = `Drafted a ${generated.tone.toLowerCase()} ${generated.channel.toLowerCase()} message about ${facts.headline}. Nothing has been sent.`;
    const payload: AiAnswerPayloadDto = {
      intent: 'COMMUNICATION_DRAFT',
      summary: answer,
      metrics: this.draft.metricsFor(facts),
      tables: table ? [table] : [],
      draft: generated,
      caveats: ['This is a draft only. Sending it requires a separate action and the notifications.send permission.'],
    };

    const conversationId = dto.conversationId
      ? (await this.findOwnedConversation(user, dto.conversationId)).id
      : (await this.createConversationInternal(user, 'Drafts')).id;

    // Reuses the conversational persistence path (user + assistant message, AiQueryLog, audit) so a
    // standalone draft is as auditable as one asked for in chat. The `routed` definition is the
    // drafting intent regardless of which fact domain supplied the numbers, because the *action*
    // that happened was drafting — and `sendDraftEndpoint` looks the message up by that intent.
    const persisted = await this.persistAnswer(
      user,
      conversationId,
      dto.question,
      { answer, payload, provider: generated.provider, model: generated.model },
      scope,
      { definition: assertKnownAiIntent('COMMUNICATION_DRAFT'), matchedPatterns: [`draft:${factDefinition.intent}`] },
      filters,
      started,
      // A draft carries `payload.draft`, so `persistAnswer` short-circuits narration for it anyway;
      // this value only matters for a data answer, which this endpoint never produces.
      false,
    );

    return {
      draft: generated,
      messageId: persisted.messageId,
      conversationId,
      metrics: payload.metrics,
      table,
      filters: this.describeFilters(filters),
      scope: scope.snapshot,
    };
  }

  /**
   * Sends a previously generated draft.
   *
   * Ownership is the authorization: the draft is read from an `AiMessage` whose conversation the
   * caller owns. There is deliberately **no** body in the request, so this endpoint cannot be used to
   * deliver arbitrary text — if the stored draft is missing, the call fails rather than sending
   * something else. `AiDraftService.sendDraft` additionally requires `notifications.send`, so the
   * assistant is never a way around the notification module's own permission model.
   */
  async sendDraftEndpoint(user: AuthenticatedUser, dto: SendAiDraftDto): Promise<AiDraftSendResultDto> {
    const message = await this.tenantPrisma.client.aiMessage.findFirst({
      where: {
        id: dto.messageId,
        role: 'assistant',
        intent: AiIntent.COMMUNICATION_DRAFT,
        conversation: { ownerId: user.id },
      },
      select: { id: true, payload: true },
    });
    if (!message) throw new NotFoundException('Draft not found in your conversations.');

    const stored = (message.payload as AiAnswerPayloadDto | null)?.draft;
    if (!stored) throw new BadRequestException('That assistant message does not contain a draft.');

    return this.draft.sendDraft(user, stored, dto.recipientUserId, dto.scheduledAt);
  }

  /**
   * Generates a report through the reporting engine, without persisting it unless asked.
   *
   * Delegates to `AiReportService.generate`, which intersects `ai.view` × `reports.view` × the
   * report's own source permission before calling `executeReport` — so this route can never be a
   * more powerful path to report data than the Reports screen is.
   */
  async generateReportEndpoint(user: AuthenticatedUser, dto: GenerateAiReportDto): Promise<AiGeneratedReportDto> {
    if (!this.llm.enabled) throw new ForbiddenException('The AI assistant is disabled for this deployment.');
    return this.runReport(user, dto, dto.save === true);
  }

  /**
   * Generates and records a report leave the building.
   *
   * Always persisted (`save: true`), unlike the preview route: an export is the event compliance
   * asks about, and a report nobody kept is not one they can answer about. A repeat export with the
   * same title is a 409 from the `(tenantId, ownerId, name)` unique rather than a silent duplicate.
   *
   * The audited `format` is `JSON` because that is what this endpoint actually returns; any file
   * rendering happens client-side, and the Reports module's own async export queue audits itself.
   */
  async exportReportEndpoint(user: AuthenticatedUser, dto: GenerateAiReportDto): Promise<AiGeneratedReportDto> {
    if (!this.llm.enabled) throw new ForbiddenException('The AI assistant is disabled for this deployment.');
    const report = await this.runReport(user, dto, true);
    await this.reports.recordExported(user, {
      reportType: report.reportType,
      format: 'JSON',
      rowCount: report.rowCount,
      savedReportId: report.savedReportId,
    });
    return report;
  }

  // ── Query logs (compliance view) ──────────────────────────────────────────

  /**
   * The tenant's AI question log.
   *
   * Requires `ai.manage`, not just `ai.view`: this is a cross-user view of what every user asked and
   * what they could see, which is materially more sensitive than one person's own history. Filtering
   * by user/intent/outcome/date is what makes it usable for an actual review rather than a data dump.
   */
  async listQueryLogs(user: AuthenticatedUser, dto: ListAiQueryLogsDto): Promise<AiQueryLogListDto> {
    const effective = await this.permissions.getEffectivePermissionsWithScope(user.tenantId, user.id);
    if (!effective[PERMISSION_KEYS.AI_MANAGE]?.length) {
      throw new ForbiddenException('Missing required permission: ai.manage');
    }

    const skip = dto.skip ?? 0;
    const take = Math.min(dto.take ?? 50, 100);

    const where: Prisma.AiQueryLogWhereInput = {
      ...(dto.intent ? { intent: dto.intent as AiIntent } : {}),
      ...(dto.outcome ? { outcome: dto.outcome as AiResponseKind } : {}),
      ...(dto.userId ? { userId: dto.userId } : {}),
      ...(dto.dateFrom || dto.dateTo
        ? { createdAt: { ...(dto.dateFrom ? { gte: new Date(dto.dateFrom) } : {}), ...(dto.dateTo ? { lte: new Date(dto.dateTo) } : {}) } }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.tenantPrisma.client.aiQueryLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        select: {
          id: true,
          conversationId: true,
          messageId: true,
          userId: true,
          question: true,
          intent: true,
          outcome: true,
          sourcePermission: true,
          rowCount: true,
          errorMessage: true,
          latencyMs: true,
          scopeSnapshot: true,
          filters: true,
          createdAt: true,
          user: { select: { email: true } },
        },
      }),
      this.tenantPrisma.client.aiQueryLog.count({ where }),
    ]);

    return {
      data: rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        messageId: row.messageId,
        userId: row.userId,
        userEmail: row.user?.email ?? null,
        question: row.question,
        intent: row.intent as AiIntentDto | null,
        outcome: row.outcome as AiResponseKindDto,
        sourcePermission: row.sourcePermission,
        rowCount: row.rowCount,
        errorMessage: row.errorMessage,
        latencyMs: row.latencyMs,
        scope: (row.scopeSnapshot as AiScopeSnapshotDto | null) ?? null,
        filters: (row.filters as Record<string, unknown> | null) ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      skip,
      take,
    };
  }

  // ── Execution ─────────────────────────────────────────────────────────────

  /**
   * Runs the resolved capability and builds its deterministic answer.
   *
   * Every branch returns `{ answer, payload, provider?, model?, narration? }` where `answer` is already
   * complete and correct with no provider. Narration is applied afterwards, by the caller, so a
   * provider failure can never remove an answer that was already computed.
   */
  private async execute(
    user: AuthenticatedUser,
    scope: ResolvedAiScope,
    intent: AiIntentDto,
    question: string,
    filters: AiResolvedFilters & { limit: number },
    dto: AskAiQuestionDto,
  ): Promise<{ answer: string; payload: AiAnswerPayloadDto; provider: string | null; model: string | null }> {
    const now = filters.to;

    switch (intent) {
      case 'LOW_ATTENDANCE_STUDENTS': {
        const result = await this.queries.lowAttendance(scope, filters, now);
        const columns: AiTableColumnDto[] = [
          { key: 'fullName', label: 'Student' },
          { key: 'admissionNumber', label: 'Admission no.' },
          { key: 'program', label: 'Program' },
          { key: 'campus', label: 'Campus' },
          { key: 'attendanceRatePercent', label: 'Attendance', format: 'percent' },
          { key: 'marked', label: 'Marked', format: 'number' },
          { key: 'present', label: 'Present', format: 'number' },
        ];
        return this.buildDataAnswer({
          intent,
          answer:
            result.totalCount === 0
              ? `No student in your scope is below the ${filters.attendanceThresholdPercent ?? 75}% attendance threshold for the selected window.`
              : `${result.totalCount} student${result.totalCount === 1 ? '' : 's'} ${result.totalCount === 1 ? 'is' : 'are'} below the ${filters.attendanceThresholdPercent ?? 75}% attendance threshold, averaging ${result.metrics.averageRatePercent ?? 0}% attendance across ${result.metrics.markedCount} marked sessions.`,
          metrics: [
            { key: 'studentCount', label: 'Students below threshold', value: result.metrics.studentCount, unit: 'COUNT' },
            { key: 'thresholdPercent', label: 'Threshold', value: result.metrics.threshold, unit: 'PERCENT' },
            { key: 'averageRatePercent', label: 'Average attendance', value: result.metrics.averageRatePercent, unit: 'PERCENT', hint: 'across the flagged students' },
            { key: 'markedCount', label: 'Marked sessions', value: result.metrics.markedCount, unit: 'COUNT' },
          ],
          table: {
            title: 'Students with low attendance',
            columns,
            rows: result.rows as unknown as AiTableRowDto[],
            totalCount: result.totalCount,
            truncated: result.truncated,
          },
          caveats: [
            `Attendance counts PRESENT and LATE as attended, over every marked session in the window.`,
            ...(result.truncated ? [`Only the first ${result.rows.length} of ${result.totalCount} students are shown.`] : []),
          ],
        });
      }

      case 'OUTSTANDING_FEES': {
        const result = await this.queries.outstandingFees(scope, filters, now);
        const columns: AiTableColumnDto[] = [
          { key: 'fullName', label: 'Student' },
          { key: 'admissionNumber', label: 'Admission no.' },
          { key: 'program', label: 'Program' },
          { key: 'outstandingCents', label: 'Outstanding', format: 'currency' },
          { key: 'overdueCents', label: 'Overdue', format: 'currency' },
          { key: 'lineCount', label: 'Open lines', format: 'number' },
        ];
        const total = (result.metrics.totalOutstandingCents / 100).toFixed(2);
        return this.buildDataAnswer({
          intent,
          answer:
            result.totalCount === 0
              ? 'No student in your scope has an outstanding fee balance for the selected window.'
              : `${result.totalCount} student${result.totalCount === 1 ? '' : 's'} owe ${total} in total, of which ${(result.metrics.totalOverdueCents / 100).toFixed(2)} is already past its due date.`,
          metrics: [
            { key: 'studentCount', label: 'Students with dues', value: result.metrics.studentCount, unit: 'COUNT' },
            { key: 'totalOutstandingCents', label: 'Total outstanding', value: result.metrics.totalOutstandingCents, unit: 'CURRENCY_CENTS' },
            { key: 'totalOverdueCents', label: 'Past due', value: result.metrics.totalOverdueCents, unit: 'CURRENCY_CENTS' },
          ],
          table: {
            title: result.metrics.overdueOnly ? 'Overdue fee balances' : 'Outstanding fee balances',
            columns,
            rows: result.rows as unknown as AiTableRowDto[],
            totalCount: result.totalCount,
            truncated: result.truncated,
          },
          caveats: result.truncated ? [`Only the first ${result.rows.length} of ${result.totalCount} students are shown.`] : [],
        });
      }

      case 'ADMISSIONS_STATISTICS': {
        const result = await this.queries.admissionsStatistics(scope, filters, now);
        const columns: AiTableColumnDto[] = [
          { key: 'status', label: 'Status' },
          { key: 'count', label: 'Applications', format: 'number' },
          { key: 'percentOfTotal', label: 'Share', format: 'percent' },
        ];
        return this.buildDataAnswer({
          intent,
          answer:
            result.totalCount === 0
              ? 'No admission applications were submitted in the selected window.'
              : `${result.totalCount} application${result.totalCount === 1 ? '' : 's'} in the selected window, with ${result.metrics.acceptedCount} accepted or enrolled (${result.metrics.conversionPercent}% conversion).`,
          metrics: [
            { key: 'applicationCount', label: 'Applications', value: result.metrics.applicationCount, unit: 'COUNT' },
            { key: 'acceptedCount', label: 'Accepted or enrolled', value: result.metrics.acceptedCount, unit: 'COUNT' },
            { key: 'conversionPercent', label: 'Conversion', value: result.metrics.conversionPercent, unit: 'PERCENT' },
          ],
          table: {
            title: 'Applications by status',
            columns,
            rows: result.rows as unknown as AiTableRowDto[],
            totalCount: result.totalCount,
            truncated: false,
          },
          caveats: ['Counted over applications submitted in the selected window, not the cumulative stock.'],
        });
      }

      case 'DEPARTMENT_PERFORMANCE': {
        const result = await this.queries.departmentPerformance(scope, filters, now);
        const columns: AiTableColumnDto[] = [
          { key: 'department', label: 'Department' },
          { key: 'campus', label: 'Campus' },
          { key: 'studentCount', label: 'Students', format: 'number' },
          { key: 'attendanceRatePercent', label: 'Attendance', format: 'percent' },
          { key: 'passPercent', label: 'Pass rate', format: 'percent' },
          { key: 'outstandingCents', label: 'Outstanding', format: 'currency' },
        ];
        const weakest = result.rows[0] as { department?: string; attendanceRatePercent?: number } | undefined;
        return this.buildDataAnswer({
          intent,
          answer:
            result.totalCount === 0
              ? 'No department in your scope has students to compare.'
              : `${result.metrics.departmentCount} department${result.metrics.departmentCount === 1 ? '' : 's'} compared, covering ${result.metrics.studentCount} students at ${result.metrics.attendanceRatePercent}% attendance and ${result.metrics.passPercent}% pass rate overall.${weakest?.department ? ` Lowest attendance: ${weakest.department} (${weakest.attendanceRatePercent}%).` : ''}`,
          metrics: [
            { key: 'departmentCount', label: 'Departments', value: result.metrics.departmentCount, unit: 'COUNT' },
            { key: 'studentCount', label: 'Students', value: result.metrics.studentCount, unit: 'COUNT' },
            { key: 'attendanceRatePercent', label: 'Attendance', value: result.metrics.attendanceRatePercent, unit: 'PERCENT' },
            { key: 'passPercent', label: 'Pass rate', value: result.metrics.passPercent, unit: 'PERCENT' },
          ],
          table: {
            title: 'Department performance',
            columns,
            rows: result.rows as unknown as AiTableRowDto[],
            totalCount: result.totalCount,
            truncated: result.truncated,
          },
          caveats: ['A department row covers only the students inside your scope, which may be a subset of the whole department.'],
        });
      }

      case 'EXAM_PERFORMANCE': {
        const result = await this.queries.examPerformance(scope, filters, now);
        const columns: AiTableColumnDto[] = [
          { key: 'subject', label: 'Subject' },
          { key: 'gradedCount', label: 'Graded', format: 'number' },
          { key: 'passCount', label: 'Passed', format: 'number' },
          { key: 'passPercent', label: 'Pass rate', format: 'percent' },
          { key: 'averagePercentage', label: 'Average %', format: 'number' },
        ];
        const weakest = result.rows[0] as { subject?: string; passPercent?: number } | undefined;
        return this.buildDataAnswer({
          intent,
          answer:
            result.totalCount === 0
              ? 'No published results fall inside the selected window.'
              : `${result.metrics.passCount} of ${result.metrics.gradedCount} graded results are a pass (${result.metrics.passPercent}%) across ${result.metrics.subjectCount} subject${result.metrics.subjectCount === 1 ? '' : 's'}.${weakest?.subject ? ` Lowest pass rate: ${weakest.subject} (${weakest.passPercent}%).` : ''}`,
          metrics: [
            { key: 'passPercent', label: 'Overall pass rate', value: result.metrics.passPercent, unit: 'PERCENT' },
            { key: 'gradedCount', label: 'Graded results', value: result.metrics.gradedCount, unit: 'COUNT' },
            { key: 'incompleteCount', label: 'Not yet marked', value: result.metrics.incompleteCount, unit: 'COUNT' },
          ],
          table: {
            title: 'Subject performance',
            columns,
            rows: result.rows as unknown as AiTableRowDto[],
            totalCount: result.totalCount,
            truncated: result.truncated,
          },
          caveats: ['Pass rate excludes results that have not been marked yet.'],
        });
      }

      case 'PLACEMENT_STATISTICS': {
        const result = await this.queries.placementStatistics(scope, filters, now);
        const columns: AiTableColumnDto[] = [
          { key: 'status', label: 'Outcome' },
          { key: 'count', label: 'Students', format: 'number' },
          { key: 'percentOfEligible', label: 'Share of eligible', format: 'percent' },
        ];
        const average = result.metrics.averagePackageCents === null ? null : (result.metrics.averagePackageCents / 100).toFixed(2);
        return this.buildDataAnswer({
          intent,
          answer:
            result.metrics.eligibleCount === 0
              ? 'No placement outcomes exist in the selected window.'
              : `${result.metrics.placedCount} of ${result.metrics.eligibleCount} eligible students placed (${result.metrics.placementRatePercent}%)${average ? `, average package ${average}` : ''}.`,
          metrics: [
            { key: 'placementRatePercent', label: 'Placement rate', value: result.metrics.placementRatePercent, unit: 'PERCENT' },
            { key: 'placedCount', label: 'Placed', value: result.metrics.placedCount, unit: 'COUNT' },
            { key: 'eligibleCount', label: 'Eligible', value: result.metrics.eligibleCount, unit: 'COUNT' },
            { key: 'averagePackageCents', label: 'Average package', value: result.metrics.averagePackageCents, unit: 'CURRENCY_CENTS' },
            { key: 'highestPackageCents', label: 'Highest package', value: result.metrics.highestPackageCents, unit: 'CURRENCY_CENTS' },
          ],
          table: {
            title: 'Placement outcomes',
            columns,
            rows: result.rows as unknown as AiTableRowDto[],
            totalCount: result.totalCount,
            truncated: false,
          },
          caveats: ['Counted once per student, using their most recent outcome in the window.'],
        });
      }

      case 'STUDENT_RISK_INSIGHTS': {
        const result = await this.risk.insights(user, scope, filters, {});
        await this.risk.recordInsightsViewed(user, scope, result, undefined);
        return this.buildDataAnswer({
          intent,
          answer:
            result.counts.total === 0
              ? 'No student in your scope shows a risk factor in the selected window.'
              : `${result.counts.total} student${result.counts.total === 1 ? '' : 's'} flagged: ${result.counts.high} high, ${result.counts.medium} medium, ${result.counts.low} low.`,
          metrics: [
            { key: 'high', label: 'High risk', value: result.counts.high, unit: 'COUNT' },
            { key: 'medium', label: 'Medium risk', value: result.counts.medium, unit: 'COUNT' },
            { key: 'low', label: 'Low risk', value: result.counts.low, unit: 'COUNT' },
            { key: 'attendanceThresholdPercent', label: 'Attendance threshold', value: result.attendanceThresholdPercent, unit: 'PERCENT' },
          ],
          table: {
            ...aiRiskTable(),
            rows: aiRiskRows(result.students),
            totalCount: result.totalCount,
            truncated: result.truncated,
          },
          risks: result,
          caveats: ['Risk is a weighted heuristic over attendance, fees and results — it is a prompt to look, not a conclusion.'],
        });
      }

      case 'REPORT_GENERATION': {
        const reportType = this.reportTypeForQuestion(question);
        const report = await this.reports.generate(user, {
          reportType,
          filters: {
            ...(filters.campusId ? { campusId: filters.campusId } : {}),
            ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
            ...(filters.programId ? { programId: filters.programId } : {}),
            dateFrom: filters.from.toISOString(),
            dateTo: filters.to.toISOString(),
          },
          title: dto.intent ? undefined : question,
          limit: filters.limit,
          save: false,
        });
        return this.buildDataAnswer({
          intent,
          answer: `${report.title}: ${report.rowCount} row${report.rowCount === 1 ? '' : 's'}${report.truncated ? ` of ${report.totalCount}` : ''}.`,
          metrics: [{ key: 'rowCount', label: 'Rows', value: report.rowCount, unit: 'COUNT' }],
          table: {
            title: report.title,
            columns: report.columns,
            rows: report.rows,
            totalCount: report.totalCount,
            truncated: report.truncated,
          },
          report,
          caveats: report.truncated ? [`Only the first ${report.rowCount} of ${report.totalCount} rows are included.`] : [],
        });
      }

      case 'COMMUNICATION_DRAFT': {
        const facts = await this.draft.resolveFacts(scope, filters, question, 'GUARDIAN');
        const generated = await this.draft.generate(
          {
            channel: 'EMAIL',
            tone: 'FORMAL',
            audience: 'GUARDIAN',
            question,
          },
          facts,
        );
        await this.draft.recordGenerated(user, generated);
        return this.buildDataAnswer({
          intent,
          answer: `Drafted a ${generated.tone.toLowerCase()} ${generated.channel} message about ${facts.headline}. Nothing has been sent.`,
          metrics: this.draft.metricsFor(facts),
          draft: generated,
          caveats: ['This is a draft only. Sending it requires a separate action and the notifications.send permission.'],
        });
      }

      case 'ANALYTICS_OVERVIEW': {
        // Reuses the analytics service rather than reimplementing the rollup: an "overview" that
        // answered from a different query path would disagree with the dashboard it is meant to
        // summarize, which is worse than having no overview at all.
        const overview = await this.analyticsOverview(user, filters);
        return this.buildDataAnswer({
          intent,
          answer: `${overview.students.total} students, ${overview.admissions.total} applications, ${overview.attendance.ratePercent}% attendance, ${overview.fees.collectionRatePercent}% fee collection and a ${overview.placement.ratePercent}% placement rate.`,
          metrics: [
            { key: 'students', label: 'Students', value: overview.students.total, unit: 'COUNT' },
            { key: 'applications', label: 'Applications', value: overview.admissions.total, unit: 'COUNT' },
            { key: 'attendanceRatePercent', label: 'Attendance', value: overview.attendance.ratePercent, unit: 'PERCENT' },
            { key: 'feeCollectionRatePercent', label: 'Fee collection', value: overview.fees.collectionRatePercent, unit: 'PERCENT' },
            { key: 'placementRatePercent', label: 'Placement rate', value: overview.placement.ratePercent, unit: 'PERCENT' },
          ],
          table: {
            title: 'Key figures',
            columns: [
              { key: 'metric', label: 'Metric' },
              { key: 'value', label: 'Value', format: 'number' },
            ],
            rows: [
              { metric: 'Students', value: overview.students.total },
              { metric: 'New in period', value: overview.students.newInPeriod },
              { metric: 'Applications', value: overview.admissions.total },
              { metric: 'Attendance rate %', value: overview.attendance.ratePercent },
              { metric: 'Fee collection %', value: overview.fees.collectionRatePercent },
              { metric: 'Placement rate %', value: overview.placement.ratePercent },
            ],
            totalCount: 6,
            truncated: false,
          },
          caveats: ['Served from the analytics rollups, which the background refresh keeps current.'],
        });
      }

      default: {
        throw new BadRequestException(`Unsupported AI capability: ${intent}`);
      }
    }
  }

  // ── Internals: routing, filters, persistence ──────────────────────────────

  /** Deterministic routing; shared shape with the explicit-intent override path in `ask`. */
  private route(question: string): AiRouteResult {
    return routeAiQuestion(question);
  }

  /**
   * Merges request overrides, router slots and defaults into the filters actually applied.
   *
   * Precedence is fixed and documented here because it is the difference between a stated window and
   * a guessed one, and the user cannot see which they got. Echoed back in the answer either way.
   */
  private buildFilters(dto: AskAiQuestionDto, slots: AiResolvedSlots): AiResolvedFilters & { limit: number } {
    const now = new Date();
    const to = dto.dateTo ? new Date(dto.dateTo) : (slots.dateTo ?? now);
    const from = dto.dateFrom
      ? new Date(dto.dateFrom)
      : (slots.dateFrom ?? new Date(to.getTime() - 30 * 86_400_000));
    const maxRows = this.appConfig.get('AI_MAX_ROWS');
    return {
      from,
      to,
      attendanceThresholdPercent: dto.attendanceThresholdPercent ?? slots.attendanceThresholdPercent,
      overdueOnly: dto.overdueOnly ?? slots.overdueOnly,
      ...(dto.campusId ? { campusId: dto.campusId } : {}),
      ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
      ...(dto.programId ? { programId: dto.programId } : {}),
      limit: Math.min(dto.limit ?? maxRows, maxRows),
    };
  }

  /**
   * Filters for the standalone endpoints.
   *
   * Same precedence and same default window as the conversational `buildFilters`: explicit values
   * win, otherwise the default trailing window applies. The resolved window is echoed back in the
   * response, so a panel and a chat answer about "attendance" can never disagree about which days
   * were counted while looking identical.
   */
  private buildStandaloneFilters(dto: {
    dateFrom?: string;
    dateTo?: string;
    attendanceThresholdPercent?: number;
    overdueOnly?: boolean;
    campusId?: string;
    departmentId?: string;
    programId?: string;
    studentId?: string;
    limit?: number;
  }): AiResolvedFilters {
    const maxRows = this.appConfig.get('AI_MAX_ROWS');
    const to = dto.dateTo ? new Date(dto.dateTo) : new Date();
    const from = dto.dateFrom
      ? new Date(dto.dateFrom)
      : new Date(to.getTime() - DEFAULT_WINDOW_DAYS * 86_400_000);
    return {
      from,
      to,
      ...(dto.attendanceThresholdPercent !== undefined ? { attendanceThresholdPercent: dto.attendanceThresholdPercent } : {}),
      ...(dto.overdueOnly !== undefined ? { overdueOnly: dto.overdueOnly } : {}),
      ...(dto.campusId ? { campusId: dto.campusId } : {}),
      ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
      ...(dto.programId ? { programId: dto.programId } : {}),
      ...(dto.studentId ? { studentId: dto.studentId } : {}),
      limit: Math.min(dto.limit ?? maxRows, maxRows),
    };
  }

  /** The explicit org-unit narrowing on a request, for `assertRequestedNodeInScope`. */
  private requestedNode(dto: { campusId?: string; departmentId?: string; programId?: string }) {
    return {
      ...(dto.campusId ? { campusId: dto.campusId } : {}),
      ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
      ...(dto.programId ? { programId: dto.programId } : {}),
    };
  }

  /**
   * Which intent's permission governs the facts a standalone draft is built from.
   *
   * `AiDraftService.resolveFacts` sources facts from exactly four scoped queries, so a question that
   * routes to one of those uses that intent's source permission ("about fees" needs `fees.view`).
   * A question with no recognizable topic falls back to the drafting intent's own `students.view` —
   * the narrowest grant that lets anyone draft at all — rather than silently reading whichever
   * domain happened to be first.
   */
  private draftScopeDefinition(question: string): AiIntentDefinition {
    const routed = routeAiQuestion(question);
    const factIntents: AiIntentDto[] = [
      'OUTSTANDING_FEES',
      'LOW_ATTENDANCE_STUDENTS',
      'EXAM_PERFORMANCE',
      'PLACEMENT_STATISTICS',
    ];
    if (routed.intent && factIntents.includes(routed.intent)) {
      return assertKnownAiIntent(routed.intent);
    }
    return assertKnownAiIntent('COMMUNICATION_DRAFT');
  }

  /** Shared report execution for the preview and export routes. */
  private runReport(user: AuthenticatedUser, dto: GenerateAiReportDto, save: boolean): Promise<AiGeneratedReportDto> {
    return this.reports.generate(user, {
      reportType: dto.reportType ?? this.reportTypeForQuestion(dto.question ?? ''),
      filters: this.reportFilters(dto),
      ...(dto.title ? { title: dto.title } : {}),
      limit: Math.min(dto.limit ?? this.appConfig.get('AI_MAX_ROWS'), this.appConfig.get('AI_MAX_ROWS')),
      save,
    });
  }

  /**
   * The reporting engine's filter shape, from the assistant's request.
   *
   * The window is always resolved to concrete instants: the engine has no notion of a default
   * window, so an omitted pair would mean "everything ever" rather than the last 30 days. That
   * difference is invisible in the response and enormous in the row count, so the assistant fills it.
   */
  private reportFilters(dto: GenerateAiReportDto): ReportFilters {
    const window = this.buildStandaloneFilters({ dateFrom: dto.dateFrom, dateTo: dto.dateTo });
    return {
      dateFrom: window.from.toISOString(),
      dateTo: window.to.toISOString(),
      ...(dto.campusId ? { campusId: dto.campusId } : {}),
      ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
      ...(dto.programId ? { programId: dto.programId } : {}),
      ...(dto.status ? { status: dto.status } : {}),
    };
  }

  /** The reporting-engine report type a natural-language report request most likely means. */
  private reportTypeForQuestion(question: string): string {
    const text = question.toLowerCase();
    if (/\battendance/.test(text)) return 'ATTENDANCE';
    if (/\bfee|dues|payment|collection/.test(text)) return 'FEES';
    if (/\bexam|result|mark/.test(text)) return 'EXAMS';
    if (/\badmission|application|enquir/.test(text)) return 'ADMISSIONS';
    if (/\bplacement|package/.test(text)) return 'PLACEMENTS';
    if (/\blibrary|loan|book/.test(text)) return 'LIBRARY';
    if (/\bhostel|accommodation/.test(text)) return 'HOSTEL';
    if (/\btransport|bus pass/.test(text)) return 'TRANSPORT';
    if (/\binventory|stock|lab/.test(text)) return 'INVENTORY';
    return 'STUDENTS';
  }

  /**
   * Builds a data answer and, if asked, asks a provider to phrase it.
   *
   * The deterministic answer is produced first and is *not* discarded if narration succeeds — it stays
   * in the payload as `summary`. A reader (or an auditor) can therefore always see the figure the
   * system computed independently of what the model wrote.
   *
   * `table` and `caveats` are both optional because not every capability has rows to show: a drafted
   * communication carries aggregates and a body, not a table, and an answer with nothing to caveat
   * should say so with an empty list rather than omitting the field the UI reads.
   */
  private buildDataAnswer(input: {
    intent: AiIntentDto;
    answer: string;
    metrics: AiMetricDto[];
    table?: AiTableDto;
    caveats?: string[];
    risks?: AiAnswerPayloadDto['risks'];
    draft?: AiAnswerPayloadDto['draft'];
    report?: AiAnswerPayloadDto['report'];
  }): { answer: string; payload: AiAnswerPayloadDto; provider: string | null; model: string | null } {
    const payload: AiAnswerPayloadDto = {
      intent: input.intent,
      summary: input.answer,
      metrics: input.metrics,
      tables: input.table ? [input.table] : [],
      ...(input.risks ? { risks: input.risks } : {}),
      ...(input.draft ? { draft: input.draft } : {}),
      ...(input.report ? { report: input.report } : {}),
      caveats: input.caveats ?? [],
    };
    return { answer: input.answer, payload, provider: null, model: null };
  }

  /**
   * Optional narration pass.
   *
   * Only invoked when the caller set `narrate` AND a provider exists. A provider failure falls back to
   * the deterministic answer with the failure recorded as a caveat — degrading wording, never content,
   * because the numbers have already been computed and verified against the scope.
   */
  private async narrate(
    question: string,
    deterministic: string,
    payload: AiAnswerPayloadDto,
    requested: boolean,
  ): Promise<{ answer: string; provider: string | null; model: string | null; kind: AiResponseKindDto }> {
    if (!requested || !this.llm.hasProvider) {
      return { answer: deterministic, provider: null, model: null, kind: 'DATA' };
    }
    try {
      const facts: Record<string, string | number | boolean | null> = {};
      for (const metric of payload.metrics) facts[metric.label] = metric.value;
      const rows = payload.tables[0]?.rows.slice(0, 20) ?? [];
      const result = await this.llm.complete({ question, facts, rows, baseline: deterministic });
      if (!result?.text) {
        return { answer: deterministic, provider: null, model: null, kind: 'DATA' };
      }
      return { answer: result.text, provider: result.provider, model: result.model, kind: 'DATA_WITH_NARRATION' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Narration failed, returning the deterministic answer: ${message}`);
      payload.caveats.push(`Narration was unavailable (${message}); the figures below are unaffected.`);
      return { answer: deterministic, provider: null, model: null, kind: 'DATA' };
    }
  }

  /** Persists a successful turn: user message, assistant message, query log, audit. */
  private async persistAnswer(
    user: AuthenticatedUser,
    conversationId: string,
    question: string,
    resolved: { answer: string; payload: AiAnswerPayloadDto; provider: string | null; model: string | null },
    scope: ResolvedAiScope,
    routed: { definition: AiIntentDefinition; matchedPatterns: string[] },
    filters: AiResolvedFilters & { limit: number },
    started: number,
    narrateRequested: boolean,
  ): Promise<AiQueryResponseDto> {
    const latencyMs = Date.now() - started;
    // A drafted body is generated text, not a data answer: recording it as DATA would make the
    // compliance filter for "what did the assistant write?" useless. `draft.generate` has already
    // applied any provider wording, so the framing sentence is not narrated a second time (which
    // would be a redundant model pass over the same request).
    const narrated: { answer: string; provider: string | null; model: string | null; kind: AiResponseKindDto } =
      resolved.payload.draft
        ? { answer: resolved.answer, provider: resolved.provider, model: resolved.model, kind: 'GENERATED_TEXT' }
        : await this.narrate(question, resolved.answer, resolved.payload, narrateRequested);

    // The user's question is stored as its own row so the thread reads as a conversation; only the
    // assistant message needs to be kept in a variable (its id is the query log's key).
    await this.untypedCreate().aiMessage.create({
      data: { conversationId, role: 'user', content: question },
    });
    const assistantMessage = await this.untypedCreate().aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        intent: routed.definition.intent,
        content: narrated.answer,
        payload: this.json(resolved.payload),
        filters: this.json(this.describeFilters(filters)),
        scopeSnapshot: this.json(scope.snapshot),
        responseKind: narrated.kind,
        provider: narrated.provider,
        model: narrated.model,
        latencyMs,
      },
    });

    await this.untypedCreate().aiQueryLog.create({
      data: {
        conversationId,
        messageId: assistantMessage.id,
        userId: user.id,
        question,
        intent: routed.definition.intent,
        outcome: narrated.kind,
        scopeSnapshot: this.json(scope.snapshot),
        filters: this.json(this.describeFilters(filters)),
        sourcePermission: routed.definition.sourcePermission,
        rowCount: resolved.payload.tables.reduce((total, table) => total + table.totalCount, 0),
        latencyMs,
      },
    });

    await this.tenantPrisma.client.aiConversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } });

    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_QUERY_EXECUTED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiMessage',
      entityId: assistantMessage.id,
      after: {
        intent: routed.definition.intent,
        sourcePermission: routed.definition.sourcePermission,
        matchedPatterns: routed.matchedPatterns,
        responseKind: narrated.kind,
        provider: narrated.provider,
        rowCount: resolved.payload.tables.reduce((total, table) => total + table.totalCount, 0),
        filters: this.describeFilters(filters),
        isGlobal: scope.snapshot.isGlobal,
        latencyMs,
      },
    });

    return {
      conversationId,
      messageId: assistantMessage.id,
      question,
      answer: assistantMessage.content,
      payload: resolved.payload,
      intent: routed.definition.intent,
      responseKind: narrated.kind,
      filters: this.describeFilters(filters) as unknown as Record<string, unknown>,
      scope: scope.snapshot,
      provider: narrated.provider,
      model: narrated.model,
      latencyMs,
      createdAt: assistantMessage.createdAt.toISOString(),
    };
  }

  /** The router found nothing. Logged as UNSUPPORTED — unanswered phrasings are the build list. */
  private async persistUnroutable(
    user: AuthenticatedUser,
    conversationId: string,
    question: string,
    started: number,
    matchedPatterns: string[],
  ): Promise<AiQueryResponseDto> {
    const latencyMs = Date.now() - started;
    const examples = AI_INTENTS.slice(0, 4).map((definition) => definition.example);

    const payload: AiAnswerPayloadDto = {
      intent: null,
      summary: 'That question does not map to any supported capability yet.',
      metrics: [],
      tables: [],
      caveats: [`Try one of: ${examples.join(' / ')}`],
    };
    const answer = `I could not map that to a capability. Try: ${examples.join(' / ')}`;

    const assistantMessage = await this.untypedCreate().aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        intent: null,
        content: answer,
        payload: this.json(payload),
        responseKind: 'UNSUPPORTED',
        scopeSnapshot: this.json(NO_SCOPE),
        latencyMs,
      },
    });

    await this.untypedCreate().aiQueryLog.create({
      data: {
        conversationId,
        messageId: assistantMessage.id,
        userId: user.id,
        question,
        intent: null,
        outcome: 'UNSUPPORTED',
        scopeSnapshot: this.json(NO_SCOPE),
        latencyMs,
      },
    });

    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_QUERY_UNSUPPORTED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiMessage',
      entityId: assistantMessage.id,
      after: { question, matchedPatterns },
    });

    return {
      conversationId,
      messageId: assistantMessage.id,
      question,
      answer,
      payload,
      intent: null,
      responseKind: 'UNSUPPORTED',
      filters: null,
      scope: NO_SCOPE,
      provider: null,
      model: null,
      latencyMs,
      createdAt: assistantMessage.createdAt.toISOString(),
    };
  }

  /** The capability was recognized but the caller's grants do not cover it. */
  private async persistForbidden(
    user: AuthenticatedUser,
    conversationId: string,
    question: string,
    started: number,
    intent: AiIntentDto,
    err: unknown,
  ): Promise<AiQueryResponseDto> {
    const message = err instanceof Error ? err.message : String(err);
    const payload: AiAnswerPayloadDto = {
      intent,
      summary: 'You do not have access to the data this question needs.',
      metrics: [],
      tables: [],
      caveats: [message],
    };

    const assistantMessage = await this.untypedCreate().aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        intent: intent,
        content: message,
        payload: this.json(payload),
        responseKind: 'FORBIDDEN',
        scopeSnapshot: this.json(NO_SCOPE),
        latencyMs: Date.now() - started,
      },
    });

    await this.untypedCreate().aiQueryLog.create({
      data: {
        conversationId,
        messageId: assistantMessage.id,
        userId: user.id,
        question,
        intent: intent,
        outcome: 'FORBIDDEN',
        errorMessage: message,
        latencyMs: Date.now() - started,
      },
    });

    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_QUERY_FORBIDDEN,
      module: AUDIT_MODULES.AI,
      entityType: 'AiMessage',
      entityId: assistantMessage.id,
      after: { question, intent, reason: message },
    });

    return {
      conversationId,
      messageId: assistantMessage.id,
      question,
      answer: message,
      payload,
      intent,
      responseKind: 'FORBIDDEN',
      filters: null,
      scope: NO_SCOPE,
      provider: null,
      model: null,
      latencyMs: Date.now() - started,
      createdAt: assistantMessage.createdAt.toISOString(),
    };
  }

  /** Authorized, but the query itself failed. */
  private async persistFailure(
    user: AuthenticatedUser,
    conversationId: string,
    question: string,
    started: number,
    scope: ResolvedAiScope,
    intent: AiIntentDto,
    err: unknown,
  ): Promise<AiQueryResponseDto> {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`AI query failed for intent ${intent}: ${message}`);
    const latencyMs = Date.now() - started;

    const payload: AiAnswerPayloadDto = {
      intent,
      summary: 'The query could not be completed.',
      metrics: [],
      tables: [],
      caveats: [message],
    };

    const assistantMessage = await this.untypedCreate().aiMessage.create({
      data: {
        conversationId,
        role: 'assistant',
        intent: intent,
        content: payload.summary,
        payload: this.json(payload),
        responseKind: 'FAILED',
        scopeSnapshot: this.json(scope.snapshot),
        latencyMs,
      },
    });

    await this.untypedCreate().aiQueryLog.create({
      data: {
        conversationId,
        messageId: assistantMessage.id,
        userId: user.id,
        question,
        intent: intent,
        outcome: 'FAILED',
        scopeSnapshot: this.json(scope.snapshot),
        errorMessage: message,
        latencyMs,
      },
    });

    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_QUERY_FAILED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiMessage',
      entityId: assistantMessage.id,
      after: { question, intent, error: message },
    });

    return {
      conversationId,
      messageId: assistantMessage.id,
      question,
      answer: payload.summary,
      payload,
      intent,
      responseKind: 'FAILED',
      filters: null,
      scope: scope.snapshot,
      provider: null,
      model: null,
      latencyMs,
      createdAt: assistantMessage.createdAt.toISOString(),
    };
  }

  /**
   * Filters, as recorded.
   *
   * The *resolved* window rather than the question: a user should be able to tell that "last 30 days"
   * became a concrete pair of timestamps, without the log containing their free text twice.
   */
  private describeFilters(filters: AiResolvedFilters & { limit: number }): Record<string, unknown> {
    return {
      from: filters.from.toISOString(),
      to: filters.to.toISOString(),
      ...(filters.attendanceThresholdPercent !== undefined ? { attendanceThresholdPercent: filters.attendanceThresholdPercent } : {}),
      ...(filters.overdueOnly !== undefined ? { overdueOnly: filters.overdueOnly } : {}),
      ...(filters.campusId ? { campusId: filters.campusId } : {}),
      ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
      ...(filters.programId ? { programId: filters.programId } : {}),
      limit: filters.limit,
    };
  }

  /**
   * The college overview, served by the analytics service itself.
   *
   * Reusing it wholesale is the point: an "overview" that answered from its own query path would be a
   * second implementation of the same rollup and would drift from the dashboard it summarizes. The
   * scope is already the intersection `resolveAiScope` computed, and `CollegeAnalyticsService`
   * re-resolves its own `analytics.view` intersection on top — the assistant's grant is the narrower
   * of the two by construction.
   */
  private async analyticsOverview(user: AuthenticatedUser, filters: AiResolvedFilters) {
    // AnalyticsQueryDto speaks in trailing buckets (`periods`) plus an optional explicit from/to, and
    // has no org-unit fields: its own `resolveAnalyticsScope` is the only narrowing it supports. The
    // assistant's department/program narrowing therefore does not apply to this answer — which is
    // correct, because the scope intersection in `resolveAiScope` is what actually narrows it.
    const query: AnalyticsQueryDto = {
      from: filters.from.toISOString(),
      to: filters.to.toISOString(),
      periods: 1,
    };
    return this.analytics.overview(user, query);
  }

  private async createConversationInternal(user: AuthenticatedUser, title?: string) {
    return this.untypedCreate().aiConversation.create({
      data: { ownerId: user.id, title: title ?? 'New conversation' },
    });
  }

  private async findOwnedConversation(user: AuthenticatedUser, id: string) {
    const conversation = await this.tenantPrisma.client.aiConversation.findFirst({
      where: { id, ownerId: user.id },
      select: { id: true, title: true, isArchived: true, createdAt: true, updatedAt: true },
    });
    if (!conversation) throw new NotFoundException('Conversation not found.');
    return conversation;
  }

  private toConversationDto(row: {
    id: string;
    title: string;
    isArchived: boolean;
    createdAt: Date;
    updatedAt: Date;
    _count: { messages: number };
  }): AiConversationDto {
    return {
      id: row.id,
      title: row.title,
      isArchived: row.isArchived,
      messageCount: row._count.messages,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toMessageDto(row: {
    id: string;
    conversationId: string;
    role: string;
    intent: string | null;
    content: string;
    payload: Prisma.JsonValue;
    responseKind: string;
    provider: string | null;
    model: string | null;
    latencyMs: number | null;
    createdAt: Date;
    feedback: { id: string; messageId: string; rating: string; comment: string | null; createdAt: Date } | null;
  }): AiMessageDto {
    return {
      id: row.id,
      conversationId: row.conversationId,
      role: row.role as 'user' | 'assistant',
      intent: row.intent as AiIntentDto | null,
      content: row.content,
      payload: (row.payload as AiAnswerPayloadDto | null) ?? null,
      responseKind: row.responseKind as AiResponseKindDto,
      provider: row.provider,
      model: row.model,
      latencyMs: row.latencyMs,
      feedback: row.feedback
        ? {
            id: row.feedback.id,
            messageId: row.feedback.messageId,
            rating: row.feedback.rating as 'up' | 'down',
            comment: row.feedback.comment,
            createdAt: row.feedback.createdAt.toISOString(),
          }
        : null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
  }

  /**
   * Untyped creates.
   *
   * The tenant-scope extension injects `tenantId` at runtime while the generated create-input still
   * demands it at compile time. One cast, confined here — the same reason ReportsService has one.
   */
  private untypedCreate(): UntypedCreateClient {
    return this.tenantPrisma.client as unknown as UntypedCreateClient;
  }
}

interface UntypedCreateClient {
  aiConversation: { create(args: { data: Record<string, unknown> }): Promise<{ id: string; title: string; isArchived: boolean; createdAt: Date; updatedAt: Date }> };
  aiMessage: {
    create(args: { data: Record<string, unknown> }): Promise<{ id: string; content: string; createdAt: Date }>;
  };
  aiQueryLog: { create(args: { data: Record<string, unknown> }): Promise<{ id: string }> };
  aiFeedback: {
    upsert(args: {
      where: { messageId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
      select: { id: true; messageId: true; rating: true; comment: true; createdAt: true };
    }): Promise<{ id: string; messageId: string; rating: string; comment: string | null; createdAt: Date }>;
  };
}

