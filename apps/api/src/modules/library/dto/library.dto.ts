/**
 * Library module DTOs. Follows the exams convention: class-validator + Swagger, stringly-typed
 * enums validated with IsIn against exported constants (no native enum over the wire).
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

export const LIBRARY_MEMBER_TYPES = ['STUDENT', 'FACULTY', 'STAFF', 'OTHER'] as const;
export const LIBRARY_MEMBER_STATUSES = ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export const LIBRARY_COPY_STATUSES = ['AVAILABLE', 'ISSUED', 'RESERVED', 'LOST', 'DAMAGED', 'WITHDRAWN'] as const;
export const LIBRARY_COPY_CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'POOR', 'DAMAGED'] as const;
export const LIBRARY_RESERVATION_STATUSES = ['WAITING', 'READY', 'FULFILLED', 'CANCELLED', 'EXPIRED'] as const;
export const LIBRARY_FINE_TYPES = ['OVERDUE', 'LOST', 'DAMAGE', 'OTHER'] as const;
export const LIBRARY_FINE_STATUSES = ['PENDING', 'PAID', 'WAIVED'] as const;
export const LIBRARY_LOAN_STATUSES = ['ISSUED', 'RETURNED', 'OVERDUE', 'LOST'] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class LibraryPaginationDto {
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

// ── Catalog: categories / publishers / authors ──────────────────────────────

export class CreateLibraryCategoryDto {
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
  @IsString()
  parentId?: string;
}

export class UpdateLibraryCategoryDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  parentId?: string;
}

export class CreateLibraryPublisherDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;
}

export class UpdateLibraryPublisherDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  addressLine?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  website?: string;
}

export class CreateLibraryAuthorDto {
  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}

export class UpdateLibraryAuthorDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @IsString()
  bio?: string;
}

// ── Books ───────────────────────────────────────────────────────────────────

export class CreateLibraryBookDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  edition?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pageCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  publicationYear?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  coverStorageKey?: string;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsOptional()
  @IsString()
  publisherId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  replacementCostCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  maxLoanDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authorIds?: string[];
}

export class UpdateLibraryBookDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  isbn?: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsString()
  edition?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  pageCount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  publicationYear?: number;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  coverStorageKey?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  publisherId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  replacementCostCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  maxLoanDays?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  authorIds?: string[];
}

export class ListBooksQueryDto extends LibraryPaginationDto {
  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  publisherId?: string;

  @IsOptional()
  @IsString()
  authorId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Copies ──────────────────────────────────────────────────────────────────

export class AddLibraryCopiesDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  barcode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  accessionNumber?: string;

  @IsOptional()
  @IsString()
  shelfLocation?: string;

  @IsOptional()
  @IsString()
  acquisitionType?: string;

  @IsOptional()
  @IsDateString()
  acquisitionDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  purchasePriceCents?: number;

  @IsOptional()
  @IsIn(LIBRARY_COPY_CONDITIONS)
  condition?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  /** Number of physical copies to add in one go (barcode/accession numbers auto-assigned). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  count?: number;
}

export class UpdateLibraryCopyDto {
  @IsOptional()
  @IsString()
  shelfLocation?: string;

  @IsOptional()
  @IsIn(LIBRARY_COPY_CONDITIONS)
  condition?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SetLibraryCopyStatusDto {
  @IsIn(LIBRARY_COPY_STATUSES)
  status: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class ListCopiesQueryDto extends LibraryPaginationDto {
  @IsOptional()
  @IsString()
  bookId?: string;

  @IsOptional()
  @IsIn(LIBRARY_COPY_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(LIBRARY_COPY_CONDITIONS)
  condition?: string;
}

// ── Members ─────────────────────────────────────────────────────────────────

export class CreateLibraryMemberDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  memberNumber?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(LIBRARY_MEMBER_TYPES)
  memberType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxLoans?: number;

  @IsOptional()
  @IsDateString()
  membershipStart?: string;

  @IsOptional()
  @IsDateString()
  membershipEnd?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class UpdateLibraryMemberDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  fullName?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsIn(LIBRARY_MEMBER_TYPES)
  memberType?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxLoans?: number;

  @IsOptional()
  @IsDateString()
  membershipStart?: string;

  @IsOptional()
  @IsDateString()
  membershipEnd?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class SetLibraryMemberStatusDto {
  @IsIn(LIBRARY_MEMBER_STATUSES)
  status: string;
}

export class ListMembersQueryDto extends LibraryPaginationDto {
  @IsOptional()
  @IsIn(LIBRARY_MEMBER_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(LIBRARY_MEMBER_TYPES)
  memberType?: string;

  @IsOptional()
  @IsString()
  studentId?: string;
}

// ── Circulation: loans ──────────────────────────────────────────────────────

export class IssueLoanDto {
  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsString()
  @IsNotEmpty()
  copyId: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class RenewLoanDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number;
}

export class ReturnLoanDto {
  @IsOptional()
  @IsDateString()
  returnedAt?: string;

  /** Physical state the copy came back in — 'GOOD' | 'DAMAGED' | ... (tenant vocabulary). */
  @IsOptional()
  @IsString()
  condition?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class MarkLoanLostDto {
  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ListLoansQueryDto extends LibraryPaginationDto {
  @IsOptional()
  @IsIn(LIBRARY_LOAN_STATUSES)
  status?: string;

  @IsOptional()
  @IsBoolean()
  overdueOnly?: boolean;

  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  copyId?: string;
}

// ── Reservations ────────────────────────────────────────────────────────────

export class CreateReservationDto {
  @IsString()
  @IsNotEmpty()
  bookId: string;

  @IsString()
  @IsNotEmpty()
  memberId: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CancelReservationDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

export class AssignReservationCopyDto {
  @IsString()
  @IsNotEmpty()
  copyId: string;
}

export class ListReservationsQueryDto extends LibraryPaginationDto {
  @IsOptional()
  @IsIn(LIBRARY_RESERVATION_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  memberId?: string;

  @IsOptional()
  @IsString()
  bookId?: string;
}

// ── Fines ───────────────────────────────────────────────────────────────────

export class PayFineDto {
  /** Partial payment amount in cents — omit or leave null to settle the full balance. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  amountCents?: number;
}

export class WaiveFineDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ListFinesQueryDto extends LibraryPaginationDto {
  @IsOptional()
  @IsIn(LIBRARY_FINE_STATUSES)
  status?: string;

  @IsOptional()
  @IsIn(LIBRARY_FINE_TYPES)
  type?: string;

  @IsOptional()
  @IsString()
  memberId?: string;
}

// ── Transactions / inventory history ────────────────────────────────────────

export class ListTransactionsQueryDto extends LibraryPaginationDto {
  @IsOptional()
  @IsString()
  copyId?: string;
}

// ── Config ──────────────────────────────────────────────────────────────────

export class UpdateLibraryConfigDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  defaultLoanDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxLoansPerMember?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(20)
  renewalLimit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  overdueFinePerDayCents?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(30)
  reservationHoldDays?: number;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export class CirculationReportDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  days?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}