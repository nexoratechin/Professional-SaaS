/**
 * Exams DTOs. Follows the academics/students convention: class-validator + Swagger, stringly-typed
 * enums (validated with IsIn against the exported constants) so the tenant stack stays
 * config-compatible (no native enum shipped over the wire).
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
  ValidateNested,
} from 'class-validator';

// ── Closed taxonomies (mirror of the Prisma enums) ─────────────────────────

export const EXAM_TYPES = ['MID_TERM', 'END_TERM', 'UNIT_TEST', 'PRACTICAL', 'VIVA', 'ANNUAL', 'SUPPLEMENTARY', 'OTHER'] as const;
export const EXAM_SESSION_STATUSES = ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'] as const;
export const EXAM_SUBJECT_STATUSES = ['DRAFT', 'PUBLISHED', 'COMPLETED'] as const;
export const EXAM_REGISTRATION_STATUSES = ['REGISTERED', 'CONFIRMED', 'CANCELLED'] as const;
export const EXAM_HALL_TICKET_STATUSES = ['PENDING', 'ISSUED'] as const;
export const EXAM_SEAT_ALLOCATION_STATUSES = ['ALLOCATED', 'PRESENT', 'ABSENT'] as const;
export const EXAM_INVIGILATOR_ROLES = ['CHIEF_INVIGILATOR', 'INVIGILATOR'] as const;
export const EXAM_ELIGIBILITY_RULE_TYPES = [
  'ACTIVE_STUDENT',
  'PROGRAM_ENROLLMENT',
  'MINIMUM_ATTENDANCE',
  'CLEARED_PREREQUISITES',
  'OPEN_BACKLOG',
] as const;
export const EXAM_MARKS_STATUSES = ['DRAFT', 'SUBMITTED', 'MODERATED', 'APPROVED'] as const;
export const EXAM_REVALUATION_STATUSES = ['REQUESTED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'] as const;
export const RESULT_OUTCOMES = ['PASS', 'FAIL', 'PASS_WITH_GRACE', 'INCOMPLETE'] as const;

// ── Shared pagination ───────────────────────────────────────────────────────

export class ExamsPaginationDto {
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

// ── Exam sessions ───────────────────────────────────────────────────────────

export class CreateExamSessionDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  code: string;

  @IsString()
  @IsNotEmpty()
  programId: string;

  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsIn(EXAM_TYPES)
  examType: string;

  @IsOptional()
  @IsBoolean()
  isSupplementary?: boolean;

  @IsOptional()
  @IsString()
  baseSessionId?: string;

  @IsOptional()
  @IsIn(EXAM_SESSION_STATUSES)
  status?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  resultDeclarationDate?: string;

  @IsOptional()
  @IsString()
  eligibilityPolicy?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateExamSessionDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  code?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsIn(EXAM_TYPES)
  examType?: string;

  @IsOptional()
  @IsBoolean()
  isSupplementary?: boolean;

  @IsOptional()
  @IsString()
  baseSessionId?: string;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsOptional()
  @IsDateString()
  resultDeclarationDate?: string;

  @IsOptional()
  @IsString()
  eligibilityPolicy?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class SessionStatusDto {
  @IsIn(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  status: string;
}

export class ListSessionsQueryDto extends ExamsPaginationDto {
  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsString()
  academicYearId?: string;

  @IsOptional()
  @IsString()
  termId?: string;

  @IsOptional()
  @IsIn(EXAM_TYPES)
  examType?: string;

  @IsOptional()
  @IsIn(EXAM_SESSION_STATUSES)
  status?: string;

  @IsOptional()
  @IsBoolean()
  supplementary?: boolean;
}

// ── Exam subjects (papers) ──────────────────────────────────────────────────

export class CreateExamSubjectDto {
  @IsString()
  @IsNotEmpty()
  courseId: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsInt()
  @Min(1)
  maxMarks: number;

  @IsInt()
  @Min(0)
  passMarks: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsOptional()
  @IsDateString()
  examDate?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class UpdateExamSubjectDto {
  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxMarks?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  passMarks?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  pattern?: string;

  @IsOptional()
  @IsDateString()
  examDate?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class SubjectStatusDto {
  @IsIn(['PUBLISHED', 'COMPLETED'])
  status: string;
}

export class ListSubjectsQueryDto extends ExamsPaginationDto {}

// ── Eligibility rules ───────────────────────────────────────────────────────

export class EligibilityRuleInputDto {
  @IsIn(EXAM_ELIGIBILITY_RULE_TYPES)
  ruleType: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minAttendancePercent?: number;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class SetEligibilityRulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EligibilityRuleInputDto)
  rules: EligibilityRuleInputDto[];
}

export class CheckEligibilityDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studentIds?: string[];
}

// ── Registrations ───────────────────────────────────────────────────────────

export class CreateRegistrationDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

export class BulkRegisterDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

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

  /** Only register students who pass the session's enabled eligibility rules (default true). */
  @IsOptional()
  @IsBoolean()
  eligibleOnly?: boolean;
}

