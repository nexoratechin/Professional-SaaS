/**
 * Response contracts for the AI ERP Assistant (`/ai-assistant/**`). Plain data only — no
 * class-validator / NestJS decorators — so apps/web compiles against the same shapes the API
 * produces and the two can never drift on a field name.
 *
 * The organizing idea across every payload here is that **an answer must be attributable**. Each
 * answer carries the intent it was resolved to, the filters actually applied to the scoped query,
 * and the RBAC scope snapshot it was computed under. That trio is what separates an assistant that
 * can be audited from one that merely sounds confident, and it is why the API stores it in
 * `AiQueryLog` rather than only returning it.
 */

/** Mirrors the Prisma AiIntent enum over the wire. */
export type AiIntentDto =
  | 'LOW_ATTENDANCE_STUDENTS'
  | 'OUTSTANDING_FEES'
  | 'ADMISSIONS_STATISTICS'
  | 'DEPARTMENT_PERFORMANCE'
  | 'EXAM_PERFORMANCE'
  | 'PLACEMENT_STATISTICS'
  | 'ANALYTICS_OVERVIEW'
  | 'REPORT_GENERATION'
  | 'COMMUNICATION_DRAFT'
  | 'STUDENT_RISK_INSIGHTS';

/**
 * Where an answer's substance came from.
 *
 * The distinction is load-bearing: `DATA` means the answer was scoped SQL plus deterministic
 * formatting and **no model was consulted**, while `DATA_WITH_NARRATION` means a model phrased
 * numbers that were already fetched under the caller's grants. A model is never the source of a
 * figure — only of its presentation.
 */
export type AiResponseKindDto =
  | 'DATA'
  | 'DATA_WITH_NARRATION'
  | 'GENERATED_TEXT'
  | 'UNSUPPORTED'
  | 'FORBIDDEN'
  | 'FAILED';

/** Mirrors the Prisma AiDocumentClassificationStatus enum over the wire. */
export type AiDocumentClassificationStatusDto =
  | 'PENDING'
  | 'CLASSIFIED'
  | 'NO_TEXT'
  | 'ERROR'
  | 'CONFIRMED'
  | 'CORRECTED'
  | 'FAILED';

/**
 * The intersected RBAC grants an answer was computed under, frozen at query time.
 *
 * Stored (rather than recomputed on read) so an answer stays explainable after a role changes:
 * the question "what was this user allowed to see when the assistant told them X?" has an answer
 * even a quarter later.
 */
export interface AiScopeSnapshotDto {
  /** The `ai.view` grants the caller's roles produced. */
  entryGrants: AnalyticsScopeGrantDto[];
  /** The grants of whichever source domain the detected intent reads from. */
  sourceGrants: AnalyticsScopeGrantDto[];
  /** `intersect(entry, source)` — the only grants the query actually used. */
  effectiveGrants: AnalyticsScopeGrantDto[];
  isGlobal: boolean;
}

export interface AnalyticsScopeGrantDto {
  scopeType: 'GLOBAL' | 'CAMPUS' | 'DEPARTMENT' | 'PROGRAM' | 'OWN';
  campusId?: string;
  departmentId?: string;
  programId?: string;
}

/** One column of a rendered answer table. */
export interface AiTableColumnDto {
  key: string;
  label: string;
  format?: string;
}

/** One row of a rendered answer table — deliberately string/number/bool/null only so the UI can
 *  render it without knowing anything about the source Prisma model. */
export type AiTableRowDto = Record<string, string | number | boolean | null>;

/** A table an assistant answer carries (e.g. "students below 75% attendance"). */
export interface AiTableDto {
  title: string;
  columns: AiTableColumnDto[];
  rows: AiTableRowDto[];
  /** Rows matching the scoped query in total; `rows.length` may be smaller (AI_MAX_ROWS / preview
   *  limit) and `truncated` says so rather than letting a capped list read as the full answer. */
  totalCount: number;
  truncated: boolean;
}

/** Named scalar metrics an answer carries (e.g. attendance rate, outstanding cents). */
export interface AiMetricDto {
  key: string;
  label: string;
  value: number | string | null;
  unit?: 'COUNT' | 'PERCENT' | 'CURRENCY_CENTS' | 'TEXT';
  /** Short provenance line — "12 students across 2 departments", "as of now". */
  hint?: string;
}

