/**
 * Admissions lifecycle DTOs. Mirrors the students module convention: class-validator + Swagger
 * decorators, stringly-typed status enums (validated by IsIn against the exported constants).
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
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

export const ADMISSION_SESSION_STATUSES = ['OPEN', 'CLOSED'] as const;
export const ADMISSION_PROGRAM_STATUSES = ['OPEN', 'CLOSED', 'FULL'] as const;
export const ADMISSION_APPLICATION_STATUSES = [
  'INITIATED',
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'DOCUMENTS_VERIFIED',
  'MERIT_LISTED',
  'COUNSELLING_SCHEDULED',
  'COUNSELLED',
  'SELECTED',
  'OFFERED',
  'OFFER_ACCEPTED',
  'FEE_PAID',
  'ENROLLED',
  'WAITLISTED',
  'REJECTED',
  'CANCELLED',
] as const;
export const ADMISSION_OFFER_STATUSES = ['ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
export const COURSELLING_DECISIONS = ['SELECTED', 'WAITLISTED', 'REJECTED'] as const;
export const PAYMENT_METHODS = ['CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE'] as const;
export const STUDENT_GENDERS = ['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED'] as const;

// ── Sessions ────────────────────────────────────────────────────────────────

export class CreateAdmissionSessionDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsOptional()
  @IsInt()
  applicationFeeCents?: number;

  @IsOptional()
  @IsInt()
  admissionFeeCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];
}

export class UpdateAdmissionSessionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsInt()
  applicationFeeCents?: number;

  @IsOptional()
  @IsInt()
  admissionFeeCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];
}

// ── Program offers (seat matrix) ────────────────────────────────────────────

export class CreateAdmissionProgramDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  seats?: number;

  @IsOptional()
  @IsInt()
  applicationFeeCents?: number;

  @IsOptional()
  @IsInt()
  admissionFeeCents?: number;

  @IsOptional()
  @IsInt()
  tuitionFeeCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];
}

export class UpdateAdmissionProgramDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  seats?: number;

  @IsOptional()
  @IsInt()
  applicationFeeCents?: number;

  @IsOptional()
  @IsInt()
  admissionFeeCents?: number;

  @IsOptional()
  @IsInt()
  tuitionFeeCents?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  requiredDocuments?: string[];
}

// ── Enquiries ───────────────────────────────────────────────────────────────

export class CreateAdmissionEnquiryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsDateString()
  followUpAt?: string;
}

export class UpdateAdmissionEnquiryDto {
  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  message?: string;

  @IsOptional()
  @IsDateString()
  followUpAt?: string;
}

// ── Applications ────────────────────────────────────────────────────────────

/** Base profile fields shared by application create/update. */
export class AdmissionApplicationBaseDto {
  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsOptional()
  @IsIn(STUDENT_GENDERS)
  gender?: (typeof STUDENT_GENDERS)[number];

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

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
  @IsObject()
  guardian?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CreateAdmissionApplicationDto extends AdmissionApplicationBaseDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  admissionProgramId: string;

  @IsString()
  @IsNotEmpty()
  campusId: string;

  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsOptional()
  @IsString()
  enquiryId?: string;
}

export class UpdateAdmissionApplicationDto extends AdmissionApplicationBaseDto {}

export class ListAdmissionApplicationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  admissionProgramId?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  take?: number;
}

export class ScoreAdmissionApplicationDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  meritScore?: number;

  /** When true, computes the score from the highest qualification's percentage. */
  @IsOptional()
  auto?: boolean;
}

// ── Documents ───────────────────────────────────────────────────────────────

export class CreateApplicationDocumentDto {
  @IsString()
  @IsNotEmpty()
  category: string;

  @IsString()
  @IsNotEmpty()
  documentName: string;

  @IsOptional()
  @IsString()
  storageKey?: string;

  @IsOptional()
  @IsString()
  originalFilename?: string;

  @IsOptional()
  @IsString()
  mimeType?: string;

  @IsOptional()
  @IsInt()
  sizeBytes?: number;
}

export class UpdateApplicationDocumentDto {
  @IsOptional()
  @IsString()
  documentName?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class DocumentDecisionDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Qualifications ──────────────────────────────────────────────────────────

export class CreateQualificationDto {
  @IsString()
  @IsNotEmpty()
  institution: string;

  @IsOptional()
  @IsString()
  board?: string;

  @IsOptional()
  @IsString()
  degree?: string;

  @IsOptional()
  @IsInt()
  yearOfPassing?: number;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsNumber()
  gpa?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsInt()
  marksObtained?: number;

