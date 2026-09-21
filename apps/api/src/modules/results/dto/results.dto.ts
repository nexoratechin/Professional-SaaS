/**
 * Results DTOs. Mirrors the exams/academics convention: class-validator + Swagger, stringly-typed
 * taxonomies (validated with IsIn against exported constants) so the tenant stack stays
 * config-compatible. Grace policy is passed as a flat config object so a session can override the
 * grading scheme's grace settings without touching the scheme itself.
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

// ── Closed taxonomies (mirror of the Prisma enums / engine options) ─────────

export const RESULT_STATES = ['CALCULATED', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'LOCKED'] as const;
export const RESULT_STANDINGS = ['PASSED', 'FAILED', 'SUPPLEMENTARY'] as const;
export const RESULT_EVENTS = [
  'CALCULATED',
  'APPROVED',
  'PUBLISHED',
  'UNPUBLISHED',
  'LOCKED',
  'UNLOCKED',
  'REJECTED',
] as const;
export const PASS_MODES = ['PERCENTAGE', 'GRADE_POINT'] as const;
export const WEIGHTING_MODES = ['SIMPLE', 'CREDIT_WEIGHTED'] as const;
export const COMPONENT_KINDS = ['INTERNAL', 'THEORY', 'PRACTICAL', 'PROJECT', 'VIVA', 'OTHER'] as const;
export const BULK_PROCESS_ACTIONS = ['APPROVE', 'PUBLISH', 'UNPUBLISH', 'LOCK', 'UNLOCK'] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class ResultsPaginationDto {
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

// ── Grading schemes ─────────────────────────────────────────────────────────

export class UpsertGradeScaleItemDto {
  @IsString()
  @IsNotEmpty()
  grade: string;

  @IsNumber()
  @Min(0)
  minPercent: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  maxPercent: number;

  @IsNumber()
  @Min(0)
  gradePoint: number;

  @IsOptional()
  @IsString()
  gradeDescription?: string;
}

export class CreateGradingSchemeDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(PASS_MODES)
  passMode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minPassPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minPassGradePoint?: number;

  @IsOptional()
  @IsIn(WEIGHTING_MODES)
  weightingMode?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  gpaMax?: number;

  @IsOptional()
  @IsBoolean()
  graceEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxGraceMarks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  graceToPassDiff?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  roundingDecimals?: number;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertGradeScaleItemDto)
  gradeScale?: UpsertGradeScaleItemDto[];
}

export class UpdateGradingSchemeDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(PASS_MODES)
  passMode?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  minPassPercent?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  minPassGradePoint?: number;

  @IsOptional()
  @IsIn(WEIGHTING_MODES)
  weightingMode?: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  gpaMax?: number;

  @IsOptional()
  @IsBoolean()
  graceEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxGraceMarks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  graceToPassDiff?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  roundingDecimals?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplaceGradeScaleDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpsertGradeScaleItemDto)
  items: UpsertGradeScaleItemDto[];
}

// ── Session result configuration ────────────────────────────────────────────

export class GracePolicyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxGraceMarks?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  graceToPassDiff?: number;
}

export class SessionResultConfigDto {
  @IsOptional()
  @IsString()
  gradingSchemeId?: string;

  @IsOptional()
  @IsObject()
  gracePolicy?: GracePolicyDto;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Assessment components ───────────────────────────────────────────────────

export class CreateComponentDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsIn(COMPONENT_KINDS)
  kind?: string;

  @IsNumber()
  @Min(0)
  weightage: number;

  @IsNumber()
  @Min(0)
  maxMarks: number;

  /** Omit for a session-wide component (applies to every paper); set for a paper-specific one. */
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdateComponentDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(COMPONENT_KINDS)
  kind?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weightage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  maxMarks?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

// ── Component marks (bulk per subject) ──────────────────────────────────────

export class ComponentMarkInputDto {
  @IsString()
  @IsNotEmpty()
  registrationId: string;

  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  componentId: string;

  @IsNumber()
  @Min(0)
  marksObtained: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class SaveComponentMarksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ComponentMarkInputDto)
  items: ComponentMarkInputDto[];
}

// ── Calculation & lifecycle ─────────────────────────────────────────────────

export class CalculateSessionDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}

export class BulkProcessActionDto {
  @IsIn(BULK_PROCESS_ACTIONS)
  action: string;

  /** When omitted, the action applies to every process currently eligible for it. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studentIds?: string[];
}

export class ListProcessesQueryDto {
  @IsOptional()
  @IsIn(RESULT_STATES)
  state?: string;

  @IsOptional()
  @IsIn(RESULT_STANDINGS)
  standing?: string;

  @IsOptional()
  @IsString()
  studentId?: string;
}

export class ListComponentsQueryDto {
  @IsOptional()
  @IsString()
  subjectId?: string;
}

export class ListMarksEntriesQueryDto {
  @IsOptional()
  @IsString()
  subjectId?: string;
}