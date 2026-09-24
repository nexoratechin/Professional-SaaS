/**
 * Placements module DTOs — companies, contacts, drives, positions, eligibility, resumes,
 * applications, rounds/results, selections, offers, joinings, outcomes and report queries.
 * Validation follows the codebase conventions (class-validator, IsDateString for dates,
 * IsIn for enum-backed fields) — see hr.dto.ts / admissions.dto.ts for the pattern.
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export const COMPANY_TYPES = ['MNC', 'INDIAN_MNC', 'STARTUP', 'PSU', 'CORPORATE', 'SME', 'GOVT_ORG', 'NGO', 'OTHER'] as const;
export const DRIVE_MODES = ['ON_CAMPUS', 'OFF_CAMPUS', 'VIRTUAL'] as const;
export const DRIVE_STATUSES = ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;
export const POSITION_TYPES = ['FULL_TIME', 'INTERNSHIP', 'CONTRACT', 'TRAINEE'] as const;
export const ELIGIBILITY_STATUSES = ['PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE', 'EXEMPTED'] as const;
export const APPLICATION_STATUSES = ['APPLIED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'] as const;
export const ROUND_TYPES = [
  'APTITUDE_TEST',
  'TECHNICAL_TEST',
  'PSYCHOMETRIC_TEST',
  'GROUP_DISCUSSION',
  'TECHNICAL_INTERVIEW',
  'HR_INTERVIEW',
  'MANAGERIAL_INTERVIEW',
  'CASE_STUDY',
  'OTHER',
] as const;
export const ROUND_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export const ROUND_RESULT_STATUSES = ['PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD', 'ABSENT'] as const;
export const OFFER_STATUSES = ['ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
export const JOINING_STATUSES = ['PENDING', 'JOINED', 'NOT_JOINED', 'POSTPONED'] as const;
export const OUTCOME_STATUSES = ['PLACED', 'NOT_PLACED', 'OPTED_OUT', 'UNREGISTERED'] as const;

const MAX_PAGE = 200;

// ── Companies & contacts ───────────────────────────────────────────────────

export class CreateCompanyDto {
  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsIn(COMPANY_TYPES)
  companyType?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  headquartersCity?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCompanyDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(COMPANY_TYPES)
  companyType?: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  headquartersCity?: string;

  @IsOptional()
  @IsString()
  addressLine1?: string;

  @IsOptional()
  @IsString()
  addressLine2?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryCompaniesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(COMPANY_TYPES)
  companyType?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

export class CreateContactDto {
  @IsUUID()
  companyId: string;

  @IsString()
  @MinLength(1)
  fullName: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateContactDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @IsOptional()
  @IsString()
  designation?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryContactsDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

// ── Drives & positions ──────────────────────────────────────────────────────

export class CreateDriveDto {
  @IsUUID()
  companyId: string;

  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(DRIVE_MODES)
  mode?: string;

  @IsOptional()
  @IsIn(DRIVE_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  driveDate?: string;

  @IsOptional()
  @IsDateString()
  applicationDeadline?: string;

  @IsOptional()
  @IsString()
  venue?: string;

  @IsOptional()
  @IsUUID()
  coordinatorContactId?: string;

  @IsOptional()
  @IsString()
  eligibilityNotes?: string;
}

export class UpdateDriveDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(DRIVE_MODES)
  mode?: string;

  @IsOptional()
  @IsIn(DRIVE_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  driveDate?: string;

  @IsOptional()
  @IsDateString()
  applicationDeadline?: string;

  @IsOptional()
  @IsString()
  venue?: string;

  @IsOptional()
  @IsUUID()
  coordinatorContactId?: string;

  @IsOptional()
  @IsString()
  eligibilityNotes?: string;
}

export class ChangeDriveStatusDto {
  @IsIn(DRIVE_STATUSES)
  status: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class QueryDrivesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @IsIn(DRIVE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(DRIVE_MODES)
  mode?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

export class CreatePositionDto {
  @IsUUID()
  driveId: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsIn(POSITION_TYPES)
  positionType?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  openings?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  minCgpa?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minPercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxBacklogs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  packageCents?: number;

  @IsOptional()
  @IsString()
  packageNotes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdatePositionDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsIn(POSITION_TYPES)
  positionType?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  openings?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10)
  minCgpa?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minPercentage?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxBacklogs?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  packageCents?: number;

  @IsOptional()
  @IsString()
  packageNotes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryPositionsDto {
  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

// ── Eligibility ─────────────────────────────────────────────────────────────

export class QueryEligibilityDto {
  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @IsUUID()
  positionId?: string;

  @IsOptional()
  @IsIn(ELIGIBILITY_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

/** Students to evaluate / (re)evaluate against a position's criteria.
 * `studentIds` empty ⇒ evaluate every non-deleted, enrolled student the caller can see. */
export class EvaluateEligibilityDto {
  @IsUUID()
  positionId: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  studentIds?: string[];

  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsBoolean()
  exempted?: boolean;
}

export class OverrideEligibilityDto {
  @IsIn(['ELIGIBLE', 'NOT_ELIGIBLE', 'EXEMPTED', 'PENDING'])
  status: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Resumes ─────────────────────────────────────────────────────────────────

export class ResumeUploadRequestDto {
  @IsUUID()
  studentId: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsString()
  @MinLength(1)
  filename: string;

