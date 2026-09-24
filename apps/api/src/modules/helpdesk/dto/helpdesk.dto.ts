/**
 * Helpdesk / Feedback DTOs. Follows the inventory/library convention: class-validator + Swagger,
 * stringly-typed enum values validated with IsIn against exported constants that mirror the
 * Prisma enums over the wire.
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// ── Closed taxonomies (mirrors of the Prisma enums) ─────────────────────────

export const HELPDESK_TICKET_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED'] as const;
export const HELPDESK_TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'] as const;
export const HELPDESK_TICKET_SOURCES = ['WEB', 'EMAIL', 'PHONE', 'WALK_IN', 'API', 'OTHER'] as const;
export const HELPDESK_COMMENT_VISIBILITIES = ['PUBLIC', 'INTERNAL'] as const;
export const HELPDESK_ESCALATION_REASONS = ['RESPONSE_BREACH', 'RESOLUTION_BREACH', 'MANUAL'] as const;

/** Statuses from which a ticket is still considered "open" for SLA/dashboard purposes. */
export const HELPDESK_OPEN_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'REOPENED'] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class HelpdeskPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;

  @IsOptional()
  @IsString()
  search?: string;
}

export class HelpdeskReportQueryDto {
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}

// ── Departments ─────────────────────────────────────────────────────────────

export class CreateHelpdeskDepartmentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHelpdeskDepartmentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Categories ──────────────────────────────────────────────────────────────

export class CreateHelpdeskCategoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_PRIORITIES)
  defaultPriority?: string;

  @IsOptional()
  @IsUUID()
  defaultDepartmentId?: string;

  @IsOptional()
  @IsUUID()
  slaPolicyId?: string;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sequenceOrder?: number;
}

export class UpdateHelpdeskCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  parentId?: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_PRIORITIES)
  defaultPriority?: string;

  @IsOptional()
  @IsUUID()
  defaultDepartmentId?: string;

  @IsOptional()
  @IsUUID()
  slaPolicyId?: string;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sequenceOrder?: number;
}

// ── SLA policies ────────────────────────────────────────────────────────────

export class CreateHelpdeskSlaPolicyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  code!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  responseMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  resolutionMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  atRiskMinutes?: number;

  @IsOptional()
  @IsString()
  escalateToRoleCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  escalateAfterMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateHelpdeskSlaPolicyDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  responseMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  resolutionMinutes?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  atRiskMinutes?: number;

  @IsOptional()
  @IsString()
  escalateToRoleCode?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  escalateAfterMinutes?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Tickets ─────────────────────────────────────────────────────────────────

export class CreateHelpdeskTicketDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  subject!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;

  @IsUUID()
  categoryId!: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_SOURCES)
  source?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @IsOptional()
  @IsUUID()
  requesterUserId?: string;

  @IsOptional()
  @IsString()
  requesterName?: string;

  @IsOptional()
  @IsString()
  requesterEmail?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  @ArrayMaxSize(20)
  attachmentDocumentIds?: string[];
}

export class UpdateHelpdeskTicketDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(240)
  subject?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_SOURCES)
  source?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @IsOptional()
  @IsString()
  requesterName?: string;

  @IsOptional()
  @IsString()
  requesterEmail?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(20)
  tags?: string[];
}

export class ListHelpdeskTicketsDto extends HelpdeskPaginationDto {
  @IsOptional()
  @IsIn(HELPDESK_TICKET_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(HELPDESK_TICKET_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @IsOptional()
  @IsUUID()
  requesterUserId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unassigned?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  breached?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mine?: boolean;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class AssignHelpdeskTicketDto {
  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ChangeHelpdeskTicketStatusDto {
  @IsIn(HELPDESK_TICKET_STATUSES)
  status!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsString()
  resolutionSummary?: string;
}

export class ResolveHelpdeskTicketDto {
  @IsString()
  @IsNotEmpty()
  resolutionSummary!: string;

  @IsOptional()
  @IsString()
  note?: string;
}

export class ReopenHelpdeskTicketDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class EscalateHelpdeskTicketDto {
  @IsOptional()
  @IsUUID()
  toUserId?: string;

  @IsOptional()
  @IsString()
  toRoleCode?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

// ── Comments / attachments / feedback ───────────────────────────────────────

export class AddHelpdeskCommentDto {
  @IsString()
  @IsNotEmpty()
  body!: string;

  @IsOptional()
  @IsIn(HELPDESK_COMMENT_VISIBILITIES)
  visibility?: string;

  @IsOptional()
  @IsBoolean()
  isResolutionNote?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  @ArrayMaxSize(20)
  attachmentDocumentIds?: string[];
}

export class AddHelpdeskAttachmentDto {
  @IsUUID()
  documentId!: string;

  @IsOptional()
  @IsUUID()
  commentId?: string;
}

export class SubmitHelpdeskFeedbackDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @IsOptional()
  @IsString()
  comment?: string;
}
