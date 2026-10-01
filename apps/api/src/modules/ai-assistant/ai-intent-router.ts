/**
 * Maps a natural-language question onto one of the closed `AiIntent` values, and pulls the slots
 * (date window, percentage threshold, org-unit names) out of the same string.
 *
 * Why a deterministic router rather than asking a model to pick a tool: every intent maps to a
 * *specific source permission and a specific scoped query*, and the router is the component that
 * decides which of those two things applies. If the model made that choice, "which grants did this
 * answer use?" would have no answer you could reconstruct, and the classic failure mode — a model
 * picking a broader tool than the user's role warrants — would be invisible. Here the intent is a
 * pure function of the text, so the audit log can state exactly why a number was produced.
 *
 * The trade-off is honest and worth stating: a phrasing nobody anticipated is UNSUPPORTED rather
 * than approximately matched. That is why `AI_QUERY_UNSUPPORTED` is audited — unanswered phrasings
 * are the list of capabilities still to be built, and swallowing them would hide that.
 */

import { BadRequestException } from '@nestjs/common';
import type { AiIntentDto } from '@college-erp/types';
import { PERMISSION_KEYS } from '@college-erp/auth';

/** Every intent the router can emit, with the permission whose scope governs its query. */
export interface AiIntentDefinition {
  intent: AiIntentDto;
  label: string;
  /** The source-domain permission this intent reads data under. Intersected with `ai.view`. */
  sourcePermission: string;
  /**
   * Whether `reports.view` is ALSO required. Report generation goes through the reporting engine,
   * so a caller who cannot run a report directly must not be able to make the assistant run one.
   */
  requiresReportsView?: boolean;
  /** Patterns that select this intent. First match wins, so order is significant. */
  patterns: RegExp[];
  /** Suggested answer when nothing matched. */
  example: string;
}

