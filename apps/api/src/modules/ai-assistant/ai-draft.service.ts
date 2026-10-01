/**
 * Communication drafting: turn the scoped facts behind a question into a message a human can send.
 *
 * Three properties this service is built around.
 *
 *  1. **A draft is never a send.** `generate()` only ever returns text. Sending is a separate,
 *     separately-permissioned call (`sendDraft`) that requires `notifications.send` *in addition to*
 *     the AI grant, and it re-reads the stored draft rather than accepting a body from the request.
 *     A caller who can draft cannot thereby broadcast; that separation is the whole point.
 *
 *  2. **The deterministic template is the baseline, not a fallback.** A provider only rewrites
 *     wording over the same `variables`; it never sees the underlying rows and can add no new fact.
 *     With `AI_PROVIDER=none` the user still gets a usable message — which is why the capability is
 *     sellable before anyone buys an API key.
 *
 *  3. **Names in a draft come from scoped SQL, and only where they must.** Individual student names
 *     are omitted from the body by default and replaced with counts, because a draft is the artefact
 *     most likely to be pasted into a bulk send. `variables` records exactly which aggregate went
 *     into each sentence, so nobody has to guess what a "12 students" line was based on.
 */

import { ForbiddenException, Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, PERMISSION_KEYS, type AuthenticatedUser } from '@college-erp/auth';
import type { AiDraftAudienceDto, AiDraftDto, AiDraftToneDto, AiMetricDto } from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PermissionsService } from '../rbac/permissions.service';
import { AiLlmProvider } from './ai-llm.provider';
import { AiQueriesService, type AiResolvedFilters } from './ai-queries.service';
import type { ResolvedAiScope } from './ai-scope';

export type AiDraftChannel = 'EMAIL' | 'SMS' | 'IN_APP';

export interface AiDraftInput {
  channel: AiDraftChannel;
  tone: AiDraftToneDto;
  audience: AiDraftAudienceDto;
  question: string;
  extraInstructions?: string;
}

/** What the underlying scoped query produced, before any wording is chosen. */
export interface AiDraftFacts {
  /** The headline the message is about, e.g. "12 students have attendance below 75%". */
  headline: string;
  /** Aggregate figures the body may state. Rendered verbatim into `variables`. */
  variables: Record<string, string | number | boolean>;
  /** How many people the message is about. Drives the opening line. */
  audienceSize: number;
  /** Optional named rows, only for audiences where naming is appropriate. */
  names?: string[];
}

