import { useEffect, useState } from 'react';
import type { StudentSummaryDto } from '@college-erp/types';
import { apiFetch } from '../lib/http';
import { IdName } from './academics-shared';

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

// ── Row shapes mirroring the API payloads ────────────────────────────────────

export interface Paged<T> {
  items: T[];
  total: number;
}

export interface CourseRef extends IdName {
  creditHours: number | null;
}

export interface RoomRef {
  id: string;
  code: string | null;
  name: string | null;
  buildingName?: string | null;
  capacity?: number | null;
}

export interface SessionRow {
  id: string;
  name: string;
  code: string;
  examType: string;
  isSupplementary: boolean;
  status: string;
  programId: string | null;
  academicYearId: string | null;
  termId: string | null;
  startDate: string | null;
  endDate: string | null;
  resultDeclarationDate: string | null;
  eligibilityPolicy?: string | null;
  remarks?: string | null;
  resultPublishedAt?: string | null;
  program?: IdName | null;
  academicYear?: IdName | null;
  term?: IdName | null;
  baseSession?: IdName | null;
  _count?: { subjects: number; registrations: number; hallTickets: number; seatingPlans: number };
}

export interface ExamSubjectRow {
  id: string;
  sessionId: string;
  courseId: string;
  roomId: string | null;
  maxMarks: number;
  passMarks: number;
  durationMinutes: number | null;
  pattern: string | null;
  examDate: string | null;
  startTime: string | null;
  endTime: string | null;
  status: string;
  remarks?: string | null;
  course?: CourseRef;
  room?: RoomRef;
}

export interface StudentLite {
  id: string;
  fullName: string;
  admissionNumber: string | null;
  rollNumber: string | null;
  userId: string | null;
  program?: IdName | null;
}

export interface EligibilityRuleRow {
  id: string;
  sessionId: string;
  ruleType: string;
  enabled: boolean;
  minAttendancePercent: number | null;
  remarks?: string | null;
}

export interface EligibilityReason {
  ruleType: string;
  label: string;
  satisfied: boolean;
  detail?: string;
}

export interface EligibilityOutcomeRow {
  studentId: string;
  fullName: string;
  admissionNumber: string | null;
  eligible: boolean;
  attendancePercent: number | null;
  reasons: EligibilityReason[];
}

export interface RegistrationRow {
  id: string;
  sessionId: string;
  studentId: string;
  status: string;
  registeredAt: string;
  remarks?: string | null;
  session?: { id: string; name: string; code: string; examType: string; status: string };
  student?: StudentLite;
  hallTicket?: { id: string; ticketNumber: string; status: string } | null;
  _count?: { marksEntries: number };
}

export interface HallTicketRow {
  id: string;
  registrationId: string;
  sessionId: string;
  ticketNumber: string;
  status: string;
  issuedAt: string;
  session?: { id: string; code: string; name: string; examType: string };
  registration?: { id: string; student: StudentLite };
  subjects?: HallTicketSubjectRow[];
}

export interface HallTicketSubjectRow {
  id: string;
  courseCode: string;
  courseName: string;
  maxMarks: number;
  passMarks: number;
  examDate: string | null;
  startTime: string | null;
  endTime: string | null;
  roomName: string | null;
  seatNo: string | null;
}

export interface SeatingPlanRow {
  id: string;
  sessionId: string;
  subjectId: string | null;
  roomId: string;
  label?: string | null;
  capacity: number | null;
  room?: RoomRef;
  subject?: { id: string; course: IdName; examDate: string | null };
  session?: { id: string; code: string; name: string };
  allocations?: SeatAllocationRow[];
  _count?: { allocations: number };
}

export interface SeatAllocationRow {
  id: string;
  planId: string;
  registrationId: string;
  studentId: string;
  seatNo: string | null;
  status: string;
  registration?: { student: StudentLite };
}

export interface MarksRow {
  id: string;
  registrationId: string;
  subjectId: string;
  studentId: string;
  marksObtained: number | null;
  graceMarks: number;
  attendanceStatus: string;
  status: string;
  remark?: string | null;
  registration?: { student: StudentLite };
}

export interface RevaluationRow {
  id: string;
  registrationId: string;
  subjectId: string;
  reason: string;
  status: string;
  revisedMarks: number | null;
  remark?: string | null;
  requestedAt: string;
  registration?: { student: StudentLite };
  subject?: { id: string; course: IdName; maxMarks: number; passMarks: number };
}

// ── Shared fetchers ──────────────────────────────────────────────────────────

/** Loads every (non-deleted) exam session — used by pickers in most tabs. */
export function useSessions(): SessionRow[] {
  const [rows, setRows] = useState<SessionRow[]>([]);
  useEffect(() => {
    let mounted = true;
    apiFetch<Paged<SessionRow>>('/exams/sessions?skip=0&take=200')
      .then((res) => {
        if (mounted) setRows(res.items);
      })
      .catch(() => {
        if (mounted) setRows([]);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return rows;
}

/** Loads the course catalog (/academics/courses) for subject creation. */
export function useCourses(): CourseRef[] {
  const [rows, setRows] = useState<CourseRef[]>([]);
  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: CourseRef[]; total: number }>('/academics/courses?take=300')
      .then((res) => {
        if (mounted) setRows(res.data);
      })
      .catch(() => {
        if (mounted) setRows([]);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return rows;
}

/** Loads all students for registration / marks entry pickers. */
export function useStudents(): StudentSummaryDto[] {
  const [rows, setRows] = useState<StudentSummaryDto[]>([]);
  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: StudentSummaryDto[]; total: number }>('/students?skip=0&take=500')
      .then((res) => {
        if (mounted) setRows(res.data);
      })
      .catch(() => {
        if (mounted) setRows([]);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return rows;
}