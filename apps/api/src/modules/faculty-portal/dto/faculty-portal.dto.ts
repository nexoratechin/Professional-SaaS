/**
 * Faculty Portal DTOs. Every query is anchored either to the caller's own Employee row or to a
 * course offering they are assigned to (validated in FacultyPortalService) — there is no
 * `employeeId` input anywhere, mirroring the student/parent portals' self-service design.
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export const FACULTY_ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const;
export const FACULTY_MARK_METHODS = ['MANUAL', 'QR', 'BIOMETRIC'] as const;
export const FACULTY_MARKS_STATUSES = ['DRAFT', 'SUBMITTED', 'MODERATED', 'APPROVED'] as const;
export const FACULTY_HALF_DAY_OPTIONS = ['FIRST_HALF', 'SECOND_HALF'] as const;

const MAX_PAGE = 200;

export class FacultyPaginationDto {
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

// ── Profile ─────────────────────────────────────────────────────────────────

export class UpdateFacultyProfileDto {
  @IsOptional()
  @IsString()
  honorific?: string | null;

  @IsOptional()
  @IsString()
  phone?: string | null;

  @IsOptional()
  @IsString()
  alternatePhone?: string | null;

  @IsOptional()
  @IsString()
  personalEmail?: string | null;

  @IsOptional()
  @IsString()
  addressLine1?: string | null;

  @IsOptional()
  @IsString()
  addressLine2?: string | null;

  @IsOptional()
  @IsString()
  city?: string | null;

  @IsOptional()
  @IsString()
  state?: string | null;

  @IsOptional()
  @IsString()
  postalCode?: string | null;

  @IsOptional()
  @IsString()
  country?: string | null;

  @IsOptional()
  @IsString()
  emergencyContactName?: string | null;

  @IsOptional()
  @IsString()
  emergencyContactPhone?: string | null;

  @IsOptional()
  @IsString()
  emergencyContactRelation?: string | null;

  @IsOptional()
  @IsString()
  qualification?: string | null;

  @IsOptional()
  @IsString()
  specialization?: string | null;

  @IsOptional()
  @IsString()
  profilePhotoKey?: string | null;
}

// ── Courses & students ──────────────────────────────────────────────────────

export class FacultyStudentsQueryDto extends FacultyPaginationDto {
  @IsOptional()
  @IsUUID()
  courseOfferingId?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

// ── Attendance ──────────────────────────────────────────────────────────────

export class FacultyAttendanceQueryDto extends FacultyPaginationDto {
  @IsOptional()
  @IsUUID()
  termId?: string;

  @IsOptional()
  @IsUUID()
  courseOfferingId?: string;

  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class FacultyCreateAttendanceSessionDto {
  @IsDateString()
  date: string;

  /** Required: the offering must be assigned to the caller (enforced in the service). */
  @IsUUID()
  courseOfferingId: string;

  @IsOptional()
  @IsUUID()
  timetableEntryId?: string;

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
  subjectCode?: string;

  @IsOptional()
  @IsString()
  subjectName?: string;

  @IsOptional()
  @IsIn(FACULTY_MARK_METHODS)
  markMethod?: string;
}

export class FacultyMarkEntryDto {
  @IsUUID()
  studentId: string;

  @IsIn(FACULTY_ATTENDANCE_STATUSES)
  status: (typeof FACULTY_ATTENDANCE_STATUSES)[number];

  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsDateString()
  signInAt?: string;
}

export class FacultyMarkAttendanceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacultyMarkEntryDto)
  entries: FacultyMarkEntryDto[];

  @IsOptional()
  @IsIn(FACULTY_MARK_METHODS)
  markMethod?: string;
}

export class FacultyAttendanceReportQueryDto {
  @IsOptional()
  @IsUUID()
  courseOfferingId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;
}

// ── Marks ───────────────────────────────────────────────────────────────────

export class FacultyMarksQueryDto extends FacultyPaginationDto {
  @IsOptional()
  @IsIn(FACULTY_MARKS_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  search?: string;
}

export class FacultyMarksEntryDto {
  @IsOptional()
  @IsUUID()
  registrationId?: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  marksObtained?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  graceMarks?: number;

  @IsOptional()
  @IsIn(FACULTY_ATTENDANCE_STATUSES)
  attendanceStatus?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class FacultyBulkMarksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FacultyMarksEntryDto)
  entries: FacultyMarksEntryDto[];
}

// ── Leave ───────────────────────────────────────────────────────────────────

export class FacultyLeaveApplicationDto {
  @IsUUID()
  leaveTypeId: string;

  @IsDateString()
  fromDate: string;

  @IsDateString()
  toDate: string;

  @IsOptional()
  @IsIn(FACULTY_HALF_DAY_OPTIONS)
  halfDayOption?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @Type(() => Number)
  @Min(0.5)
  durationDays?: number;
}

export class FacultyLeaveQueryDto extends FacultyPaginationDto {
  @IsOptional()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsUUID()
  leaveTypeId?: string;
}

// ── Notifications ───────────────────────────────────────────────────────────

export class FacultyNoticesQueryDto extends FacultyPaginationDto {
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;
}

// ── Reports ─────────────────────────────────────────────────────────────────

export class FacultyReportQueryDto {
  @IsOptional()
  @IsUUID()
  courseOfferingId?: string;

  @IsOptional()
  @IsUUID()
  termId?: string;
}
