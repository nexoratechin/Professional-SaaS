/**
 * Attendance module DTOs — session creation/update, bulk marking, correction requests with
 * approval, faculty/staff daily logs, and report queries. Validation mirrors the codebase
 * conventions (class-validator, IsDateString for timestamps, IsIn for enum-backed fields.
 */

import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const;
export const SESSION_STATUSES = ['OPEN', 'CLOSED'] as const;
export const CORRECTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const MARK_METHODS = ['MANUAL', 'QR', 'BIOMETRIC'] as const;

export class CreateSessionDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  courseOfferingId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  timetableEntryId?: string;

  @IsOptional()
  @IsString()
  attendanceType?: string;

  @IsOptional()
  @IsString()
  subjectCode?: string;

  @IsOptional()
  @IsString()
  subjectName?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsIn(MARK_METHODS)
  markMethod?: string;
}

export class UpdateSessionDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  attendanceType?: string;

  @IsOptional()
  @IsString()
  subjectCode?: string;

  @IsOptional()
  @IsString()
  subjectName?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  markedByUserId?: string;
}

export class MarkEntryDto {
  @IsString()
  studentId: string;

  @IsIn(ATTENDANCE_STATUSES)
  status: (typeof ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsDateString()
  signInAt?: string;
}

export class MarkSessionDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MarkEntryDto)
  entries: MarkEntryDto[];

  @IsOptional()
  @IsIn(MARK_METHODS)
  markMethod?: string;
}

export class CreateCorrectionDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  attendanceRecordId?: string;

  @IsIn(ATTENDANCE_STATUSES)
  toStatus: (typeof ATTENDANCE_STATUSES)[number];

  @IsString()
  reason: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateCorrectionDto {
  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  toStatus?: (typeof ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class DecideCorrectionDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpsertFacultyAttendanceDto {
  @IsString()
  userId: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsDateString()
  checkInAt?: string;

  @IsOptional()
  @IsDateString()
  checkOutAt?: string;

  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  status?: (typeof ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsIn(MARK_METHODS)
  markMethod?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateFacultyAttendanceDto {
  @IsOptional()
  @IsDateString()
  checkInAt?: string;

  @IsOptional()
  @IsDateString()
  checkOutAt?: string;

  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  status?: (typeof ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ListSessionsQueryDto {
  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  courseOfferingId?: string;

  @IsOptional()
  @IsIn(SESSION_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsString()
  myOnly?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  take?: number;
}

export class ListCorrectionsQueryDto {
  @IsOptional()
  @IsIn(CORRECTION_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  take?: number;
}

export class ListFacultyQueryDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  take?: number;
}

export class PercentageQueryDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  subjectCode?: string;
}

export class ScopeReportQueryDto {
  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  courseOfferingId?: string;
}