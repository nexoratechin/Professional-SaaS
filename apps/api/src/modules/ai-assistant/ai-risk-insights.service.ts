/**
 * Student risk insights: which students in the caller's scope are drifting, and why.
 *
 * This is the one capability that is inherently a *judgement* rather than a count, so the design
 * problem is not "how do I query this" but "how do I make the judgement defensible". Three choices
 * follow from that:
 *
 *  1. **Every factor is a published rule with a stated weight.** The score is a fixed weighted sum
 *    of the factors below, with the weights as module constants rather than magic numbers at the
 *    call site, so "why is this student HIGH?" is answerable by reading this file.
 *  2. **Evidence travels with every flag.** A row never says only "at risk" — it carries the
 *    attendance rate, the outstanding amount, the failed subject count that produced each factor.
 *    A counsellor acting on a flag must never have to re-derive it.
 *  3. **Nothing here calls a model.** The weights are the decision. A provider may later narrate
 *    the summary, but it may not change a severity — an LLM that reassigns severity is an
 *    authorization and policy surface nobody audited.
 *
 * `totalCount` counts every flagged student in scope; `students` is the capped slice. Truncation is
 * reported rather than hidden, so a list of 50 never reads as "these 50 are the problem".
 */

import { Injectable } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES, type AuthenticatedUser } from '@college-erp/auth';
import type {
  AiRiskFactorDto,
  AiRiskInsightsDto,
  AiRiskSeverityDto,
  AiRiskStudentDto,
  AiTableColumnDto,
  AiTableRowDto,
} from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AiRiskInsightsQueryDto } from './dto/ai-assistant.dto';
import { AiQueriesService, type AiResolvedFilters } from './ai-queries.service';
import type { ResolvedAiScope } from './ai-scope';

/**
 * Published weights. Sum of all five is 100, so `riskScore` reads directly as a 0-100 percentage of
 * concern rather than an arbitrary scale.
 *
 * LOW_ATTENDANCE dominates because it is the earliest and most reliably recorded signal of disengagement
 * in this schema; FAILED_RESULTS next because it is the one that carries an actual consequence.
 */
export const AI_RISK_WEIGHTS = {
  LOW_ATTENDANCE: 35,
  FEE_DUES: 20,
  FAILED_RESULTS: 30,
  INCOMPLETE_RESULTS: 10,
  UNREGISTERED_PLACEMENT: 5,
} as const;

/** Score at/above which a student is HIGH. Below HIGH but above LOW is MEDIUM. */
export const AI_RISK_HIGH_SCORE = 50;
export const AI_RISK_MEDIUM_SCORE = 20;

/**
 * Outstanding balance at/above which FEE_DUES fires.
 *
 * An absolute rupee-ish figure rather than a percentage: "owes at all" is the real signal for a
 * student, and a ratio would let a large-but-currently-small balance look fine because the bill is
 * also small. Overdue money fires the factor regardless of amount, since an overdue line is past a
 * date the tenant itself set.
 */
export const AI_RISK_FEE_THRESHOLD_CENTS = 10_000;

/** Failed subjects at/above which FAILED_RESULTS fires on its own. */
export const AI_RISK_FAIL_THRESHOLD = 2;

/**
 * Placement statuses that mean "settled". A final-year student with no outcome row at all is
 * UNREGISTERED_PLACEMENT; one with NOT_PLACED/IN_PROCESS is *not* flagged, because the registry is
 * working on it and a student is not at risk for that.
 */
const SETTLED_PLACEMENT_STATUSES = new Set(['PLACED', 'NOT_APPLICABLE', 'OPTED_OUT', 'EXEMPT']);

@Injectable()
export class AiRiskInsightsService {
  constructor(
    private readonly prisma: TenantScopedPrismaService,
    private readonly queries: AiQueriesService,
    private readonly audit: AuditService,
  ) {}