export const AI_INTENTS: readonly AiIntentDefinition[] = [
  {
    intent: 'STUDENT_RISK_INSIGHTS',
    label: 'At-risk students',
    sourcePermission: PERMISSION_KEYS.STUDENTS_VIEW,
    patterns: [
      /\bat[- ]?risk\b/i,
      /\brisk(ing|y)?\b/i,
      /\bstruggling\b/i,
      /\bdrop[- ]?out\b/i,
      /\bneed(s|ing)?\s+(help|attention|support)\b/i,
      /\bprobation\b/i,
    ],
    example: 'Which students are at risk of dropping out?',
  },
  {
    intent: 'LOW_ATTENDANCE_STUDENTS',
    label: 'Students with low attendance',
    sourcePermission: PERMISSION_KEYS.ATTENDANCE_VIEW,
    patterns: [
      /\blow\s+attendance\b/i,
      /\battendance\b.*\b(low|below|under|less|poor|deficien|shortage|default)/i,
      /\b(low|below|under|less)\b.*\b\d{1,3}\s*%\b/i,
      /\bbunk(ing|ed)?\b/i,
      /\bshort(age)?\s+of\s+attendance\b/i,
    ],
    example: 'Show students with attendance below 75%',
  },
  {
    intent: 'OUTSTANDING_FEES',
    label: 'Outstanding fees',
    sourcePermission: PERMISSION_KEYS.FEES_VIEW,
    patterns: [
      /\boutstanding\b/i,
      /\bunpaid\b/i,
      /\bpending\s+(fees?|dues?|amount|payment)/i,
      /\bfees?\s+(dues?|owing|owed|pending|default)/i,
      /\bdefault(ers|ing)?\b/i,
      /\bdues\b/i,
      /\bcollection\s+(rate|status)/i,
    ],
    example: 'Who has outstanding fees?',
  },
  {
    intent: 'ADMISSIONS_STATISTICS',
    label: 'Admission statistics',
    sourcePermission: PERMISSION_KEYS.ADMISSIONS_VIEW,
    patterns: [
      /\badmission(s)?\b/i,
      /\bapplic(ant|ation|ations)\b/i,
      /\benquir(y|ies)\b/i,
      /\bfunnel\b/i,
      /\bconversion\s+rate\b/i,
    ],
    example: 'How many applications did we get this year?',
  },
  {
    intent: 'EXAM_PERFORMANCE',
    label: 'Exam performance',
    sourcePermission: PERMISSION_KEYS.RESULTS_VIEW,
    patterns: [
      /\bexam(s|ination)?\s+(performance|results?|scores?|performance)\b/i,
      /\b(results?|scores?|marks?|performance)\b.*\bexam/i,
      /\bpass\s+(rate|percentage|percent)\b/i,
      /\bfail(ing|ed|ure)?\b/i,
      /\btop\s+pers?formers?\b/i,
      /\bsubject[- ]wise\b/i,
    ],
    example: 'Which subjects have the highest failure rate?',
  },
  {
    intent: 'PLACEMENT_STATISTICS',
    label: 'Placement statistics',
    sourcePermission: PERMISSION_KEYS.PLACEMENTS_VIEW,
    patterns: [
      /\bplacement(s)?\b/i,
      /\bplaced?\b/i,
      /\bpackage(s)?\b/i,
      /\bhighest\s+ctc\b/i,
      /\bcompany\b.*\bhired\b/i,
      /\brecruit(er|ment|ing)\b/i,
    ],
    example: 'What is the placement rate and average package this year?',
  },
  {
    intent: 'DEPARTMENT_PERFORMANCE',
    label: 'Department performance',
    // Department comparison mixes student, attendance, results and fee data, so it needs the same
    // "at least one data permission" contract analytics has (see AI_ANALYTICS_SOURCE_PERMISSIONS).
    sourcePermission: PERMISSION_KEYS.ANALYTICS_VIEW,
    patterns: [
      /\bdepartment(s)?\b/i,
      /\bcompare\b.*\b(department|program|campus)/i,
      /\b(best|worst|top|weakest|strongest)\b.*\b(department|program)/i,
      /\bperformance\b/,
    ],
    example: 'Compare department performance',
  },
  {
    intent: 'REPORT_GENERATION',
    label: 'Generate a report',
    sourcePermission: PERMISSION_KEYS.REPORTS_VIEW,
    requiresReportsView: true,
    patterns: [
      /\bgenerate\s+(a\s+)?report\b/i,
      /\b(prepare|create|build|make|produce|give me|export)\b.*\breport\b/i,
      /\breport\s+(on|for|of)\b/i,
      /\bdownload\s+(the\s+)?(report|data|list)\b/i,
    ],
    example: 'Generate an attendance report for the last 30 days',
  },
  {
    intent: 'COMMUNICATION_DRAFT',
    label: 'Draft a communication',
    sourcePermission: PERMISSION_KEYS.STUDENTS_VIEW,
    patterns: [
      /\b(draft|write|compose|prepare)\b.*\b(email|sms|message|notice|letter|note|communication|announcement)/i,
      /\b(email|sms|message|notice|letter|announcement)\b.*\b(to|for)\b/i,
      /\bnotify\b/i,
      /\binform\b.*\b(guardians?|parents?|students?|staff|faculty)\b/i,
      /\bremind(er)?\b/i,
    ],
    example: 'Draft an email to guardians of students with low attendance',
  },
  {
    intent: 'ANALYTICS_OVERVIEW',
    label: 'College overview',
    sourcePermission: PERMISSION_KEYS.ANALYTICS_VIEW,
    patterns: [
      /\b(overview|summary|snapshot|dashboard|how are we doing|college|overall|institution)\b/i,
      /\bkey\s+(numbers|figures|metrics)\b/i,
      /\bhead\s?count\b/i,
    ],
    example: 'Give me an overview of the college',
  },
] as const;

/** Analytics-style reads that may back DEPARTMENT_PERFORMANCE / ANALYTICS_OVERVIEW. */
export const AI_ANALYTICS_SOURCE_PERMISSIONS = [
  PERMISSION_KEYS.STUDENTS_VIEW,
  PERMISSION_KEYS.ADMISSIONS_VIEW,
  PERMISSION_KEYS.ATTENDANCE_VIEW,
  PERMISSION_KEYS.FEES_VIEW,
  PERMISSION_KEYS.EXAMS_VIEW,
  PERMISSION_KEYS.RESULTS_VIEW,
  PERMISSION_KEYS.HR_VIEW,
  PERMISSION_KEYS.PLACEMENTS_VIEW,
] as const;

export const AI_INTENTS_BY_NAME: Record<string, AiIntentDefinition> = Object.fromEntries(
  AI_INTENTS.map((definition) => [definition.intent, definition]),
);

export function isAiIntent(value: unknown): value is AiIntentDto {
  return typeof value === 'string' && value in AI_INTENTS_BY_NAME;
}

