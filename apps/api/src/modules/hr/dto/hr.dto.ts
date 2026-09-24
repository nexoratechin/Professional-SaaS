/**
 * HR module DTOs — employee master, designations, joining/exit, documents, faculty workload,
 * leave (types/balances/applications with approval), performance reviews, salary structures and
 * payroll runs. Validation follows the codebase conventions (class-validator, IsDateString for
 * dates, IsIn for enum-backed fields) — see attendance.dto.ts / students dto for the pattern.
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export const EMPLOYEE_TYPES = ['FACULTY', 'STAFF', 'ADMIN'] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'ADJUNCT', 'INTERN'] as const;
export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'TERMINATED'] as const;
export const JOINING_STATUSES = ['PENDING', 'ONBOARDED', 'CONFIRMED', 'CLOSED'] as const;
export const EXIT_TYPES = ['RESIGNATION', 'RETIREMENT', 'TERMINATION', 'END_OF_CONTRACT', 'MUTUAL_SEPARATION'] as const;
export const DOCUMENT_TYPES = [
  'APPOINTMENT_LETTER',
  'OFFER_LETTER',
  'ID_PROOF',
  'EDUCATIONAL_CERTIFICATE',
  'EXPERIENCE_LETTER',
  'PAYSLIP',
  'RELIEVING_LETTER',
  'NO_DUE_CERTIFICATE',
  'OTHER',
] as const;
export const WORKLOAD_TYPES = ['TEACHING', 'ADMINISTRATIVE', 'RESEARCH', 'EXAM_DUTY', 'EXTENSION', 'OTHER'] as const;
export const LEAVE_CATEGORIES = [
  'CASUAL',
  'SICK',
  'EARNED',
  'MATERNITY',
  'PATERNITY',
  'UNPAID',
  'HALF_DAY',
  'COMPENSATORY',
  'SPECIAL',
  'OTHER',
] as const;
export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const REVIEW_TYPES = ['SELF', 'SUPERVISOR', 'PEER', 'COMMITTEE'] as const;
export const REVIEW_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'REJECTED'] as const;
export const PAYROLL_RUN_STATUSES = ['DRAFT', 'PROCESSING', 'PROCESSED', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export const PAYROLL_LINE_STATUSES = ['DRAFT', 'PROCESSED', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export const NO_DUE_STATUSES = ['PENDING', 'CLEARED', 'DISPUTED'] as const;
export const HALF_DAY_OPTIONS = ['FIRST_HALF', 'SECOND_HALF'] as const;

const MAX_PAGE = 200;

// ── Designations ────────────────────────────────────────────────────────────

export class CreateDesignationDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  rank?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateDesignationDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  rank?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Employees ───────────────────────────────────────────────────────────────

export class CreateEmployeeDto {
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_TYPES)
  employeeType?: string;

  @IsOptional()
  @IsString()
  honorific?: string;

  @IsString()
  @MinLength(1)
  firstName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  personalEmail?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

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
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsUUID()
  departmentId: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  reportingToId?: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  employmentStatus?: string;

  @IsOptional()
  @IsDateString()
  joinDate?: string;

  @IsOptional()
  @IsDateString()
  confirmationDate?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;

  @IsOptional()
  @IsString()
  panNumber?: string;

  @IsOptional()
  @IsString()
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankIfsc?: string;

  @IsOptional()
  @IsString()
  uanNumber?: string;

  @IsOptional()
  @IsString()
  qualification?: string;

  @IsOptional()
  @IsString()
  specialization?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  employeeCode?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_TYPES)
  employeeType?: string;

  @IsOptional()
  @IsString()
  honorific?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsString()
  gender?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  personalEmail?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

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
  postalCode?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  reportingToId?: string;

  @IsOptional()
  @IsIn(EMPLOYMENT_TYPES)
  employmentType?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  employmentStatus?: string;

  @IsOptional()
  @IsDateString()
  joinDate?: string;

  @IsOptional()
  @IsDateString()
  confirmationDate?: string;

  @IsOptional()
  @IsString()
  emergencyContactName?: string;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string;

  @IsOptional()
  @IsString()
  panNumber?: string;

  @IsOptional()
  @IsString()
  aadhaarNumber?: string;

  @IsOptional()
  @IsString()
  bankAccountNumber?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  bankIfsc?: string;

  @IsOptional()
  @IsString()
  uanNumber?: string;

  @IsOptional()
  @IsString()
  qualification?: string;

  @IsOptional()
  @IsString()
  specialization?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class LinkUserDto {
  @IsUUID()
  userId: string;
}

export class QueryEmployeesDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  campusId?: string;

  @IsOptional()
  @IsUUID()
  designationId?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_TYPES)
  employeeType?: string;

  @IsOptional()
  @IsIn(EMPLOYEE_STATUSES)
  employmentStatus?: string;

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

// ── Joining / exit ──────────────────────────────────────────────────────────

export class CreateJoiningDto {
  @IsOptional()
  @IsIn(JOINING_STATUSES)
  joiningStatus?: string;

  @IsOptional()
  @IsDateString()
  offerDate?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  probationMonths?: number;

  @IsOptional()
  @IsDateString()
  confirmationDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateJoiningDto {
  @IsOptional()
  @IsIn(JOINING_STATUSES)
  joiningStatus?: string;

  @IsOptional()
  @IsDateString()
  offerDate?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  probationMonths?: number;

  @IsOptional()
  @IsDateString()
  confirmationDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CreateExitDto {
  @IsIn(EXIT_TYPES)
  exitType: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsDateString()
  lastWorkingDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  noticePeriodDays?: number;

  @IsOptional()
  @IsDateString()
  relievingDate?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsIn(NO_DUE_STATUSES)
  noDueStatus?: string;

  @IsOptional()
  @IsDateString()
  noDueClearedAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  settlementAmount?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateExitDto {
  @IsOptional()
  @IsIn(EXIT_TYPES)
  exitType?: string;

  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsDateString()
  lastWorkingDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  noticePeriodDays?: number;

  @IsOptional()
  @IsDateString()
  relievingDate?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsIn(NO_DUE_STATUSES)
  noDueStatus?: string;

  @IsOptional()
  @IsDateString()
  noDueClearedAt?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  settlementAmount?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Documents ───────────────────────────────────────────────────────────────

export class RequestUploadUrlDto {
  @IsIn(DOCUMENT_TYPES)
  documentType: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  @MinLength(1)
  filename: string;

  @IsString()
  @MinLength(1)
  mimeType: string;
}

export class ConfirmUploadDto {
  @IsInt()
  @Min(0)
  sizeBytes: number;
}

export class VerifyDocumentDto {
  @IsBoolean()
  verified: boolean;
}

// ── Faculty workload ────────────────────────────────────────────────────────

export class CreateWorkloadDto {
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsIn(WORKLOAD_TYPES)
  workloadType: string;

  @IsString()
  @MinLength(1)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hoursPerWeek?: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateWorkloadDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsIn(WORKLOAD_TYPES)
  workloadType?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hoursPerWeek?: number;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QueryWorkloadsDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsIn(WORKLOAD_TYPES)
  workloadType?: string;

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

// ── Leave ───────────────────────────────────────────────────────────────────

export class CreateLeaveTypeDto {
  @IsString()
  @MinLength(1)
  code: string;

  @IsString()
  @MinLength(1)
  name: string;

  @IsIn(LEAVE_CATEGORIES)
  category: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDaysPerYear?: number;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;
}

export class UpdateLeaveTypeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  code?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  name?: string;

  @IsOptional()
  @IsIn(LEAVE_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  maxDaysPerYear?: number;

  @IsOptional()
  @IsBoolean()
  isPaid?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresApproval?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AdjustLeaveBalanceDto {
  @IsUUID()
  employeeId: string;

  @IsUUID()
  leaveTypeId: string;

  @IsInt()
  @Min(2000)
  @Max(2200)
  year: number;

  @IsOptional()
  @IsNumber()
  openingBalance?: number;

  @IsOptional()
  @IsNumber()
  creditedDays?: number;

  @IsOptional()
  @IsNumber()
  availedDays?: number;

  @IsOptional()
  @IsNumber()
  adjustedDays?: number;
}

export class QueryLeaveBalancesDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;

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

export class CreateLeaveApplicationDto {
  @IsUUID()
  employeeId: string;

  @IsUUID()
  leaveTypeId: string;

  @IsDateString()
  fromDate: string;

  @IsDateString()
  toDate: string;

  @IsOptional()
  @IsIn(HALF_DAY_OPTIONS)
  halfDayOption?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  durationDays?: number;
}

export class DecideLeaveDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class QueryLeaveApplicationsDto {
  @IsOptional()
  @IsIn(LEAVE_STATUSES)
  status?: string;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;

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

// ── Performance reviews ─────────────────────────────────────────────────────

export class CreatePerformanceReviewDto {
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsDateString()
  reviewPeriodStart?: string;

  @IsOptional()
  @IsDateString()
  reviewPeriodEnd?: string;

  @IsIn(REVIEW_TYPES)
  reviewType: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9.99)
  score?: number;

  @IsOptional()
  @IsObject()
  goals?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  achievements?: string;

  @IsOptional()
  @IsString()
  areasForImprovement?: string;

  @IsOptional()
  @IsString()
  overallComments?: string;

  @IsOptional()
  @IsUUID()
  reviewerUserId?: string;
}

export class UpdatePerformanceReviewDto {
  @IsOptional()
  @IsDateString()
  reviewPeriodStart?: string;

  @IsOptional()
  @IsDateString()
  reviewPeriodEnd?: string;

  @IsOptional()
  @IsIn(REVIEW_TYPES)
  reviewType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(9.99)
  score?: number;

  @IsOptional()
  @IsObject()
  goals?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  achievements?: string;

  @IsOptional()
  @IsString()
  areasForImprovement?: string;

  @IsOptional()
  @IsString()
  overallComments?: string;

  @IsOptional()
  @IsUUID()
  reviewerUserId?: string;
}

export class QueryPerformanceReviewsDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsIn(REVIEW_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(REVIEW_TYPES)
  reviewType?: string;

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

// ── Salary & payroll ────────────────────────────────────────────────────────

export class CreateSalaryStructureDto {
  @IsUUID()
  employeeId: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsNumber()
  @Min(0)
  basicAmount: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hraAmount?: number;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  allowances?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  deductions?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grossAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  netAmount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateSalaryStructureDto {
  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  basicAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  hraAmount?: number;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  allowances?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsArray()
  @IsObject({ each: true })
  deductions?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsNumber()
  @Min(0)
  grossAmount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  netAmount?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class QuerySalaryStructuresDto {
  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeInactive?: boolean;

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

export class CreatePayrollRunDto {
  @IsInt()
  @Min(1)
  @Max(12)
  month: number;

  @IsInt()
  @Min(2000)
  @Max(2200)
  year: number;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class QueryPayrollRunsDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  month?: number;

  @IsOptional()
  @IsInt()
  @Min(2000)
  @Max(2200)
  year?: number;

  @IsOptional()
  @IsIn(PAYROLL_RUN_STATUSES)
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

export class PayPayrollRunDto {
  @IsOptional()
  @IsString()
  referenceNumber?: string;
}

export class LinkPayslipDto {
  @IsString()
  @MinLength(1)
  filename: string;

  @IsString()
  @MinLength(1)
  mimeType: string;

  @IsOptional()
  @IsString()
  title?: string;
}