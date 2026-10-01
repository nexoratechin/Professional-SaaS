import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const MAX_PAGE_SIZE = 100;
const MAX_QUESTION_LENGTH = 500;

/**
 * Parses a boolean from either a JSON body or a query string, keeping `undefined` as `undefined`.
 *
 * `@Type(() => Boolean)` is wrong for query strings — `Boolean('false')` is `true` — and coalescing
 * `undefined` to `false` would be wrong for the optional overrides below: an absent `overdueOnly`
 * must fall through to the router's extracted slot, so `dto.overdueOnly ?? slots.overdueOnly` sees
 * `undefined`, not a `false` that silently overrides it.
 */
function parseBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  const text = String(value).toLowerCase();
  return text === 'true' || text === '1';
}

/**
 * Query body for POST /ai-assistant/query.
 *
 * The question is the ONLY required field: everything else either refines a slot the router could
 * not extract ("last 30 days", "below 70%", the id of a specific department) or overrides the
 * router's guess. All of it is optional because a good answer to "how are we doing?" needs no
 * slots at all.
 *
 * `conversationId` is optional too: a caller with no thread yet gets one created for them, which
 * is what makes the UI a single-page chat rather than a create-then-ask dance.
 */
export class AskAiQuestionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUESTION_LENGTH)
  question!: string;

  @IsOptional()
  @IsUUID()
  conversationId?: string;

  /** Attendance threshold percent for LOW_ATTENDANCE_STUDENTS / STUDENT_RISK_INSIGHTS. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  attendanceThresholdPercent?: number;

  /** Only return OUTSTANDING_FEES lines already past their due date. */
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  overdueOnly?: boolean;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;

  /** Force a capability instead of letting the router infer it from the question. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  intent?: string;

  /** Row ceiling for the answer. Bounded server-side by AI_MAX_ROWS regardless of what is sent. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  /**
   * Ask a provider to phrase the answer in prose. Silently ignored (and reported in the response
   * as `DATA` rather than `DATA_WITH_NARRATION`) when no provider is configured — the scoped data
   * is returned either way, because a plan without a model should not lose the feature.
   */
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  narrate?: boolean;
}

export class CreateAiConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export class UpdateAiConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  isArchived?: boolean;
}

export class ListAiConversationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  take?: number;

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  includeArchived?: boolean;
}

export class RecordAiFeedbackDto {
  @IsIn(['up', 'down'])
  rating!: 'up' | 'down';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}

export class AiRiskInsightsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  attendanceThresholdPercent?: number;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  /** Restrict to one severity band. */
  @IsOptional()
  @IsIn(['HIGH', 'MEDIUM', 'LOW'])
  severity?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class GenerateAiDraftDto {
  /** What the communication is about; drives the router exactly like a free-text question would. */
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUESTION_LENGTH)
  question!: string;

  @IsOptional()
  @IsIn(['EMAIL', 'SMS', 'IN_APP'])
  channel?: string;

  @IsOptional()
  @IsIn(['FORMAL', 'FRIENDLY', 'FIRM'])
  tone?: string;

  @IsOptional()
  @IsIn(['GUARDIAN', 'STUDENT', 'FACULTY', 'STAFF'])
  audience?: string;

  /** Explicit instruction appended to the deterministic template, e.g. "mention the exam date". */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  extraInstructions?: string;

  /** File the resulting draft under an existing conversation instead of a new one. The draft must
   *  be stored somewhere so it can later be sent and audited; this only chooses where. */
  @IsOptional()
  @IsUUID()
  conversationId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

/**
 * Body for POST /ai-assistant/drafts/send.
 *
 * Deliberately has **no** `subject`/`body`/`channel` fields. The message content comes from the
 * stored draft (`messageId`, an `AiMessage` in one of the caller's own conversations), so sending
 * can only ever deliver something the assistant produced and stored — there is no body in the
 * request for a caller to smuggle past the draft's own audit trail, and the audit records the draft
 * that was actually delivered.
 */
export class SendAiDraftDto {
  /** The assistant message whose payload holds the draft. Must belong to a conversation the caller
   *  owns; ownership is the authorization, not a permission. */
  @IsUUID()
  messageId!: string;

  @IsUUID()
  recipientUserId!: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

export class GenerateAiReportDto {
  /** A reporting-engine REPORT_TYPES value. Explicit because a report request is precise by
   *  nature; the router only infers it when the caller does not. */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  reportType?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(MAX_QUESTION_LENGTH)
  question?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  /** Persist the result as a SavedReport so it can be scheduled/exported later. */
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  save?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  narrate?: boolean;
}

export class ListAiQueryLogsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  take?: number;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  intent?: string;

  @IsOptional()
  @IsIn(['DATA', 'DATA_WITH_NARRATION', 'GENERATED_TEXT', 'UNSUPPORTED', 'FORBIDDEN', 'FAILED'])
  outcome?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class QueueAiDocumentClassificationDto {
  @IsUUID()
  documentId!: string;

  @IsUUID()
  versionId!: string;

  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  includeOcr?: boolean;
}

export class ReviewAiDocumentClassificationDto {
  /** CONFIRM accepts the machine suggestion; CORRECT overrides it with the supplied values. */
  @IsIn(['CONFIRM', 'CORRECT', 'REJECT'])
  decision!: 'CONFIRM' | 'CORRECT' | 'REJECT';

  @IsOptional()
  @IsUUID()
  documentTypeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  category?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListAiDocumentClassificationsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  take?: number;

  @IsOptional()
  @IsIn([
    'PENDING',
    'CLASSIFIED',
    'NO_TEXT',
    'ERROR',
    'CONFIRMED',
    'CORRECTED',
    'FAILED',
  ])
  status?: string;

  /** Only rows a human has not touched yet — the review queue's default. */
  @IsOptional()
  @Transform(({ value }) => parseBoolean(value))
  @IsBoolean()
  unreviewedOnly?: boolean;
}