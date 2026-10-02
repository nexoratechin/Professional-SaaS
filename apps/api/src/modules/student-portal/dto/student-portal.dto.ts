/**
 * Student Portal DTOs — the self-service surface for a STUDENT-role user linked to a Student
 * record (Student.userId). All fields are deliberately a narrow, whitelisted subset of the
 * underlying domain models: a student may edit only their own contact details, may request a
 * certificate, raise a support ticket, upload a document and record a fee payment against their
 * own ledger. Everything else is composed from existing modules.
 */
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
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

/** Mirrors Prisma's CertificateType enum (kept local so the portal DTO never drifts from the
 *  domain module's validation by importing its internals across module boundaries). */
export const PORTAL_CERTIFICATE_TYPES = [
  'BONAFIDE',
  'PROVISIONAL',
  'MIGRATION',
  'TRANSCRIPT',
  'TRANSFER_CERTIFICATE',
  'GRADE_CARD',
  'MARKSHEET',
  'CHARACTER_CERTIFICATE',
  'TESTIMONIAL',
  'OTHER',
] as const;

export const PORTAL_PAYMENT_METHODS = ['CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE'] as const;

export const PORTAL_TICKET_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT', 'CRITICAL'] as const;

export class PortalPaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  take?: number;
}

/** Editable subset of the Student profile. Contact/address fields only — identity, admission
 *  numbers, program placement and status are registrar-controlled. */
export class UpdatePortalProfileDto {
  @IsOptional() @IsString() email?: string;
  @IsOptional() @IsString() alternateEmail?: string;
  @IsOptional() @IsString() primaryPhone?: string;
  @IsOptional() @IsString() alternatePhone?: string;
  @IsOptional() @IsString() currentAddressLine1?: string;
  @IsOptional() @IsString() currentAddressLine2?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() @IsString() state?: string;
  @IsOptional() @IsString() postalCode?: string;
  @IsOptional() @IsString() country?: string;
  @IsOptional() @IsString() permanentAddressLine1?: string;
  @IsOptional() @IsString() permanentAddressLine2?: string;
  @IsOptional() @IsString() permanentCity?: string;
  @IsOptional() @IsString() permanentState?: string;
  @IsOptional() @IsString() permanentPostalCode?: string;
  @IsOptional() @IsString() permanentCountry?: string;
  @IsOptional() @IsString() profilePhotoKey?: string;
}

export class CreateCertificateRequestDto {
  @IsIn(PORTAL_CERTIFICATE_TYPES)
  certificateType!: (typeof PORTAL_CERTIFICATE_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsUUID()
  templateId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remarks?: string;
}

export class CreatePortalTicketDto {
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
  @IsIn(PORTAL_TICKET_PRIORITIES)
  priority?: (typeof PORTAL_TICKET_PRIORITIES)[number];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  attachmentDocumentIds?: string[];
}

export class AddPortalTicketCommentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body!: string;
}

export class CreatePortalPaymentDto {
  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsIn(PORTAL_PAYMENT_METHODS)
  method!: (typeof PORTAL_PAYMENT_METHODS)[number];

  @IsOptional()
  @IsUUID()
  demandId?: string;

  @IsOptional()
  @IsUUID()
  studentFeeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  referenceNumber?: string;

  /** Caller-supplied dedupe token so a double-tap on "Pay now" cannot double-charge. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  remarks?: string;
}

export class PortalUploadUrlDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  mimeType!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsUUID()
  documentTypeId?: string;
}

export class PortalConfirmUploadDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}

export class PortalDocumentQueryDto extends PortalPaginationDto {
  @IsOptional()
  @IsString()
  search?: string;
}

export class PortalAttendanceQueryDto extends PortalPaginationDto {
  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsIn(['PRESENT', 'ABSENT', 'LATE', 'LEAVE'])
  status?: string;

  @IsOptional()
  @IsString()
  dateFrom?: string;

  @IsOptional()
  @IsString()
  dateTo?: string;
}

export class PortalNoticesQueryDto extends PortalPaginationDto {
  @IsOptional()
  @Type(() => Boolean)
  unreadOnly?: boolean;
}

export class PortalTicketQueryDto extends PortalPaginationDto {
  @IsOptional()
  @IsIn(['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED'])
  status?: string;
}

export class PortalTicketFeedbackDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  score!: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
