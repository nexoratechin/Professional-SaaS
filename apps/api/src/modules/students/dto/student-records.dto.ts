import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

// ── Enum value lists (mirror @college-erp/database schema.prisma) ───────────

export const GUARDIAN_KINDS = ['FATHER', 'MOTHER', 'GUARDIAN', 'OTHER'] as const;
export const GUARDIAN_ROLES = ['PRIMARY', 'SECONDARY', 'EMERGENCY'] as const;
export const DOCUMENT_STATUSES = ['PENDING', 'VERIFIED', 'REJECTED'] as const;
export const ADMISSION_STATUSES = [
  'APPLIED',
  'DOCUMENTS_VERIFIED',
  'OFFERED',
  'ACCEPTED',
  'ENROLLED',
  'CANCELLED',
  'REJECTED',
] as const;
export const ENROLLMENT_STATUSES = ['ACTIVE', 'COMPLETED', 'WITHDRAWN', 'ON_HOLD', 'SUSPENDED'] as const;
export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const;
export const FEE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED'] as const;
export const PAYMENT_METHODS = ['CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE'] as const;
export const PAYMENT_STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;
export const EXAM_TYPES = [
  'MID_TERM',
  'END_TERM',
  'UNIT_TEST',
  'PRACTICAL',
  'VIVA',
  'ANNUAL',
  'SUPPLEMENTARY',
  'OTHER',
] as const;
export const EXAM_STATUSES = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] as const;
export const RESULT_OUTCOMES = ['PASS', 'FAIL', 'PASS_WITH_GRACE', 'INCOMPLETE'] as const;
export const CERTIFICATE_TYPES = [
  'BONAFIDE',
  'PROVISIONAL',
  'MIGRATION',
  'TRANSCRIPT',
  'TRANSFER_CERTIFICATE',
  'OTHER',
] as const;
export const CERTIFICATE_STATUSES = ['REQUESTED', 'GENERATED', 'APPROVED', 'ISSUED', 'REJECTED'] as const;
export const LIBRARY_LOAN_STATUSES = ['ISSUED', 'RETURNED', 'OVERDUE', 'LOST'] as const;
export const HOSTEL_BOOKING_STATUSES = ['REQUESTED', 'ALLOCATED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'] as const;
export const TRANSPORT_PASS_STATUSES = ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'] as const;
export const HOLD_TYPES = ['ACADEMIC', 'FINANCIAL', 'ADMINISTRATIVE', 'DISCIPLINARY', 'MEDICAL', 'OTHER'] as const;
export const COMMUNICATION_TYPES = ['CALL', 'EMAIL', 'SMS', 'WHATSAPP', 'MEETING', 'LETTER', 'OTHER'] as const;
export const COMMUNICATION_DIRECTIONS = ['INBOUND', 'OUTBOUND'] as const;

export const CERTIFICATE_ACTION_STATUSES = ['GENERATED', 'APPROVED', 'ISSUED', 'REJECTED'] as const;

// ── Guardian ─────────────────────────────────────────────────────────────────

export class CreateGuardianDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(GUARDIAN_KINDS)
  kind: (typeof GUARDIAN_KINDS)[number];

  @IsOptional()
  @IsIn(GUARDIAN_ROLES)
  role?: (typeof GUARDIAN_ROLES)[number];

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyIncomeCents?: number;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateGuardianDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(GUARDIAN_KINDS)
  kind?: (typeof GUARDIAN_KINDS)[number];

  @IsOptional()
  @IsIn(GUARDIAN_ROLES)
  role?: (typeof GUARDIAN_ROLES)[number];

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  occupation?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyIncomeCents?: number;

  @IsOptional()
  @IsString()
  address?: string;
}

// ── Document ─────────────────────────────────────────────────────────────────