/** Slots the router pulls out of the question. All optional; a good question supplies none. */
export interface AiResolvedSlots {
  /** Trailing-day window (e.g. "last 30 days", "in the past 6 months" → days). */
  dateFrom?: Date;
  dateTo?: Date;
  /** Threshold percent for attendance-based intents. */
  attendanceThresholdPercent?: number;
  /** "overdue"/"past due" mentioned → restrict fee lines to OVERDUE. */
  overdueOnly?: boolean;
  /** Free-text org-unit names, resolved to ids by the caller against the caller's scope. */
  campusNames: string[];
  departmentNames: string[];
  programNames: string[];
}

export interface AiRouteResult {
  intent: AiIntentDto | null;
  definition: AiIntentDefinition | null;
  slots: AiResolvedSlots;
  /** Every pattern that fired, for the audit trail — "why did it think this was about fees?". */
  matchedPatterns: string[];
}

/** Attendance below this is "low" when the question states no threshold. Matches the tenant
 *  configuration's own default (TenantConfigAttendance.thresholdPercent). */
export const DEFAULT_ATTENDANCE_THRESHOLD_PERCENT = 75;

/** Windows the router understands. A question that names no window gets this one. */
export const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 730;

export function routeAiQuestion(question: string, now: Date = new Date()): AiRouteResult {
  const text = question.trim();
  const slots = extractSlots(text, now);
  const matched: Array<{ definition: AiIntentDefinition; pattern: string }> = [];

  for (const definition of AI_INTENTS) {
    for (const pattern of definition.patterns) {
      if (pattern.test(text)) {
        matched.push({ definition, pattern: pattern.source });
        break;
      }
    }
  }

  // Two intents can both fire on a single sentence ("students with low attendance and unpaid
  // fees"). The router resolves that by specificity rather than by asking the user to choose:
  // REPORT_GENERATION and COMMUNICATION_DRAFT are *actions* on data and are checked first because
  // "generate a report of students with low attendance" wants a report, not a roster. Among data
  // intents, the earlier entry in AI_INTENTS is the more specific one (a question that mentions
  // attendance AND fees is treated as attendance, which is the claim being made about the student).
  const ordered = [...matched].sort((left, right) => priorityOf(left.definition) - priorityOf(right.definition));
  const winner = ordered[0];

  return {
    intent: winner?.definition.intent ?? null,
    definition: winner?.definition ?? null,
    slots,
    matchedPatterns: matched.map((entry) => `${entry.definition.intent}:${entry.pattern}`),
  };
}

/** Lower runs first. Actions beat data; specific data beats aggregate "performance"/"overview". */
function priorityOf(definition: AiIntentDefinition): number {
  if (definition.intent === 'REPORT_GENERATION') return 0;
  if (definition.intent === 'COMMUNICATION_DRAFT') return 1;
  if (definition.intent === 'STUDENT_RISK_INSIGHTS') return 2;
  if (definition.intent === 'LOW_ATTENDANCE_STUDENTS') return 3;
  if (definition.intent === 'OUTSTANDING_FEES') return 4;
  if (definition.intent === 'EXAM_PERFORMANCE') return 5;
  if (definition.intent === 'PLACEMENT_STATISTICS') return 6;
  if (definition.intent === 'ADMISSIONS_STATISTICS') return 7;
  if (definition.intent === 'DEPARTMENT_PERFORMANCE') return 8;
  return 9;
}

const MONTH_NAMES = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * Pulls slots out of the question.
 *
 * Deliberately conservative: each pattern must be unambiguous ("last 30 days", "below 75%"), and a
 * phrase that only *might* be a date is left alone. A router that guesses wrong about a window is
 * worse than one that defaults, because the user cannot tell a guessed window from a stated one —
 * so whatever is applied is echoed back in the answer's `filters`.
 */