  async insights(
    user: AuthenticatedUser,
    scope: ResolvedAiScope,
    filters: AiResolvedFilters,
    query: AiRiskInsightsQueryDto,
  ): Promise<AiRiskInsightsDto> {
    // The candidate list is the scope: it came out of `aiStudentWhere`, so every factor below is
    // about a student the caller is entitled to see, and no factor query can reach past it.
    const candidates = await this.queries.candidates(scope, filters, filters.to);
    const studentIds = candidates.map((student) => student.id);

    const [attendance, fees, results, placement] = await Promise.all([
      this.queries.perStudentAttendance(filters, studentIds),
      this.queries.perStudentFeeTotals(studentIds),
      this.queries.perStudentResultCounts(filters, studentIds),
      this.queries.perStudentPlacement(studentIds),
    ]);

    const threshold = filters.attendanceThresholdPercent ?? 75;
    const byId = new Map(candidates.map((student) => [student.id, student]));

    const scored: AiRiskStudentDto[] = studentIds.flatMap((studentId) => {
      const student = byId.get(studentId);
      if (!student) return [];
      const row = this.score(student, attendance.get(studentId), fees.get(studentId), results.get(studentId), placement.get(studentId), threshold);
      // An unflagged student is not "low risk", they are simply not a finding. Returning them would
      // bury the actual flags under the entire student body, so the default output is the flagged set.
      return row.factors.length > 0 ? [row] : [];
    });

    const ordered = scored.sort((left, right) => right.riskScore - left.riskScore);
    const filtered = query.severity ? ordered.filter((row) => row.severity === query.severity) : ordered;
    const capped = filtered.slice(0, filters.limit);

    const counts = { high: 0, medium: 0, low: 0, total: ordered.length };
    for (const row of ordered) {
      if (row.severity === 'HIGH') counts.high += 1;
      else if (row.severity === 'MEDIUM') counts.medium += 1;
      else counts.low += 1;
    }

    return {
      from: filters.from.toISOString(),
      to: filters.to.toISOString(),
      attendanceThresholdPercent: threshold,
      counts,
      students: capped,
      totalCount: filtered.length,
      truncated: filtered.length > capped.length,
    };
  }