export class CreateDocumentDto {
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
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  status?: (typeof DOCUMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

/** Shared body for verify/reject document decisions. */
export class DocumentDecisionDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  category?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  documentName?: string;

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
  @Min(0)
  sizeBytes?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Admission ────────────────────────────────────────────────────────────────

export class CreateAdmissionDto {
  @IsString()
  @IsNotEmpty()
  applicationNumber: string;

  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsDateString()
  appliedAt: string;

  @IsOptional()
  @IsIn(ADMISSION_STATUSES)
  status?: (typeof ADMISSION_STATUSES)[number];

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsString()
  offerLetterKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  admissionFeeCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateAdmissionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  applicationNumber?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsDateString()
  appliedAt?: string;

  @IsOptional()
  @IsIn(ADMISSION_STATUSES)
  status?: (typeof ADMISSION_STATUSES)[number];

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsString()
  offerLetterKey?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  admissionFeeCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Academic record ──────────────────────────────────────────────────────────

export class CreateAcademicRecordDto {
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
  @Min(0)
  @Max(100)
  @Type(() => Number)
  percentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  @Type(() => Number)
  gpa?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  marksObtained?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  marksOutOf?: number;

  @IsOptional()
  @IsString()
  rank?: string;

  @IsOptional()
  @IsBoolean()
  isHighestQualification?: boolean;

  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  verificationStatus?: (typeof DOCUMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateAcademicRecordDto {
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
  @Min(0)
  @Max(100)
  @Type(() => Number)
  percentage?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  @Type(() => Number)
  gpa?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  marksObtained?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  marksOutOf?: number;

  @IsOptional()
  @IsString()
  rank?: string;

  @IsOptional()
  @IsBoolean()
  isHighestQualification?: boolean;

  @IsOptional()
  @IsIn(DOCUMENT_STATUSES)
  verificationStatus?: (typeof DOCUMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Enrollment ───────────────────────────────────────────────────────────────

export class CreateEnrollmentDto {
  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  rollNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  semester?: number;

  @IsOptional()
  @IsIn(ENROLLMENT_STATUSES)
  status?: (typeof ENROLLMENT_STATUSES)[number];

  @IsOptional()
  @IsDateString()
  enrolledAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateEnrollmentDto {
  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  rollNumber?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  semester?: number;

  @IsOptional()
  @IsIn(ENROLLMENT_STATUSES)
  status?: (typeof ENROLLMENT_STATUSES)[number];

  @IsOptional()
  @IsDateString()
  enrolledAt?: string;

  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Attendance ───────────────────────────────────────────────────────────────

export class CreateAttendanceDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  attendanceType?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  subjectCode?: string;

  @IsOptional()
  @IsString()
  subjectName?: string;

  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  status?: (typeof ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateAttendanceDto {
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  attendanceType?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  subjectCode?: string;

  @IsOptional()
  @IsString()
  subjectName?: string;

  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  status?: (typeof ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Fee ──────────────────────────────────────────────────────────────────────

export class CreateFeeDto {
  @IsOptional()
  @IsString()
  termId?: string;

  @IsString()
  @IsNotEmpty()
  headCode: string;

  @IsString()
  @IsNotEmpty()
  headName: string;

  @IsInt()
  @Min(1)
  amountCents: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateFeeDto {
  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  headCode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  headName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class WaiveFeeDto {
  @IsInt()
  @Min(1)
  amountCents: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

// ── Payment ──────────────────────────────────────────────────────────────────

export class CreatePaymentDto {
  @IsOptional()
  @IsString()
  studentFeeId?: string;

  @IsString()
  @IsNotEmpty()
  receiptNumber: string;

  @IsInt()
  @Min(1)
  amountCents: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsDateString()
  paymentDate: string;

  @IsIn(PAYMENT_METHODS)
  method: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsIn(PAYMENT_STATUSES)
  status?: (typeof PAYMENT_STATUSES)[number];

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class RefundPaymentDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Exam ─────────────────────────────────────────────────────────────────────

export class CreateExamDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsIn(EXAM_TYPES)
  examType: (typeof EXAM_TYPES)[number];

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(EXAM_STATUSES)
  status?: (typeof EXAM_STATUSES)[number];
}

export class UpdateExamDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(EXAM_TYPES)
  examType?: (typeof EXAM_TYPES)[number];

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsIn(EXAM_STATUSES)
  status?: (typeof EXAM_STATUSES)[number];
}

// ── Result ───────────────────────────────────────────────────────────────────

export class CreateResultDto {
  @IsOptional()
  @IsString()
  examId?: string;

  @IsString()
  @IsNotEmpty()
  subjectCode: string;

  @IsString()
  @IsNotEmpty()
  subjectName: string;

  @IsInt()
  @Min(1)
  maxMarks: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  obtainedMarks?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  percentage?: number;

  @IsOptional()
  @IsIn(RESULT_OUTCOMES)
  outcome?: (typeof RESULT_OUTCOMES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateResultDto {
  @IsOptional()
  @IsString()
  examId?: string;

  @IsOptional()
  @IsString()
  subjectCode?: string;

  @IsOptional()
  @IsString()
  subjectName?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxMarks?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  obtainedMarks?: number;

  @IsOptional()
  @IsString()
  grade?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  @Type(() => Number)
  percentage?: number;

  @IsOptional()
  @IsIn(RESULT_OUTCOMES)
  outcome?: (typeof RESULT_OUTCOMES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Certificate ──────────────────────────────────────────────────────────────

export class CreateCertificateDto {
  @IsIn(CERTIFICATE_TYPES)
  certificateType: (typeof CERTIFICATE_TYPES)[number];

  @IsOptional()
  @IsString()
  certificateNumber?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsDateString()
  requestDate: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateCertificateDto {
  @IsOptional()
  @IsIn(CERTIFICATE_TYPES)
  certificateType?: (typeof CERTIFICATE_TYPES)[number];

  @IsOptional()
  @IsString()
  certificateNumber?: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsDateString()
  requestDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CertificateStatusChangeDto {
  @IsIn(CERTIFICATE_ACTION_STATUSES)
  status: (typeof CERTIFICATE_ACTION_STATUSES)[number];

  @IsOptional()
  @IsString()
  certificateNumber?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Library loan ─────────────────────────────────────────────────────────────

export class CreateLibraryLoanDto {
  @IsString()
  @IsNotEmpty()
  itemTitle: string;

  @IsOptional()
  @IsString()
  itemAuthor?: string;

  @IsOptional()
  @IsString()
  itemCode?: string;

  @IsOptional()
  @IsString()
  itemType?: string;

  @IsDateString()
  borrowedAt: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fineCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateLibraryLoanDto {
  @IsOptional()
  @IsString()
  itemTitle?: string;

  @IsOptional()
  @IsString()
  itemAuthor?: string;

  @IsOptional()
  @IsString()
  itemCode?: string;

  @IsOptional()
  @IsString()
  itemType?: string;

  @IsOptional()
  @IsDateString()
  borrowedAt?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsDateString()
  returnedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fineCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ReturnLibraryLoanDto {
  @IsOptional()
  @IsDateString()
  returnedAt?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fineCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Hostel booking ───────────────────────────────────────────────────────────

export class CreateHostelBookingDto {
  @IsString()
  @IsNotEmpty()
  hostelName: string;

  @IsString()
  @IsNotEmpty()
  roomNumber: string;

  @IsOptional()
  @IsString()
  bedNumber?: string;

  @IsOptional()
  @IsDateString()
  allocationDate?: string;

  @IsOptional()
  @IsDateString()
  checkInDate?: string;

  @IsOptional()
  @IsDateString()
  checkOutDate?: string;

  @IsOptional()
  @IsIn(HOSTEL_BOOKING_STATUSES)
  status?: (typeof HOSTEL_BOOKING_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateHostelBookingDto {
  @IsOptional()
  @IsString()
  hostelName?: string;

  @IsOptional()
  @IsString()
  roomNumber?: string;

  @IsOptional()
  @IsString()
  bedNumber?: string;

  @IsOptional()
  @IsDateString()
  allocationDate?: string;

  @IsOptional()
  @IsDateString()
  checkInDate?: string;

  @IsOptional()
  @IsDateString()
  checkOutDate?: string;

  @IsOptional()
  @IsIn(HOSTEL_BOOKING_STATUSES)
  status?: (typeof HOSTEL_BOOKING_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Transport pass ───────────────────────────────────────────────────────────

export class CreateTransportPassDto {
  @IsOptional()
  @IsString()
  routeCode?: string;

  @IsString()
  @IsNotEmpty()
  routeName: string;

  @IsOptional()
  @IsString()
  pickupPoint?: string;

  @IsOptional()
  @IsString()
  dropPoint?: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsDateString()
  periodStart: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsIn(TRANSPORT_PASS_STATUSES)
  status?: (typeof TRANSPORT_PASS_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateTransportPassDto {
  @IsOptional()
  @IsString()
  routeCode?: string;

  @IsOptional()
  @IsString()
  routeName?: string;

  @IsOptional()
  @IsString()
  pickupPoint?: string;

  @IsOptional()
  @IsString()
  dropPoint?: string;

  @IsOptional()
  @IsString()
  vehicleNumber?: string;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsIn(TRANSPORT_PASS_STATUSES)
  status?: (typeof TRANSPORT_PASS_STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Hold ─────────────────────────────────────────────────────────────────────

export class CreateHoldDto {
  @IsIn(HOLD_TYPES)
  type: (typeof HOLD_TYPES)[number];

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsDateString()
  placedOn: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class LiftHoldDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Communication ────────────────────────────────────────────────────────────

export class CreateCommunicationDto {
  @IsIn(COMMUNICATION_TYPES)
  type: (typeof COMMUNICATION_TYPES)[number];

  @IsOptional()
  @IsIn(COMMUNICATION_DIRECTIONS)
  direction?: (typeof COMMUNICATION_DIRECTIONS)[number];

  @IsOptional()
  @IsString()
  subject?: string;

  @IsString()
  @IsNotEmpty()
  body: string;

  @IsDateString()
  sentAt: string;

  @IsOptional()
  @IsString()
  recipientType?: string;

  @IsOptional()
  @IsString()
  recipientName?: string;

  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @IsOptional()
  @IsString()
  recipientEmail?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Resource list query ──────────────────────────────────────────────────────

export class ListStudentResourceQueryDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  ids?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  @Type(() => Number)
  take?: number;
}