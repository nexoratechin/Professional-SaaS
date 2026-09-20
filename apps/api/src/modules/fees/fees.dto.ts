import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsISO8601,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import type {
  FeeAssignmentStatus,
  FeeConcessionBasis,
  FeeConcessionKind,
  FeeConcessionStatus,
  FeeHeadFrequency,
  FeeRefundStatus,
  FeeStructureStatus,
  PaymentMethod,
} from '@college-erp/database';

const FEE_HEAD_FREQUENCIES: FeeHeadFrequency[] = ['ONE_TIME', 'PER_TERM', 'ANNUAL'];
const FEE_STRUCTURE_STATUSES: FeeStructureStatus[] = ['DRAFT', 'ACTIVE', 'ARCHIVED'];
const FEE_ASSIGNMENT_STATUSES: FeeAssignmentStatus[] = ['ACTIVE', 'COMPLETED', 'REVOKED'];
const CONCESSION_KINDS: FeeConcessionKind[] = ['SCHOLARSHIP', 'CONCESSION', 'WAIVER'];
const CONCESSION_BASES: FeeConcessionBasis[] = ['FLAT', 'PERCENT'];
const CONCESSION_STATUSES: FeeConcessionStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'REVOKED'];
const REFUND_STATUSES: FeeRefundStatus[] = ['REQUESTED', 'APPROVED', 'PROCESSED', 'REJECTED'];
const PAYMENT_METHODS: PaymentMethod[] = ['CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE'];
const DEMAND_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED'] as const;

// ── Fee heads ───────────────────────────────────────────────────────────────

export class CreateFeeHeadDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsIn(FEE_HEAD_FREQUENCIES)
  frequency!: FeeHeadFrequency;

  @IsInt()
  @Min(0)
  defaultAmountCents!: number;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @IsOptional()
  @IsBoolean()
  isRefundable?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateFeeHeadDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(FEE_HEAD_FREQUENCIES)
  frequency?: FeeHeadFrequency;

  @IsOptional()
  @IsInt()
  @Min(0)
  defaultAmountCents?: number;

  @IsOptional()
  @IsBoolean()
  isOptional?: boolean;

  @IsOptional()
  @IsBoolean()
  isRefundable?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  description?: string;
}

export class ListFeeHeadQueryDto {
  @IsOptional()
  @IsBoolean()
  includeArchived?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

// ── Fee structures ──────────────────────────────────────────────────────────

export class FeeStructureLineDto {
  @IsUUID()
  headId!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class CreateFeeStructureDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24)
  installmentCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  dueDayOffset?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  installmentGapDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20000)
  lateFeePercentBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lateFeeFlatCents?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  lateFeeGraceDays?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeeStructureLineDto)
  lines?: FeeStructureLineDto[];
}

export class UpdateFeeStructureDto extends CreateFeeStructureDto {}

export class PreviewStructureDto {
  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;
}

export class ListFeeStructureQueryDto {
  @IsOptional()
  @IsIn(FEE_STRUCTURE_STATUSES)
  status?: FeeStructureStatus;

  @IsOptional()
  @IsUUID()
  academicYearId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

// ── Assignments ─────────────────────────────────────────────────────────────

export class CreateFeeAssignmentDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  structureId!: string;

  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsISO8601()
  effectiveDate?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListFeeAssignmentQueryDto {
  @IsOptional()
  @IsIn(FEE_ASSIGNMENT_STATUSES)
  status?: FeeAssignmentStatus;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  structureId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

// ── Demands ─────────────────────────────────────────────────────────────────

export class ListFeeDemandQueryDto {
  @IsOptional()
  @IsIn(DEMAND_STATUSES)
  status?: (typeof DEMAND_STATUSES)[number];

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  assignmentId?: string;

  @IsOptional()
  @IsISO8601()
  dueFrom?: string;

  @IsOptional()
  @IsISO8601()
  dueTo?: string;

  @IsOptional()
  @IsBoolean()
  outstandingOnly?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

export class AccrueLateFeeDto {
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  demandIds?: string[];
}

// ── Payments ────────────────────────────────────────────────────────────────

export class RecordFeePaymentDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsUUID()
  studentFeeId?: string;

  @IsOptional()
  @IsUUID()
  demandId?: string;

  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @IsOptional()
  @IsISO8601()
  paymentDate?: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ListFeePaymentQueryDto {
  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  demandId?: string;

  @IsOptional()
  @IsIn(['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'])
  status?: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED';

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  method?: PaymentMethod;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

// ── Concessions ─────────────────────────────────────────────────────────────

export class CreateFeeConcessionDto {
  @IsUUID()
  studentId!: string;

  @IsOptional()
  @IsUUID()
  demandId?: string;

  @IsOptional()
  @IsUUID()
  studentFeeId?: string;

  @IsOptional()
  @IsUUID()
  headId?: string;

  @IsIn(CONCESSION_KINDS)
  kind!: FeeConcessionKind;

  @IsIn(CONCESSION_BASES)
  basis!: FeeConcessionBasis;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  percentBps?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsString()
  reason!: string;
}

export class DecideConcessionDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ListFeeConcessionQueryDto {
  @IsOptional()
  @IsIn(CONCESSION_STATUSES)
  status?: FeeConcessionStatus;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

// ── Refunds ─────────────────────────────────────────────────────────────────

export class CreateFeeRefundDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  paymentId!: string;

  @IsInt()
  @Min(1)
  amountCents!: number;

  @IsIn(PAYMENT_METHODS)
  method!: PaymentMethod;

  @IsString()
  reason!: string;
}

export class DecideRefundDto {
  @IsBoolean()
  approve!: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ProcessRefundDto {
  @IsOptional()
  @IsString()
  referenceNumber?: string;
}

export class ListFeeRefundQueryDto {
  @IsOptional()
  @IsIn(REFUND_STATUSES)
  status?: FeeRefundStatus;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export class OutstandingReportQueryDto {
  @IsOptional()
  @IsUUID()
  programId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsBoolean()
  overdueOnly?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  take?: number;
}

export class CollectionsReportQueryDto {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class DemandStatusReportQueryDto {
  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsUUID()
  programId?: string;
}