  @IsString()
  @MinLength(1)
  contentType: string;
}

export class ConfirmResumeUploadDto {
  @IsUUID()
  id: string;

  @IsString()
  @MinLength(1)
  key: string;

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UpdateResumeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class QueryResumesDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

// ── Applications ────────────────────────────────────────────────────────────

export class CreateApplicationDto {
  @IsUUID()
  driveId: string;

  @IsUUID()
  positionId: string;

  @IsUUID()
  studentId: string;

  @IsOptional()
  @IsUUID()
  resumeId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CreateApplicationsBulkDto {
  @IsUUID()
  driveId: string;

  @IsUUID()
  positionId: string;

  @IsArray()
  @IsUUID('4', { each: true })
  studentIds: string[];

  @IsOptional()
  @IsUUID()
  resumeId?: string;
}

export class UpdateApplicationStatusDto {
  @IsIn(['APPLIED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'])
  status: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class QueryApplicationsDto {
  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @IsUUID()
  positionId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsIn(APPLICATION_STATUSES)
  status?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeAll?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

// ── Rounds & results ────────────────────────────────────────────────────────

export class CreateRoundDto {
  @IsUUID()
  driveId: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence: number;

  @IsIn(ROUND_TYPES)
  roundType: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  locationOrLink?: string;

  @IsOptional()
  @IsIn(ROUND_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateRoundDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sequence?: number;

  @IsOptional()
  @IsIn(ROUND_TYPES)
  roundType?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  locationOrLink?: string;

  @IsOptional()
  @IsIn(ROUND_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class QueryRoundsDto {
  @IsUUID()
  driveId: string;
}

export class RoundResultEntryDto {
  @IsUUID()
  applicationId: string;

  @IsIn(ROUND_RESULT_STATUSES)
  result: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsString()
  feedback?: string;
}

export class RecordRoundResultDto {
  @IsUUID()
  roundId: string;

  @IsUUID()
  applicationId: string;

  @IsIn(ROUND_RESULT_STATUSES)
  result: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  score?: number;

  @IsOptional()
  @IsString()
  feedback?: string;
}

export class BulkRecordRoundResultsDto {
  @IsUUID()
  roundId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoundResultEntryDto)
  results: RoundResultEntryDto[];
}

export class QueryRoundResultsDto {
  @IsUUID()
  roundId: string;

  @IsOptional()
  @IsIn(ROUND_RESULT_STATUSES)
  result?: string;
}

// ── Selections ──────────────────────────────────────────────────────────────

export class CreateSelectionDto {
  @IsUUID()
  applicationId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class QuerySelectionsDto {
  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @IsUUID()
  positionId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

// ── Offers ──────────────────────────────────────────────────────────────────

export class CreateOfferDto {
  @IsUUID()
  applicationId: string;

  @IsOptional()
  @IsUUID()
  selectionId?: string;

  @IsString()
  @MinLength(1)
  offerLetterNumber: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  packageCents?: number;

  @IsOptional()
  @IsString()
  joiningLocation?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateOfferDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  offerLetterNumber?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  packageCents?: number;

  @IsOptional()
  @IsString()
  joiningLocation?: string;

  @IsOptional()
  @IsDateString()
  expiryDate?: string;

  @IsOptional()
  @IsIn(['ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED'])
  status?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class OfferDecisionDto {
  @IsIn(['ACCEPTED', 'DECLINED'])
  decision: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class QueryOffersDto {
  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @IsUUID()
  positionId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsIn(OFFER_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

// ── Joining ─────────────────────────────────────────────────────────────────

export class CreateJoiningDto {
  @IsUUID()
  offerId: string;

  @IsOptional()
  @IsDateString()
  expectedJoiningDate?: string;

  @IsOptional()
  @IsDateString()
  actualJoiningDate?: string;

  @IsOptional()
  @IsString()
  joiningLocation?: string;

  @IsOptional()
  @IsIn(JOINING_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateJoiningDto {
  @IsOptional()
  @IsDateString()
  expectedJoiningDate?: string;

  @IsOptional()
  @IsDateString()
  actualJoiningDate?: string;

  @IsOptional()
  @IsString()
  joiningLocation?: string;

  @IsOptional()
  @IsIn(JOINING_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class QueryJoiningsDto {
  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @IsIn(JOINING_STATUSES)
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

// ── Outcomes, statistics & reports ──────────────────────────────────────────

export class DeclareOutcomeDto {
  @IsUUID()
  academicYearId: string;

  @IsUUID()
  studentId: string;

  @IsIn(OUTCOME_STATUSES)
  outcomeStatus: string;

  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @IsUUID()
  positionId?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  finalPackageCents?: number;

  @IsOptional()
  @IsDateString()
  placedAt?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateOutcomeDto {
  @IsOptional()
  @IsIn(OUTCOME_STATUSES)
  outcomeStatus?: string;

  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @IsUUID()
  positionId?: string;

  @IsOptional()
  @IsUUID()
  offerId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  finalPackageCents?: number;

  @IsOptional()
  @IsDateString()
  placedAt?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class QueryOutcomesDto {
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  driveId?: string;

  @IsOptional()
  @IsIn(OUTCOME_STATUSES)
  outcomeStatus?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeUnregistered?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  take?: number;
}

export class GeneratePlacementReportDto {
  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsUUID()
  driveId?: string;
}

export class StatisticsQueryDto {
  @IsOptional()
  @IsUUID()
  academicYearId?: string;
}