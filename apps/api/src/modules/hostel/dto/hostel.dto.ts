/**
 * Hostel module DTOs. Follows the exams/library convention: class-validator + Swagger,
 * stringly-typed enums validated with IsIn against exported constants (no native enum over the
 * wire).
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

// ── Closed taxonomies (mirror of the Prisma enums) ─────────────────────────

export const HOSTEL_GENDER_TYPES = ['BOYS', 'GIRLS', 'COED'] as const;
export const HOSTEL_ROOM_SHARING = ['SINGLE', 'DOUBLE', 'TRIPLE', 'FOUR', 'DORM'] as const;
export const HOSTEL_BED_STATUSES = ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'] as const;
export const HOSTEL_WARDEN_ROLES = ['WARDEN', 'ASSISTANT'] as const;
export const HOSTEL_COMPLAINT_CATEGORIES = [
  'MAINTENANCE',
  'ELECTRICAL',
  'PLUMBING',
  'CLEANING',
  'INFRASTRUCTURE',
  'NOISE',
  'FOOD',
  'SECURITY',
  'OTHER',
] as const;
export const HOSTEL_COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] as const;
export const HOSTEL_VISITOR_STATUSES = ['INSIDE', 'EXITED'] as const;
export const HOSTEL_BOOKING_STATUSES = ['REQUESTED', 'ALLOCATED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'] as const;
export const HOSTEL_FEE_STATUSES = ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED'] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class HostelPaginationDto {
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

// ── Hostels ─────────────────────────────────────────────────────────────────

export class CreateHostelDto {
  @IsString()
  @IsNotEmpty()
  campusId: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsIn(HOSTEL_GENDER_TYPES)
  genderType?: string;

  @IsOptional()
  @IsString()
  wardenUserId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  feeHeadId?: string;

  @IsOptional()
  @IsBoolean()
  chargeRentOnCheckIn?: boolean;
}

export class UpdateHostelDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsIn(HOSTEL_GENDER_TYPES)
  genderType?: string;

  @IsOptional()
  @IsString()
  wardenUserId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  feeHeadId?: string;

  @IsOptional()
  @IsBoolean()
  chargeRentOnCheckIn?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListHostelsQueryDto {
  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsBoolean()
  includeInactive?: boolean;
}

// ── Buildings / floors / rooms / beds ───────────────────────────────────────

export class CreateHostelBuildingDto {
  @IsString()
  @IsNotEmpty()
  hostelId: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class UpdateHostelBuildingDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateHostelFloorDto {
  @IsString()
  @IsNotEmpty()
  buildingId: string;

  @Type(() => Number)
  @IsInt()
  floorNumber: number;

  @IsOptional()
  @IsString()
  name?: string;
}

export class UpdateHostelFloorDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  floorNumber?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateHostelRoomDto {
  @IsString()
  @IsNotEmpty()
  floorId: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(HOSTEL_ROOM_SHARING)
  sharing?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedCapacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsBoolean()
  hasAttachedBath?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateHostelRoomDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsIn(HOSTEL_ROOM_SHARING)
  sharing?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  bedCapacity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsBoolean()
  hasAttachedBath?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class AddHostelBedsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  codes?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsIn(HOSTEL_BED_STATUSES)
  status?: string;
}

export class UpdateHostelBedDto {
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class SetHostelBedStatusDto {
  @IsIn(HOSTEL_BED_STATUSES)
  status: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

// ── Wardens ─────────────────────────────────────────────────────────────────

export class AssignHostelWardenDto {
  @IsString()
  @IsNotEmpty()
  hostelId: string;

  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsIn(HOSTEL_WARDEN_ROLES)
  role: string;
}

export class UpdateHostelWardenDto {
  @IsOptional()
  @IsIn(HOSTEL_WARDEN_ROLES)
  role?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Bookings ─────────────────────────────────────────────────────────────────

export class CreateHostelBookingDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  bedId: string;

  @IsOptional()
  @IsIn(HOSTEL_BOOKING_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  allocationDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateHostelBookingDto {
  @IsOptional()
  @IsIn(HOSTEL_BOOKING_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  allocationDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class AllocateHostelBookingDto {
  @IsOptional()
  @IsDateString()
  allocationDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CheckInHostelBookingDto {
  @IsOptional()
  @IsDateString()
  checkInDate?: string;

  @IsOptional()
  @IsBoolean()
  chargeFirstMonth?: boolean;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CheckOutHostelBookingDto {
  @IsOptional()
  @IsDateString()
  checkOutDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class TransferHostelBookingDto {
  @IsString()
  @IsNotEmpty()
  bedId: string;

  @IsOptional()
  @IsDateString()
  transferDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  monthlyRentCents?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class CancelHostelBookingDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ListHostelBookingsQueryDto {
  @IsOptional()
  @IsString()
  hostelId?: string;

  @IsOptional()
  @IsString()
  bedId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsIn(HOSTEL_BOOKING_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;

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
}

// ── Rent charges ────────────────────────────────────────────────────────────

export class CreateHostelChargeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  monthCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  amountCents?: number;

  @IsOptional()
  @IsDateString()
  periodStart?: string;

  @IsOptional()
  @IsDateString()
  periodEnd?: string;

  @IsOptional()
  @IsString()
  headCode?: string;

  @IsOptional()
  @IsString()
  headName?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class WaiveHostelChargeDto {
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListHostelChargesQueryDto {
  @IsOptional()
  @IsString()
  hostelId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsIn(HOSTEL_FEE_STATUSES)
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
  @Max(200)
  take?: number;
}

// ── Complaints ──────────────────────────────────────────────────────────────

export class CreateHostelComplaintDto {
  @IsString()
  @IsNotEmpty()
  hostelId: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsIn(HOSTEL_COMPLAINT_CATEGORIES)
  category: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;

  @IsString()
  @IsNotEmpty()
  subject: string;

  @IsString()
  @IsNotEmpty()
  description: string;
}

export class UpdateHostelComplaintDto {
  @IsOptional()
  @IsIn(HOSTEL_COMPLAINT_CATEGORIES)
  category?: string;

  @IsOptional()
  @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT'])
  priority?: string;

  @IsOptional()
  @IsString()
  subject?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  roomId?: string;
}

export class AssignHostelComplaintDto {
  @IsString()
  @IsNotEmpty()
  assignedToUserId: string;
}

export class ResolveHostelComplaintDto {
  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}

export class CloseHostelComplaintDto {
  @IsOptional()
  @IsString()
  resolutionNotes?: string;
}

export class ListHostelComplaintsQueryDto {
  @IsOptional()
  @IsString()
  hostelId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsIn(HOSTEL_COMPLAINT_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(HOSTEL_COMPLAINT_CATEGORIES)
  category?: string;

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
}

// ── Visitors ────────────────────────────────────────────────────────────────

export class CreateHostelVisitorDto {
  @IsString()
  @IsNotEmpty()
  hostelId: string;

  @IsString()
  @IsNotEmpty()
  visitorName: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  idProofType?: string;

  @IsOptional()
  @IsString()
  idProofNumber?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  visitorLabel?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateHostelVisitorDto {
  @IsOptional()
  @IsString()
  visitorName?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CheckOutHostelVisitorDto {
  @IsOptional()
  @IsDateString()
  checkOutAt?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListHostelVisitorsQueryDto {
  @IsOptional()
  @IsString()
  hostelId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsIn(HOSTEL_VISITOR_STATUSES)
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
  @Max(200)
  take?: number;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export class OccupancyReportQueryDto {
  @IsOptional()
  @IsString()
  hostelId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;
}

export class VacancyReportQueryDto {
  @IsOptional()
  @IsString()
  hostelId?: string;

  @IsOptional()
  @IsString()
  buildingId?: string;
}

export class RoomHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

export class StudentHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  take?: number;
}

export class HostelDuesQueryDto {
  @IsOptional()
  @IsString()
  hostelId?: string;

  @IsOptional()
  @IsIn(['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'])
  status?: string; // only open states by default
}

export class ComplaintsReportQueryDto {
  @IsOptional()
  @IsString()
  hostelId?: string;
}