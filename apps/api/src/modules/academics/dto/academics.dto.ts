/**
 * Academics DTOs. Mirrors the students/admissions module convention: class-validator + Swagger
 * decorators, stringly-typed enums (validated with IsIn against the exported constants) so the
 * tenant stack stays config-compatible (no native enum shipped over the wire).
 */
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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

// ── Closed taxonomies (mirror of the Prisma enums) ─────────────────────────

export const COURSE_TYPES = [
  'CORE',
  'ELECTIVE',
  'OPEN_ELECTIVE',
  'LABORATORY',
  'PROJECT',
  'INTERNSHIP',
  'MINOR',
  'OTHER',
] as const;
export const CURRICULUM_VERSION_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export const COURSE_OFFERING_STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED', 'CANCELLED', 'COMPLETED'] as const;
export const FACULTY_ASSIGNMENT_ROLES = ['PRIMARY', 'CO_TEACHER', 'ASSISTANT'] as const;
export const COURSE_REGISTRATION_STATUSES = [
  'REGISTERED',
  'CONFIRMED',
  'WAITLISTED',
  'WITHDRAWN',
  'DROPPED',
  'COMPLETED',
] as const;
export const ADVISING_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const ADVISING_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
export const PROGRESSION_STATUSES = [
  'CONTINUING',
  'PROMOTED',
  'REAPPEARING',
  'DETAINED',
  'GRADUATED',
  'WITHDRAWN',
] as const;
export const BACKLOG_STATUSES = ['OPEN', 'CLEARED', 'EXEMPTED'] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class AcademicsPaginationDto {
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

// ── Course catalog ──────────────────────────────────────────────────────────

export class CreateCourseDto {
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
  @IsInt()
  @Min(0)
  @Max(30)
  creditHours?: number;

  @IsOptional()
  @IsIn(COURSE_TYPES)
  courseType?: string;

  @IsOptional()
  @IsString()
  gradingBasis?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;
}

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  creditHours?: number;

  @IsOptional()
  @IsIn(COURSE_TYPES)
  courseType?: string;

  @IsOptional()
  @IsString()
  gradingBasis?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListCoursesQueryDto extends AcademicsPaginationDto {
  @IsOptional()
  @IsIn(COURSE_TYPES)
  courseType?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;
}

export class AddPrerequisiteDto {
  @IsString()
  @IsNotEmpty()
  requiredCourseId: string;

  @IsOptional()
  @IsString()
  minGrade?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

// ── Curricula & versions ────────────────────────────────────────────────────

export class CreateCurriculumDto {
  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateCurriculumDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListCurriculaQueryDto extends AcademicsPaginationDto {
  @IsOptional()
  @IsString()
  programId?: string;
}

export class CreateCurriculumVersionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  minTotalCredits?: number;
}

export class UpdateCurriculumVersionDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  effectiveFrom?: string;

  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  minTotalCredits?: number;
}

export class CurriculumCourseInputDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsInt()
  @Min(1)
  @Max(16)
  semester: number;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  isCompulsory?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sequence?: number;

  @IsOptional()
  @IsString()
  minGrade?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(30)
  creditOverride?: number;
}

export class SetCurriculumCoursesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CurriculumCourseInputDto)
  courses: CurriculumCourseInputDto[];
}

// ── Course offerings ────────────────────────────────────────────────────────

export class CreateCourseOfferingDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  termId: string;

  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  creditHours?: number;

  @IsOptional()
  @IsIn(COURSE_OFFERING_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  waitlistCapacity?: number;

  @IsOptional()
  @IsDateString()
  enrollmentStartAt?: string;

  @IsOptional()
  @IsDateString()
  enrollmentEndAt?: string;

  @IsOptional()
  @IsObject()
  schedule?: Record<string, unknown>;
}

export class UpdateCourseOfferingDto {
  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsString()
  campusId?: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  creditHours?: number;

  @IsOptional()
  @IsIn(COURSE_OFFERING_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  mode?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  waitlistCapacity?: number;

  @IsOptional()
  @IsDateString()
  enrollmentStartAt?: string;

  @IsOptional()
  @IsDateString()
  enrollmentEndAt?: string;

  @IsOptional()
  @IsObject()
  schedule?: Record<string, unknown>;
}

export class ListCourseOfferingsQueryDto extends AcademicsPaginationDto {
  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsIn(COURSE_OFFERING_STATUSES)
  status?: string;
}

export class AssignFacultyDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsIn(FACULTY_ASSIGNMENT_ROLES)
  role?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  allocationPercent?: number;
}