export class ListRegistrationsQueryDto extends ExamsPaginationDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsString()
  programId?: string;

  @IsOptional()
  @IsIn(EXAM_REGISTRATION_STATUSES)
  status?: string;
}

export class UpdateRegistrationStatusDto {
  @IsIn(['CONFIRMED', 'CANCELLED'])
  status: string;

  @IsOptional()
  @IsString()
  remarks?: string;
}

// ── Hall tickets ────────────────────────────────────────────────────────────

export class GenerateHallTicketsDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  studentIds?: string[];
}

export class ListHallTicketsQueryDto extends ExamsPaginationDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsIn(EXAM_HALL_TICKET_STATUSES)
  status?: string;
}

// ── Seating ─────────────────────────────────────────────────────────────────

export class CreateSeatingPlanDto {
  @IsString()
  @IsNotEmpty()
  sessionId: string;

  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsString()
  @IsNotEmpty()
  roomId: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class UpdateSeatingPlanDto {
  @IsOptional()
  @IsString()
  subjectId?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number;
}

export class ListSeatingPlansQueryDto extends ExamsPaginationDto {
  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsString()
  subjectId?: string;
}

export class UpdateSeatAllocationDto {
  @IsOptional()
  @IsIn(EXAM_SEAT_ALLOCATION_STATUSES)
  status?: string;

  @IsOptional()
  @IsString()
  seatNo?: string;
}

// ── Invigilators ────────────────────────────────────────────────────────────

export class AssignInvigilatorDto {
  @IsString()
  @IsNotEmpty()
  userId: string;

  @IsOptional()
  @IsIn(EXAM_INVIGILATOR_ROLES)
  role?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsDateString()
  assignedAt?: string;
}

export class UpdateInvigilatorDto {
  @IsOptional()
  @IsIn(EXAM_INVIGILATOR_ROLES)
  role?: string;

  @IsOptional()
  @IsString()
  roomId?: string;

  @IsOptional()
  @IsDateString()
  assignedAt?: string;
}

// ── Marks entry ─────────────────────────────────────────────────────────────

export class MarksEntryInputDto {
  /** ExamRegistration id; when omitted, `studentId` is resolved within the subject's session. */
  @IsOptional()
  @IsString()
  registrationId?: string;

  @IsOptional()
  @IsString()
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
  @IsIn(['PRESENT', 'ABSENT', 'LATE', 'LEAVE'])
  attendanceStatus?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class UpsertMarksEntryDto {
  @IsOptional()
  @IsString()
  registrationId?: string;

  @IsOptional()
  @IsString()
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
  @IsIn(['PRESENT', 'ABSENT', 'LATE', 'LEAVE'])
  attendanceStatus?: string;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class BulkMarksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MarksEntryInputDto)
  entries: MarksEntryInputDto[];
}

export class ListMarksQueryDto extends ExamsPaginationDto {
  @IsOptional()
  @IsIn(EXAM_MARKS_STATUSES)
  status?: string;
}

// ── Revaluation ─────────────────────────────────────────────────────────────

export class CreateRevaluationDto {
  @IsString()
  @IsNotEmpty()
  registrationId: string;

  @IsString()
  @IsNotEmpty()
  subjectId: string;

  @IsOptional()
  @IsString()
  marksEntryId?: string;

  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ResolveRevaluationDto {
  @IsIn(['RESOLVED', 'REJECTED'])
  status: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  revisedMarks?: number;

  @IsOptional()
  @IsString()
  remark?: string;
}

export class ListRevaluationQueryDto extends ExamsPaginationDto {
  @IsOptional()
  @IsString()
  studentId?: string;

  @IsOptional()
  @IsIn(EXAM_REVALUATION_STATUSES)
  status?: string;
}