/** The structured body of one assistant answer. */
export interface AiAnswerPayloadDto {
  /** What the router resolved the question to; null when nothing matched. */
  intent: AiIntentDto | null;
  /** One-line statement of what the answer actually is, in plain language. */
  summary: string;
  metrics: AiMetricDto[];
  tables: AiTableDto[];
  /**
   * Set when the answer is a risk-insights payload rather than a query result. Kept as its own
   * field (instead of being flattened into metrics) because a risk row is a *composite* judgement
   * over several dimensions and collapsing it into numbers loses which factors fired.
   */
  risks?: AiRiskInsightsDto;
  /** Set when the answer is a drafted communication. */
  draft?: AiDraftDto;
  /** Set when the answer is a generated report (columns + rows reuse the reporting engine). */
  report?: AiGeneratedReportDto;
  /** Free-form explanation of what the assistant could NOT do, when applicable. */
  caveats: string[];
}

/** POST /ai-assistant/query — one turn. */
export interface AiQueryResponseDto {
  conversationId: string;
  messageId: string;
  /** The stored question, echoed verbatim. */
  question: string;
  /** The stored answer text (narrated or deterministic). */
  answer: string;
  payload: AiAnswerPayloadDto;
  intent: AiIntentDto | null;
  responseKind: AiResponseKindDto;
  /** The filtered window/scope actually queried — never the raw question. */
  filters: Record<string, unknown> | null;
  scope: AiScopeSnapshotDto;
  /** Provider that produced the text, or null when the answer was deterministic. */
  provider: string | null;
  model: string | null;
  latencyMs: number;
  createdAt: string;
}

/** One row of a conversation thread. */
export interface AiMessageDto {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  intent: AiIntentDto | null;
  content: string;
  payload: AiAnswerPayloadDto | null;
  responseKind: AiResponseKindDto;
  provider: string | null;
  model: string | null;
  latencyMs: number | null;
  feedback: AiFeedbackDto | null;
  createdAt: string;
}

export interface AiFeedbackDto {
  id: string;
  messageId: string;
  rating: 'up' | 'down';
  comment: string | null;
  createdAt: string;
}