export function extractSlots(question: string, now: Date = new Date()): AiResolvedSlots {
  const text = question.toLowerCase();
  const slots: AiResolvedSlots = { campusNames: [], departmentNames: [], programNames: [] };

  const to = now;
  let from: Date | undefined;
  let matchedWindow = false;

  // "last 30 days" / "past 12 weeks" / "in the last 6 months" / "this year" / "last month"
  const trailing = /\b(?:last|past|previous)\s+(\d{1,4})\s+(day|days|week|weeks|month|months|term|terms)\b/.exec(text);
  if (trailing) {
    const amount = Number.parseInt(trailing[1] ?? '', 10);
    const unit = trailing[2] ?? 'days';
    if (Number.isFinite(amount) && amount > 0) {
      const days = unit.startsWith('week')
        ? amount * 7
        : unit.startsWith('month')
          ? amount * 30
          : unit.startsWith('term')
            ? amount * 120
            : amount;
      from = new Date(to.getTime() - Math.min(days, MAX_WINDOW_DAYS) * 86_400_000);
      matchedWindow = true;
    }
  }
  if (!matchedWindow && /\bthis\s+(academic\s+)?year\b/.test(text)) {
    from = new Date(Date.UTC(to.getUTCFullYear(), 0, 1));
    matchedWindow = true;
  }
  if (!matchedWindow && /\b(last|past|previous)\s+month\b/.test(text)) {
    const start = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, 1));
    from = start;
    matchedWindow = true;
  }
  if (!matchedWindow && /\btoday\b|\bthis\s+week\b/.test(text)) {
    from = new Date(to.getTime() - 7 * 86_400_000);
    matchedWindow = true;
  }
  if (!matchedWindow && /\bthis\s+month\b/.test(text)) {
    from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
    matchedWindow = true;
  }

  // "in january" / "in march 2025"
  if (!matchedWindow) {
    for (const [index, name] of MONTH_NAMES.entries()) {
      if (new RegExp(`\\bin\\s+${name}\\b`).test(text)) {
        const yearMatch = /\b(20\d{2})\b/.exec(text);
        const year = yearMatch?.[1] ? Number.parseInt(yearMatch[1], 10) : to.getUTCFullYear();
        from = new Date(Date.UTC(year, index, 1));
        to.setUTCMonth(index + 1, 1);
        matchedWindow = true;
        break;
      }
    }
  }

  slots.dateFrom = from;
  slots.dateTo = to;

  // "below 75%" / "under 70 percent" / "less than 60% attendance" / "attendance below 80"
  const percent = /\b(?:below|under|less\s+than|lesser\s+than|poor(?:er)?\s+than|maximum\s+of|max\s+of|upto|up\s+to)\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|per\s*cent)?\b/.exec(text);
  if (percent) {
    const value = Number.parseFloat(percent[1] ?? '');
    if (Number.isFinite(value) && value >= 0 && value <= 100) {
      slots.attendanceThresholdPercent = value;
    }
  }

  if (/\boverdue\b|\bpast\s+due\b|\bdefaulted\b|\bdelinquent\b/.test(text)) {
    slots.overdueOnly = true;
  }

  // Quoted or "X dept/department/program/campus" org-unit names. Ids (uuids) are preferred when
  // present and are matched by the caller's scope lookup, so the string form is just a fallback.
  const uuid = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
  for (const match of question.matchAll(uuid)) {
    // Uuid slots are resolved by the scope layer, which knows the caller's grants; recorded here
    // so the router's decision is reproducible from the audit log alone.
    if (!slots.programNames.includes(match[0])) slots.programNames.push(match[0]);
  }

  slots.campusNames = namesAfterKeyword(question, /\bcampus\b/i);
  slots.departmentNames = namesAfterKeyword(question, /\bdepartment\b/i);
  slots.programNames = [
    ...new Set([...slots.programNames, ...namesAfterKeyword(question, /\bprogram(me)?\b/i)]),
  ].slice(0, 20);

  return slots;
}

/**
 * Words immediately following "campus"/"department"/"programme" in the question, up to the next
 * clause boundary. Best-effort by nature — this is a hint that the scope layer confirms against the
 * tenant's own master data, and an unmatched name is dropped rather than guessed at.
 */
function namesAfterKeyword(question: string, keyword: RegExp): string[] {
  const found: string[] = [];
  const pattern = new RegExp(`${keyword.source}\\s+(?:named\\s+|called\\s+|for\\s+|of\\s+)?([A-Za-z0-9&'.-]+(?:\\s+[A-Za-z0-9&'.-]+){0,3})`, 'gi');
  for (const match of question.matchAll(pattern)) {
    const candidate = (match[1] ?? '').trim().replace(/[,.]$/, '');
    if (candidate && !/^(many|wise|overall|performance|statistics|stats|numbers?|level)$/i.test(candidate)) {
      found.push(candidate);
    }
  }
  return found.slice(0, 20);
}

/** Applies an explicit `intent` from the request body, validating it against the closed enum. */
export function assertKnownAiIntent(value: string): AiIntentDefinition {
  const definition = AI_INTENTS_BY_NAME[value];
  if (!definition) {
    throw new BadRequestException(
      `Unknown AI capability: ${value}. Supported: ${Object.keys(AI_INTENTS_BY_NAME).join(', ')}.`,
    );
  }
  return definition;
}