export class UpdateFacultyAssignmentDto {
  @IsOptional()
  @IsIn(FACULTY_ASSIGNMENT_ROLES)
  role?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  allocationPercent?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

// ── Course registration ─────────────────────────────────────────────────────

export class CreateCourseRegistrationDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  courseOfferingId: string;
}

export class UpdateCourseRegistrationDto {
  @IsIn(['CONFIRMED', 'WITHDRAWN', 'DROPPED', 'COMPLETED'])
  status: string;

  @IsOptional()
  @IsString()
  dropReason?: string;
}

export class BulkRegisterDto {
  @IsString()
  @IsNotEmpty()
  courseOfferingId: string;

  @IsOptional()
  @IsString()
  sectionId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studentIds?: string[];
}

export class ListCourseRegistrationsQueryDto extends AcademicsPaginationDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  courseOfferingId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsIn(COURSE_REGISTRATION_STATUSES)
  status?: string;
}

export class RegistrationReportQueryDto {
  @IsString()
  @IsNotEmpty()
  termId: string;

  @IsOptional()
  @IsString()
  programId?: string;
}

// ── Academic advising ───────────────────────────────────────────────────────

export class CreateAdvisingRecordDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  advisorUserId: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  sessionType?: string;

  @IsString()
  @IsNotEmpty()
  summary: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsString()
  actionItems?: string;

  @IsOptional()
  @IsIn(ADVISING_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsDateString()
  followUpAt?: string;
}

export class UpdateAdvisingRecordDto {
  @IsOptional()
  @IsString()
  sessionType?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  summary?: string;

  @IsOptional()
  @IsString()
  details?: string;

  @IsOptional()
  @IsString()
  actionItems?: string;

  @IsOptional()
  @IsIn(ADVISING_PRIORITIES)
  priority?: string;

  @IsOptional()
  @IsIn(['OPEN', 'IN_PROGRESS', 'CANCELLED'])
  status?: string;

  @IsOptional()
  @IsDateString()
  followUpAt?: string;
}

export class ListAdvisingQueryDto extends AcademicsPaginationDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  advisorUserId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsIn(ADVISING_STATUSES)
  status?: string;
}

// ── Academic progression / promotion ────────────────────────────────────────

export class CreateProgressionRecordDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsInt()
  @Min(1)
  @Max(16)
  fromSemester: number;

  @IsInt()
  @Min(1)
  @Max(16)
  toSemester: number;

  @IsIn(PROGRESSION_STATUSES)
  status: string;

  @IsOptional()
  @IsInt()
  creditsEarned?: number;

  @IsOptional()
  @IsInt()
  creditsRequired?: number;

  @IsOptional()
  @IsNumber()
  gpaScore?: number;

  @IsOptional()
  @IsInt()
  backlogOpen?: number;

  @IsOptional()
  @IsInt()
  backlogCleared?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class PromoteBatchDto {
  @IsString()
  @IsNotEmpty()
  batchId: string;

  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsInt()
  @Min(2)
  @Max(16)
  toSemester: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(16)
  fromSemester?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  backlogThreshold?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ListProgressionQueryDto extends AcademicsPaginationDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsString()
  batchId?: string;

  @IsOptional()
  @IsIn(PROGRESSION_STATUSES)
  status?: string;
}

// ── Backlogs ────────────────────────────────────────────────────────────────

export class CreateBacklogDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsString()
  @IsNotEmpty()
  termId: string;

  @IsOptional()
  @IsString()
  registrationId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateBacklogDto {
  @IsOptional()
  @IsString()
  remarks?: string;

  @IsOptional()
  @IsString()
  registrationId?: string;
}

export class ClearBacklogsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  backlogIds?: string[];

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  clearedInRegistrationId?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class ListBacklogsQueryDto extends AcademicsPaginationDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  courseId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsIn(BACKLOG_STATUSES)
  status?: string;
}

// ── Academic calendar ───────────────────────────────────────────────────────

export class CreateCalendarEventDto {
  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsDateString()
  startAt: string;

  @IsDateString()
  endAt: string;

  @IsOptional()
  @IsString()
  appliesTo?: string;

  @IsOptional()
  @IsString()
  color?: string;
}

export class UpdateCalendarEventDto {
  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  startAt?: string;

  @IsOptional()
  @IsDateString()
  endAt?: string;

  @IsOptional()
  @IsString()
  appliesTo?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class PublishCalendarDto {
  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  eventIds?: string[];
}

export class ListCalendarEventQueryDto extends AcademicsPaginationDto {
  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsBoolean()
  publishedOnly?: boolean;
}