export interface AiConversationDto {
  id: string;
  title: string;
  isArchived: boolean;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiConversationDetailDto extends AiConversationDto {
  messages: AiMessageDto[];
}

/** GET /ai-assistant/query-logs — the compliance view. */
export interface AiQueryLogDto {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  userId: string;
  userEmail: string | null;
  question: string;
  intent: AiIntentDto | null;
  outcome: AiResponseKindDto;
  /** Which source permission backed the answer (e.g. 'fees.view'). */
  sourcePermission: string | null;
  rowCount: number;
  errorMessage: string | null;
  latencyMs: number | null;
  scope: AiScopeSnapshotDto | null;
  filters: Record<string, unknown> | null;
  createdAt: string;
}

export interface AiQueryLogListDto {
  data: AiQueryLogDto[];
  total: number;
  skip: number;
  take: number;
}

/** GET /ai-assistant/capabilities — what this deployment and this caller can do. */
export interface AiCapabilitiesDto {
  /** False when AI_ENABLED is off; every write endpoint then refuses regardless of RBAC. */
  enabled: boolean;
  /** 'none' means no provider configured: data answers still work, narration/drafting/OCR do not. */
  provider: string;
  model: string;
  /** Ceiling applied to answer tables on top of the reporting engine's own limits. */
  maxRows: number;
  /** Intents the caller's grants actually cover, with the source permission each needs. */
  availableIntents: Array<{ intent: AiIntentDto; label: string; sourcePermission: string }>;
  /** Capabilities the caller holds but the current provider cannot serve. */
  providerLimitedCapabilities: string[];
  ocrConfigured: boolean;
  autoAcceptConfidence: number;
}

// ---------------------------------------------------------------------------
// Student risk insights
// ---------------------------------------------------------------------------

export type AiRiskFactorDto = 'LOW_ATTENDANCE' | 'FEE_DUES' | 'FAILED_RESULTS' | 'INCOMPLETE_RESULTS' | 'UNREGISTERED_PLACEMENT';

export type AiRiskSeverityDto = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AiRiskStudentDto {
  studentId: string;
  admissionNumber: string;
  fullName: string;
  program: string | null;
  campus: string | null;
  severity: AiRiskSeverityDto;
  /** 0..100. Weighted from the factors below; see AiRiskInsightsService for the weights. */
  riskScore: number;
  factors: AiRiskFactorDto[];
  /** The per-factor evidence, so a counsellor can see WHY a student was flagged. */
  evidence: Array<{ factor: AiRiskFactorDto; detail: string }>;
  attendanceRatePercent: number | null;
  outstandingCents: number;
  overdueCents: number;
  failedSubjects: number;
  placementOutcomeStatus: string | null;
}

export interface AiRiskInsightsDto {
  /** The window the risk factors were computed over. */
  from: string;
  to: string;
  /** Threshold used for the attendance factor, echoed so the number is interpretable. */
  attendanceThresholdPercent: number;
  counts: { high: number; medium: number; low: number; total: number };
  students: AiRiskStudentDto[];
  totalCount: number;
  truncated: boolean;
}

// ---------------------------------------------------------------------------
// Communication drafting
// ---------------------------------------------------------------------------

export type AiDraftToneDto = 'FORMAL' | 'FRIENDLY' | 'FIRM';

export type AiDraftAudienceDto = 'GUARDIAN' | 'STUDENT' | 'FACULTY' | 'STAFF';

export interface AiDraftDto {
  channel: 'EMAIL' | 'SMS' | 'IN_APP';
  tone: AiDraftToneDto;
  audience: AiDraftAudienceDto;
  subject: string;
  /** The message body. Always produced, even with no provider configured — a deterministic
   *  template over the scoped facts is more useful than an error. */
  body: string;
  /** Facts the body was generated from, echoed for transparency (no PII beyond the scoped rows). */
  variables: Record<string, string | number | boolean>;
  /** True when a provider phrased it; false when it is the deterministic template. */
  narrated: boolean;
  provider: string | null;
  model: string | null;
  /** How many rows the underlying scoped query matched (the audience size). */
  audienceSize: number;
}

/**
 * POST /ai-assistant/drafts — a standalone draft, outside any conversation.
 *
 * Carries the same attribution trio as `AiQueryResponseDto` (`filters` + `scope` + the aggregates)
 * because a drafted message is a claim about the college: "12 students have attendance below 75%"
 * must be checkable against the query that produced it before anyone sends it to a parent.
 *
 * It also carries `conversationId`/`messageId` because a draft that could not be sent would be half
 * a feature: the message it points at is where the body is stored, and `POST /drafts/send` reads the
 * body from there rather than from the request. So "generate" and "send" are two audited steps over
 * one stored artefact, not one endpoint that both composes and broadcasts.
 */
export interface AiDraftResponseDto {
  draft: AiDraftDto;
  /** The stored assistant message holding this draft — the `messageId` to send. */
  messageId: string;
  /** The (possibly newly created) conversation the draft was filed under. */
  conversationId: string;
  /** The aggregates the body states, so no sentence is unattributable. */
  metrics: AiMetricDto[];
  /** The rows those aggregates came from. Null when the audience is not named (guardian audiences
   *  deliberately omit student names, since a draft is the artefact most likely to be mass-sent). */
  table: AiTableDto | null;
  filters: Record<string, unknown>;
  scope: AiScopeSnapshotDto;
}

/** POST /ai-assistant/drafts/send — the send itself, never the draft generation. */
export interface AiDraftSendResultDto {
  notificationId: string;
  /** True when the notification was scheduled rather than delivered immediately. */
  scheduled: boolean;
}

// ---------------------------------------------------------------------------
// Report generation
// ---------------------------------------------------------------------------

export interface AiGeneratedReportDto {
  /** A reporting-engine REPORT_TYPES value — AI report generation reuses the engine, it does not
   *  have a second, weaker query path. */
  reportType: string;
  title: string;
  description: string;
  columns: AiTableColumnDto[];
  rows: AiTableRowDto[];
  summary: Record<string, number>;
  rowCount: number;
  totalCount: number;
  truncated: boolean;
  generatedAt: string;
  /** Populated when the caller asked to persist it as a SavedReport. */
  savedReportId: string | null;
}

// ---------------------------------------------------------------------------
// Document classification / OCR
// ---------------------------------------------------------------------------

export interface AiDocumentClassificationDto {
  id: string;
  documentId: string;
  documentTitle: string;
  documentVersionId: string;
  originalFilename: string;
  mimeType: string | null;
  status: AiDocumentClassificationStatusDto;
  suggestedCategory: string | null;
  suggestedDocumentTypeId: string | null;
  confidence: number | null;
  /** Present only when the caller also holds `documents.read` on the owning document — extraction
   *  can carry PII a documents-read grant would not otherwise be needed for. */
  extractedText: string | null;
  extractedFields: Record<string, unknown> | null;
  confirmedCategory: string | null;
  confirmedDocumentTypeId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  provider: string | null;
  model: string | null;
  errorMessage: string | null;
  processedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiDocumentClassificationListDto {
  data: AiDocumentClassificationDto[];
  total: number;
  skip: number;
  take: number;
}