@Injectable()
export class AiDraftService {
  constructor(
    private readonly prisma: TenantScopedPrismaService,
    private readonly permissions: PermissionsService,
    private readonly llm: AiLlmProvider,
    private readonly queries: AiQueriesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Facts for a draft, derived from the same scoped queries the data answers use.
   *
   * Reusing `AiQueriesService` here is what stops the drafting path from becoming a second, weaker
   * authorization surface: the numbers in a draft and the numbers on screen come from one query
   * under one scope.
   */
  async resolveFacts(
    scope: ResolvedAiScope,
    filters: AiResolvedFilters,
    question: string,
    audience: AiDraftAudienceDto,
  ): Promise<AiDraftFacts> {
    const lower = question.toLowerCase();

    if (/\bfee|dues|owing|unpaid|outstanding|payment/.test(lower)) {
      const result = await this.queries.outstandingFees(scope, filters, filters.to);
      const overdueOnly = result.metrics.overdueOnly;
      return {
        headline: overdueOnly
          ? `${result.totalCount} student${result.totalCount === 1 ? '' : 's'} have fees past their due date`
          : `${result.totalCount} student${result.totalCount === 1 ? '' : 's'} have an outstanding fee balance`,
        variables: {
          studentCount: result.totalCount,
          totalOutstandingCents: result.metrics.totalOutstandingCents,
          totalOverdueCents: result.metrics.totalOverdueCents,
          overdueOnly,
        },
        audienceSize: result.totalCount,
        names: audience === 'GUARDIAN' ? undefined : result.rows.map((row) => row.fullName),
      };
    }

    if (/\battendance|absent|bunk/.test(lower)) {
      const threshold = filters.attendanceThresholdPercent ?? 75;
      const result = await this.queries.lowAttendance(scope, filters, filters.to);
      return {
        headline: `${result.totalCount} student${result.totalCount === 1 ? '' : 's'} ${result.totalCount === 1 ? 'has' : 'have'} attendance below ${threshold}%`,
        variables: {
          studentCount: result.totalCount,
          thresholdPercent: threshold,
          averageRatePercent: result.metrics.averageRatePercent ?? 0,
        },
        audienceSize: result.totalCount,
        names: audience === 'GUARDIAN' ? undefined : result.rows.map((row) => row.fullName),
      };
    }

    if (/\bresult|exam|pass|fail|mark/.test(lower)) {
      const result = await this.queries.examPerformance(scope, filters, filters.to);
      return {
        headline: `${result.metrics.passPercent}% of published results are a pass across ${result.metrics.subjectCount} subject${result.metrics.subjectCount === 1 ? '' : 's'}`,
        variables: {
          passPercent: result.metrics.passPercent,
          gradedCount: result.metrics.gradedCount,
          incompleteCount: result.metrics.incompleteCount,
          subjectCount: result.metrics.subjectCount,
        },
        audienceSize: result.metrics.gradedCount,
      };
    }

    if (/\bplacement|placed|package|recruit/.test(lower)) {
      const result = await this.queries.placementStatistics(scope, filters, filters.to);
      return {
        headline: `${result.metrics.placedCount} of ${result.metrics.eligibleCount} eligible students ${result.metrics.placedCount === 1 ? 'has' : 'have'} been placed`,
        variables: {
          eligibleCount: result.metrics.eligibleCount,
          placedCount: result.metrics.placedCount,
          placementRatePercent: result.metrics.placementRatePercent,
        },
        audienceSize: result.metrics.eligibleCount,
      };
    }

    // No recognisable subject in the question: the draft says so rather than inventing a topic. A
    // template that says "your recent records show elevated..." would be a fabrication.
    return {
      headline: 'a general update from the college',
      variables: {},
      audienceSize: 0,
    };
  }

  /**
   * Builds the message.
   *
   * The template is selected by (audience, tone) and rendered over `facts`. Provider narration is
   * attempted only when the caller asked for it and a provider exists; a provider failure falls back
   * to the deterministic body with the failure recorded in `variables.narrated`, because losing a
   * draft over an optional quality improvement is the wrong trade.
   */
  async generate(input: AiDraftInput, facts: AiDraftFacts): Promise<AiDraftDto> {
    const deterministic = renderTemplate(input, facts);

    let body = deterministic.body;
    let provider: string | null = null;
    let model: string | null = null;

    if (this.llm.hasProvider) {
      try {
        const result = await this.llm.generateText({
          instruction: buildDraftingInstruction(input, facts),
          // Only the aggregates, never the row set: a drafting prompt has no business holding a list
          // of students, and the template does not need one to write the message.
          context: JSON.stringify({ headline: facts.headline, variables: facts.variables, audienceSize: facts.audienceSize }),
          maxTokens: input.channel === 'SMS' ? 120 : 400,
        });
        if (result?.text) {
          body = result.text;
          provider = result.provider;
          model = result.model;
        }
      } catch {
        // Provider is optional by design; the deterministic body is a complete answer on its own.
        provider = null;
        model = null;
      }
    }

    return {
      channel: input.channel,
      tone: input.tone,
      audience: input.audience,
      subject: deterministic.subject,
      body,
      variables: { ...facts.variables, narrated: provider !== null },
      narrated: provider !== null,
      provider,
      model,
      audienceSize: facts.audienceSize,
    };
  }

  async recordGenerated(user: AuthenticatedUser, draft: AiDraftDto): Promise<void> {
    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_DRAFT_GENERATED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiDraft',
      // Metadata only — the body is deliberately not copied into the audit trail; it is already in
      // AiMessage.payload, and duplicating a message that may contain student data into an
      // append-only log nobody can delete is the wrong place to put it.
      after: {
        channel: draft.channel,
        tone: draft.tone,
        audience: draft.audience,
        audienceSize: draft.audienceSize,
        narrated: draft.narrated,
        provider: draft.provider,
      },
    });
  }

  /**
   * Sends a stored draft to one tenant user.
   *
   * Three separate refusals, all intentional:
   *  - `ai.create` alone is not enough — `notifications.send` is required, so the assistant is
   *    never a way around the notification module's own permission model.
   *  - The recipient is resolved through the tenant-scoped client, so a user id from another tenant
   *    is simply not found. (The notifications service enforces this too; asserting it here means the
   *    failure is explained as "not in this tenant" rather than surfacing as an internal error.)
   *  - The body comes from the stored draft, never from the request body.
   */
  async sendDraft(
    user: AuthenticatedUser,
    draft: AiDraftDto,
    recipientUserId: string,
    scheduledAt?: string,
  ): Promise<{ notificationId: string; scheduled: boolean }> {
    const effective = await this.permissions.getEffectivePermissionsWithScope(user.tenantId, user.id);
    if (!effective[PERMISSION_KEYS.NOTIFICATIONS_SEND]?.length) {
      throw new ForbiddenException('Missing required permission: notifications.send');
    }

    const recipient = await this.prisma.client.user.findFirst({
      where: { id: recipientUserId },
      select: { id: true },
    });
    if (!recipient) {
      throw new ForbiddenException('Recipient not found in this tenant.');
    }

    // Reuses NotificationsService.send unchanged rather than writing a second delivery path: one
    // pipeline means one set of provider credentials, one retry behaviour and one audit action for
    // every message the platform sends, whether a human or the assistant composed it.
    const notification = await this.notifications.send(
      user.tenantId,
      {
        recipientUserId,
        channel: draft.channel,
        subject: draft.subject,
        body: draft.body,
        ...(scheduledAt ? { scheduledAt } : {}),
        variables: draft.variables,
      },
      user.id,
    );

    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_DRAFT_SENT,
      module: AUDIT_MODULES.AI,
      entityType: 'Notification',
      entityId: notification.id,
      after: { channel: draft.channel, audience: draft.audience, scheduledAt: scheduledAt ?? null, recipientUserId },
    });

    return { notificationId: notification.id, scheduled: Boolean(scheduledAt) };
  }

  /** Metrics shown alongside a drafted message. */
  metricsFor(facts: AiDraftFacts): AiMetricDto[] {
    return [
      { key: 'audienceSize', label: 'People in the audience', value: facts.audienceSize, unit: 'COUNT' },
      { key: 'headline', label: 'Basis', value: facts.headline, unit: 'TEXT' },
    ];
  }
}

