/**
 * Timetable DTOs. Follows the academics module convention: class-validator + Swagger decorators,
 * stringly-typed enums (validated with IsIn against the exported constants) so the tenant stack
 * stays config-compatible (no native enum shipped over the wire).
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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// ── Closed taxonomies (mirror of the Prisma enums) ─────────────────────────

export const TIMETABLE_STATUSES = ['DRAFT', 'GENERATED', 'PUBLISHED', 'ARCHIVED'] as const;
export const TIMETABLE_ENTRY_TYPES = ['LECTURE', 'LAB', 'TUTORIAL', 'OTHER'] as const;
export const TIMETABLE_CONFLICT_TYPES = ['ROOM', 'FACULTY', 'SECTION'] as const;
export const SUBSTITUTION_STATUSES = ['REQUESTED', 'APPROVED', 'DECLINED', 'CANCELLED', 'EXECUTED'] as const;
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class TimetablePaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number;

  @IsOptional()
  @IsString()
  search?: string;
}

// ── Timetable header ────────────────────────────────────────────────────────

export class ListTimetablesQueryDto extends TimetablePaginationDto {
  @IsOptional()
  @IsIn(TIMETABLE_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  campusId?: string;
}

export class CreateTimetableDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsString()
  @IsNotEmpty()
  termId: string;

  @IsString()
  @IsNotEmpty()
  campusId: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];
}

export class UpdateTimetableDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  code?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  workingDays?: number[];
}

// ── Period grid ─────────────────────────────────────────────────────────────

export class PeriodInputDto {
  @IsInt()
  @Min(1)
  sequence: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  startTime: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  endTime: string;

  @IsOptional()
  @IsBoolean()
  isBreak?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplacePeriodsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PeriodInputDto)
  periods: PeriodInputDto[];
}

// ── Entries ─────────────────────────────────────────────────────────────────

export class ListEntriesQueryDto extends TimetablePaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @IsString()
  periodId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  facultyId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;
}

export class CreateEntryDto {
  @IsString()
  @IsNotEmpty()
  periodId: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsOptional()
  @IsString()
  courseOfferingId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsIn(TIMETABLE_ENTRY_TYPES)
  entryType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class UpdateEntryDto {
  @IsOptional()
  @IsString()
  periodId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @IsString()
  courseOfferingId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  assignedUserId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsIn(TIMETABLE_ENTRY_TYPES)
  entryType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// ── Holidays ────────────────────────────────────────────────────────────────

export class CreateHolidayDto {
  @IsDateString()
  date: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

// ── Faculty availability ────────────────────────────────────────────────────

export class ListAvailabilityQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;
}

export class CreateAvailabilityDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  startTime: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  endTime: string;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

export class UpdateAvailabilityDto {
  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  startTime?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(5)
  endTime?: string;

  @IsOptional()
  @IsBoolean()
  isBlocked?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

// ── Substitutions ───────────────────────────────────────────────────────────

export class ListSubstitutionsQueryDto extends TimetablePaginationDto {
  @IsOptional()
  @IsIn(SUBSTITUTION_STATUSES)
  status?: string;
}

export class RequestSubstitutionDto {
  @IsString()
  @IsNotEmpty()
  entryId: string;

  @IsString()
  @IsNotEmpty()
  substituteUserId: string;

  @IsDateString()
  effectiveDate: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  originalUserId?: string;
}

export class DecideSubstitutionDto {
  @IsIn(['APPROVED', 'DECLINED', 'CANCELLED'])
  status: string;
}

// ── Generation ──────────────────────────────────────────────────────────────

export class GenerateDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  offeringIds?: string[];
}