import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export const STUDENT_STATUSES = [
  'APPLICANT',
  'ADMITTED',
  'PROVISIONAL',
  'ENROLLED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'WITHDRAWN',
  'GRADUATED',
  'ALUMNI',
] as const;

export type StudentStatusValue = (typeof STUDENT_STATUSES)[number];

export const STUDENT_GENDERS = ['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED'] as const;

export const BLOOD_GROUPS = [
  'A_POSITIVE',
  'A_NEGATIVE',
  'B_POSITIVE',
  'B_NEGATIVE',
  'AB_POSITIVE',
  'AB_NEGATIVE',
  'O_POSITIVE',
  'O_NEGATIVE',
  'UNKNOWN',
] as const;

export const STUDENT_SORT_KEYS = ['createdAt', 'fullName', 'admissionNumber', 'yearOfAdmission'] as const;
export const STUDENT_SORT_ORDERS = ['asc', 'desc'] as const;

/** Required base fields shared by create and update. */
export class StudentBaseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  userId?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  admissionNumber?: string;

  @IsOptional()
  @IsString()
  rollNumber?: string;

  @IsOptional()
  @IsString()
  registrationNumber?: string;

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
  @IsIn(BLOOD_GROUPS)
  bloodGroup?: (typeof BLOOD_GROUPS)[number];

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsString()
  nationality?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  alternateEmail?: string;

  @IsOptional()
  @IsString()
  primaryPhone?: string;

  @IsOptional()
  @IsString()
  alternatePhone?: string;

  @IsOptional()
  @IsString()
  currentAddressLine1?: string;

  @IsOptional()
  @IsString()
  currentAddressLine2?: string;

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
  @IsString()
  permanentAddressLine1?: string;

  @IsOptional()
  @IsString()
  permanentAddressLine2?: string;

  @IsOptional()
  @IsString()
  permanentCity?: string;

  @IsOptional()
  @IsString()
  permanentState?: string;

  @IsOptional()
  @IsString()
  permanentPostalCode?: string;

  @IsOptional()
  @IsString()
  permanentCountry?: string;

  @IsOptional()
  @IsString()
  profilePhotoKey?: string;
}

export class CreateStudentDto extends StudentBaseDto {
  @IsString()
  @IsNotEmpty()
  campusId: string;

  @IsOptional()
  @IsIn(STUDENT_STATUSES)
  status?: StudentStatusValue;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsDateString()
  admittedOn?: string;

  @IsOptional()
  @IsInt()
  yearOfAdmission?: number;
}

export class UpdateStudentDto extends StudentBaseDto {
  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsDateString()
  admittedOn?: string;

  @IsOptional()
  @IsInt()
  yearOfAdmission?: number;
}

/** Shared list/filter/pagination query. `status` accepts a comma-separated list. */
export class ListStudentQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsInt()
  yearOfAdmission?: number;

  @IsOptional()
  @IsIn(STUDENT_SORT_KEYS)
  sortBy?: (typeof STUDENT_SORT_KEYS)[number];

  @IsOptional()
  @IsIn(STUDENT_SORT_ORDERS)
  sortOrder?: (typeof STUDENT_SORT_ORDERS)[number];

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

export class StudentStatusChangeDto {
  @IsIn(STUDENT_STATUSES)
  status: StudentStatusValue;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class VerifyStudentQueryDto {
  @IsString()
  @IsNotEmpty()
  admissionNumber: string;

  @IsOptional()
  @IsString()
  excludeId?: string;
}

export const BULK_STUDENT_ACTIONS = ['archive', 'restore', 'status_change'] as const;

export class BulkStudentDto {
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  ids: string[];

  @IsIn(BULK_STUDENT_ACTIONS)
  action: (typeof BULK_STUDENT_ACTIONS)[number];

  @IsOptional()
  @IsIn(STUDENT_STATUSES)
  status?: StudentStatusValue;

  @IsOptional()
  @IsString()
  reason?: string;
}