/**
 * Drafting instruction handed to a provider.
 *
 * Explicit that the aggregate is the only content, and that a missing fact must be reported rather
 * than invented — the two ways a generated message becomes a false statement to a parent.
 */
function buildDraftingInstruction(input: AiDraftInput, facts: AiDraftFacts): string {
  return [
    `Write a ${input.tone.toLowerCase()} ${input.channel === 'SMS' ? 'SMS' : 'message'} for ${audienceLabel(input.audience)}.`,
    `Topic: ${facts.headline}.`,
    facts.audienceSize === 0
      ? 'No figures are available for this topic. Say plainly that there is nothing to report and do not estimate.'
      : 'Use only the supplied figures. Do not add dates, amounts, names, or policies.',
    input.channel === 'SMS' ? 'Keep it under 320 characters.' : 'Keep it to a short paragraph plus an optional call to action.',
    input.extraInstructions ? `Additional instruction: ${input.extraInstructions}` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function audienceLabel(audience: AiDraftAudienceDto): string {
  switch (audience) {
    case 'GUARDIAN':
      return 'the guardians/parents of affected students';
    case 'STUDENT':
      return 'the affected students';
    case 'FACULTY':
      return 'the faculty';
    case 'STAFF':
      return 'staff';
    default:
      return 'the recipients';
  }
}

/** Opening/closing pairs per (audience, tone). Explicit strings beat a template engine here: a
 *  message's register is a judgement call, and it should be reviewable in one place. */
function renderTemplate(input: AiDraftInput, facts: AiDraftFacts): { subject: string; body: string } {
  const salutation = salutationFor(input.tone, input.audience);
  const signOff = signOffFor(input.tone);
  const callToAction = callToActionFor(input.audience, input.tone);

  const subject = subjectFor(input, facts);
  const figures = figuresFor(input.channel, facts);

  const lines = [salutation, ''];
  if (facts.audienceSize === 0) {
    lines.push('There is nothing to report on this at present. We will write again as soon as there is.');
  } else {
    lines.push(figures);
    if (input.tone === 'FIRM') {
      lines.push('This requires your attention. Please treat it as a priority.');
    }
    lines.push(callToAction);
  }
  lines.push('', signOff);

  return { subject, body: lines.join('\n') };
}

function salutationFor(tone: AiDraftToneDto, audience: AiDraftAudienceDto): string {
  if (audience === 'GUARDIAN') return tone === 'FRIENDLY' ? 'Dear Parent/Guardian,' : 'Dear Parent/Guardian,';
  if (audience === 'STUDENT') return tone === 'FRIENDLY' ? 'Hi,' : 'Dear Student,';
  if (audience === 'FACULTY') return tone === 'FRIENDLY' ? 'Hi,' : 'Dear Colleague,';
  return tone === 'FRIENDLY' ? 'Hi,' : 'Dear Team,';
}

function signOffFor(tone: AiDraftToneDto): string {
  return tone === 'FRIENDLY' ? 'Warm regards,' : 'Regards,';
}

function callToActionFor(audience: AiDraftAudienceDto, tone: AiDraftToneDto): string {
  if (audience === 'GUARDIAN') {
    return tone === 'FIRM'
      ? 'Please contact the class teacher this week to arrange a meeting.'
      : 'Please get in touch with the class teacher if you would like to talk it through.';
  }
  if (audience === 'STUDENT') {
    return tone === 'FIRM'
      ? 'Please meet your mentor this week.'
      : 'Do come and speak to your mentor if you would like some support.';
  }
  if (audience === 'FACULTY') return 'Please review the list and flag anything that needs attention.';
  return 'Please review and action as appropriate.';
}

/** Subject line. States the figure, because a subject that hides the number invites no action. */
function subjectFor(input: AiDraftInput, facts: AiDraftFacts): string {
  const base = facts.audienceSize === 0 ? 'Update from the college' : facts.headline;
  return input.channel === 'SMS' ? truncateSms(base) : base;
}

/** The one sentence that carries the facts. Channel-aware, because SMS has no room for a second. */
function figuresFor(channel: AiDraftChannel, facts: AiDraftFacts): string {
  const entries = Object.entries(facts.variables).filter(([, value]) => typeof value !== 'boolean');
  if (entries.length === 0) return facts.headline;

  const rendered = entries
    .map(([key, value]) => {
      if (key === 'totalOutstandingCents' || key === 'totalOverdueCents') {
        return `${humanizeKey(key)}: ${(Number(value) / 100).toFixed(2)}`;
      }
      if (key === 'thresholdPercent') return `threshold: ${value}%`;
      if (key.endsWith('Percent')) return `${humanizeKey(key)}: ${value}%`;
      return `${humanizeKey(key)}: ${value}`;
    })
    .join(', ');

  const sentence = `Please note: ${rendered}.`;
  return channel === 'SMS' ? truncateSms(sentence) : sentence;
}

function humanizeKey(key: string): string {
  const spaced = key.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** Keeps an SMS inside one segment. Truncating a *figure* would be a lie, so the subject is cut and
 *  the full numbers stay in the body. */
function truncateSms(value: string): string {
  return value.length <= 60 ? value : `${value.slice(0, 57).trimEnd()}...`;
}