  /**
   * Audits the *view*, separately from the query log.
   *
   * A risk list is the most sensitive thing this assistant can produce — it is a per-student
   * judgement about a named person — so it gets its own audit action rather than riding along on the
   * generic "query executed" entry, where it would be indistinguishable from "how many students are
   * in the CSE department".
   */
  async recordInsightsViewed(
    user: AuthenticatedUser,
    scope: ResolvedAiScope,
    result: AiRiskInsightsDto,
    severity: string | undefined,
  ): Promise<void> {
    await this.audit.record({
      scope: 'TENANT',
      tenantId: user.tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.AI_RISK_INSIGHTS_VIEWED,
      module: AUDIT_MODULES.AI,
      entityType: 'AiRiskInsights',
      // Counts and the scope only — never the students themselves. The audit trail records that a
      // counsellor looked, not a copy of the student list.
      after: {
        high: result.counts.high,
        medium: result.counts.medium,
        low: result.counts.low,
        total: result.counts.total,
        returned: result.students.length,
        severity,
        isGlobal: scope.snapshot.isGlobal,
        window: { from: result.from, to: result.to },
      },
    });
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Scores one student.
   *
   * Each factor contributes at most its full weight, so one problem cannot manufacture a HIGH
   * score on its own when attendance is fine — except the attendance factor itself, which is
   * allowed to carry a student to HIGH alone because chronic absence is a sufficient reason to
   * intervene on its own. That exception is stated here rather than emergent so it is reviewable.
   */
  private score(
    student: { id: string; admissionNumber: string; fullName: string; program: string | null; campus: string | null },
    attendance: { marked: number; present: number } | undefined,
    fees: { outstandingCents: number; overdueCents: number } | undefined,
    results: { pass: number; fail: number; incomplete: number } | undefined,
    placement: { outcomeStatus: string; finalPackageCents: number | null } | undefined,
    threshold: number,
  ): AiRiskStudentDto {
    const factors: AiRiskFactorDto[] = [];
    const evidence: Array<{ factor: AiRiskFactorDto; detail: string }> = [];
    let score = 0;

    const marked = attendance?.marked ?? 0;
    const present = attendance?.present ?? 0;
    const ratePercent = marked === 0 ? null : Math.round((present / marked) * 10_000) / 100;

    // A student with no attendance record in the window is NOT flagged for attendance. Absence of
    // evidence is not evidence of absence — and flagging every student in a term with no marking
    // done yet would make the whole feature noise.
    if (ratePercent !== null && ratePercent < threshold) {
      factors.push('LOW_ATTENDANCE');
      evidence.push({
        factor: 'LOW_ATTENDANCE',
        detail: `Attendance ${formatPercent(ratePercent)} over ${marked} marked sessions, below the ${formatPercent(threshold)} threshold.`,
      });
      // Scaled within the factor's own band: a student marginally under the threshold scores less
      // than one far under it, which is the difference between "monitor" and "intervene now".
      const severityWithinBand = clamp01((threshold - ratePercent) / Math.max(threshold, 1));
      score += Math.round(AI_RISK_WEIGHTS.LOW_ATTENDANCE * (0.5 + 0.5 * severityWithinBand));
    }

    const outstandingCents = fees?.outstandingCents ?? 0;
    const overdueCents = fees?.overdueCents ?? 0;
    if (overdueCents > 0 || outstandingCents >= AI_RISK_FEE_THRESHOLD_CENTS) {
      factors.push('FEE_DUES');
      evidence.push({
        factor: 'FEE_DUES',
        detail: `${formatMoney(outstandingCents)} outstanding${overdueCents > 0 ? `, of which ${formatMoney(overdueCents)} is past its due date` : ''}.`,
      });
      score += overdueCents > 0 ? AI_RISK_WEIGHTS.FEE_DUES : Math.round(AI_RISK_WEIGHTS.FEE_DUES * 0.6);
    }

    const failed = results?.fail ?? 0;
    if (failed >= AI_RISK_FAIL_THRESHOLD) {
      factors.push('FAILED_RESULTS');
      evidence.push({
        factor: 'FAILED_RESULTS',
        detail: `${failed} subject${failed === 1 ? '' : 's'} failed.`,
      });
      score += AI_RISK_WEIGHTS.FAILED_RESULTS;
    } else if (failed > 0) {
      factors.push('FAILED_RESULTS');
      evidence.push({ factor: 'FAILED_RESULTS', detail: `1 subject failed.` });
      score += Math.round(AI_RISK_WEIGHTS.FAILED_RESULTS * 0.5);
    }

    const incomplete = results?.incomplete ?? 0;
    if (incomplete > 0) {
      factors.push('INCOMPLETE_RESULTS');
      evidence.push({
        factor: 'INCOMPLETE_RESULTS',
        detail: `${incomplete} subject${incomplete === 1 ? '' : 's'} not yet marked.`,
      });
      score += AI_RISK_WEIGHTS.INCOMPLETE_RESULTS;
    }

    if (!placement) {
      factors.push('UNREGISTERED_PLACEMENT');
      evidence.push({ factor: 'UNREGISTERED_PLACEMENT', detail: 'No placement registry entry.' });
      score += AI_RISK_WEIGHTS.UNREGISTERED_PLACEMENT;
    } else if (!SETTLED_PLACEMENT_STATUSES.has(placement.outcomeStatus)) {
      // NOT_PLACED / IN_PROCESS etc. is an active placement process, not a disengagement signal, so
      // the factor is recorded but scores nothing. It is still shown, because "registered but not
      // placed yet" is exactly what a placement officer wants to see is accounted for.
      factors.push('UNREGISTERED_PLACEMENT');
      evidence.push({
        factor: 'UNREGISTERED_PLACEMENT',
        detail: `Placement registry status is ${placement.outcomeStatus}.`,
      });
    }

    const riskScore = clampScore(score);
    return {
      studentId: student.id,
      admissionNumber: student.admissionNumber,
      fullName: student.fullName,
      program: student.program,
      campus: student.campus,
      severity: severityOf(riskScore),
      riskScore,
      factors,
      evidence,
      attendanceRatePercent: ratePercent,
      outstandingCents,
      overdueCents,
      failedSubjects: failed,
      placementOutcomeStatus: placement?.outcomeStatus ?? null,
    };
  }
}

/** The risk table the UI renders, derived from the same DTO the detail view uses. */
export function aiRiskTable(): { title: string; columns: AiTableColumnDto[] } {
  return {
    title: 'Students flagged at risk',
    columns: [
      { key: 'fullName', label: 'Student' },
      { key: 'admissionNumber', label: 'Admission no.' },
      { key: 'program', label: 'Program' },
      { key: 'severity', label: 'Severity' },
      { key: 'riskScore', label: 'Score', format: 'number' },
      { key: 'factors', label: 'Factors' },
    ] satisfies AiTableColumnDto[],
  };
}

/** Flattens risk rows into the generic answer-table shape the chat UI already knows how to draw. */
export function aiRiskRows(students: AiRiskStudentDto[]): AiTableRowDto[] {
  return students.map((student) => ({
    fullName: student.fullName,
    admissionNumber: student.admissionNumber,
    program: student.program ?? '—',
    severity: student.severity,
    riskScore: student.riskScore,
    factors: student.factors.join(', '),
  }));
}

function severityOf(riskScore: number): AiRiskSeverityDto {
  if (riskScore >= AI_RISK_HIGH_SCORE) return 'HIGH';
  if (riskScore >= AI_RISK_MEDIUM_SCORE) return 'MEDIUM';
  return 'LOW';
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, Math.round(score)));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

/**
 * Money as a plain major-unit string with thousands separators.
 *
 * Deliberately not `currency`: the tenant's currency is tenant configuration and this service has no
 * business assuming one, so the cents figure is shown as a plain number rather than being labelled
 * with a currency the college may not use.
 */
function formatMoney(cents: number): string {
  return `${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}