  @IsOptional()
  @IsInt()
  marksOutOf?: number;

  @IsOptional()
  @IsString()
  rank?: string;

  @IsOptional()
  isHighestQualification?: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateQualificationDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  institution?: string;

  @IsOptional()
  @IsString()
  board?: string;

  @IsOptional()
  @IsString()
  degree?: string;

  @IsOptional()
  @IsInt()
  yearOfPassing?: number;

  @IsOptional()
  @IsNumber()
  percentage?: number;

  @IsOptional()
  @IsNumber()
  gpa?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsInt()
  marksObtained?: number;

  @IsOptional()
  @IsInt()
  marksOutOf?: number;

  @IsOptional()
  @IsString()
  rank?: string;

  @IsOptional()
  isHighestQualification?: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Counselling ─────────────────────────────────────────────────────────────

export class CreateCounsellingSlotDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  venue?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class UpdateCounsellingSlotDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  venue?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class BookCounsellingDto {
  @IsString()
  @IsNotEmpty()
  counsellingSlotId: string;
}

export class CounsellingDecisionDto {
  @IsIn(COURSELLING_DECISIONS)
  decision: (typeof COURSELLING_DECISIONS)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Offers ──────────────────────────────────────────────────────────────────

export class IssueOfferDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  admissionFeeCents?: number;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class OfferDecisionDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Payments ────────────────────────────────────────────────────────────────

export class PayAdmissionFeeDto {
  @IsIn(PAYMENT_METHODS)
  method: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsDateString()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Enrollment ──────────────────────────────────────────────────────────────

export class EnrollApplicationDto {
  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  rollNumber?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CancelApplicationDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

// ── Configurable form fields ────────────────────────────────────────────────

export const ADMISSION_FIELD_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'EMAIL', 'PHONE', 'SELECT', 'RADIO', 'CHECKBOX'] as const;

export class AdmissionFormFieldInputDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  label: string;

  @IsIn(ADMISSION_FIELD_TYPES)
  fieldType: (typeof ADMISSION_FIELD_TYPES)[number];

  @IsOptional()
  @IsString()
  placeholder?: string;

  @IsOptional()
  required?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @IsOptional()
  @IsString()
  helpText?: string;

  @IsOptional()
  @IsInt()
  sequenceOrder?: number;

  @IsOptional()
  isActive?: boolean;
}

export class SetAdmissionFormFieldsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdmissionFormFieldInputDto)
  fields: AdmissionFormFieldInputDto[];
}

// ── Eligibility rules ───────────────────────────────────────────────────────

export const ADMISSION_ELIGIBILITY_RULE_TYPES = ['MIN_PERCENTAGE', 'MIN_GPA', 'MIN_MARKS', 'MIN_AGE', 'MAX_AGE', 'CATEGORY_ALLOWED', 'CUSTOM'] as const;

export class CreateAdmissionEligibilityRuleDto {
  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsIn(ADMISSION_ELIGIBILITY_RULE_TYPES)
  ruleType: (typeof ADMISSION_ELIGIBILITY_RULE_TYPES)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  appliesToCategory?: string;

  @IsOptional()
  @IsInt()
  sequenceOrder?: number;

  @IsOptional()
  isActive?: boolean;
}

export class UpdateAdmissionEligibilityRuleDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(ADMISSION_ELIGIBILITY_RULE_TYPES)
  ruleType?: (typeof ADMISSION_ELIGIBILITY_RULE_TYPES)[number];

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  appliesToCategory?: string;

  @IsOptional()
  @IsInt()
  sequenceOrder?: number;

  @IsOptional()
  isActive?: boolean;
}

// ── Duplicate detection ─────────────────────────────────────────────────────

export class FlagDuplicateDto {
  @IsString()
  @IsNotEmpty()
  duplicateOfId: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ── Bulk operations ─────────────────────────────────────────────────────────

export class BulkImportApplicationDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateAdmissionApplicationDto)
  applications: CreateAdmissionApplicationDto[];
}

export class BulkVerifyApplicationsDto {
  @IsArray()
  @IsString({ each: true })
  applicationIds: string[];

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Applicant communication ─────────────────────────────────────────────────

export const ADMISSION_MESSAGE_CHANNELS = ['EMAIL', 'SMS', 'IN_APP'] as const;

export class SendAdmissionMessageDto {
  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsIn(ADMISSION_MESSAGE_CHANNELS)
  channel: (typeof ADMISSION_MESSAGE_CHANNELS)[number];
}

// ── Analytics ───────────────────────────────────────────────────────────────

export class AdmissionAnalyticsQueryDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(365)
  days?: number;
}