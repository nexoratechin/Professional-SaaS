/**
 * Shared types, constants, and data hooks for the Attendance feature. Mirrors the conventions of
 * academia-shared/timetable-shared: plain DTO interfaces, small loader hooks, and inline styles
 * kept close to the UI helper components.
 */
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';

export const ATTENDANCE_STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const;
export const SESSION_STATUSES = ['OPEN', 'CLOSED'] as const;
export const CORRECTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const ATTENDANCE_TYPES = ['CLASS', 'LAB', 'TUTORIAL', 'EXAM', 'ASSEMBLY', 'OTHER'] as const;
export const ATTENDANCE_MARK_METHODS = ['MANUAL', 'QR', 'BIOMETRIC'] as const;

export interface IdName {
  id: string;
  code?: string | null;
  name?: string | null;
  termId?: string | null;
  sectionId?: string | null;
}

export interface UserRef {
  id: string;
  fullName: string;
  email: string | null;
}

export interface AttendanceLookups {
  terms: IdName[];
  sections: IdName[];
  offerings: Array<{
    id: string;
    code: string;
    termId: string | null;
    sectionId: string | null;
    course: { id: string; code: string; name: string } | null;
    section: { id: string; code: string; name: string } | null;
  }>;
  faculty: UserRef[];
  sessionStatuses: string[];
  correctionStatuses: string[];
}

export interface SessionRow {
  id: string;
  date: string;
  attendanceType: string;
  subjectCode: string | null;
  subjectName: string | null;
  title: string | null;
  notes: string | null;
  status: string;
  startTime: string | null;
  endTime: string | null;
  term: IdName | null;
  section: IdName | null;
  courseOffering: { id: string; code: string; course: { code: string; name: string } } | null;
  timetableEntry: {
    id: string;
    dayOfWeek: number;
    title: string | null;
    period: { sequence: number; startTime: string | null; endTime: string | null } | null;
  } | null;
  _count?: { records: number };
}

export interface RosterRow {
  id: string;
  fullName: string;
  rollNumber: string | null;
  admissionNumber: string;
  userId: string | null;
  recordId?: string;
  status: string | null;
  remarks: string | null;
  signInAt: string | null;
  markMethod?: string | null;
  section?: { id: string; code: string | null; name: string | null } | null;
}

export interface AttendanceRules {
  thresholdPercent: number;
  requiredPerSubject: boolean;
  gracePeriodMinutes: number;
  correctionWindowHours: number;
  ruleDescription: string | null;
}

export interface SessionDetail {
  session: SessionRow & { records?: RosterRow[] };
  roster: RosterRow[];
  counts: { present: number; absent: number; late: number; leave: number };
  requiredPercent: number;
  rules: AttendanceRules;
}

export interface CorrectionRow {
  id: string;
  fromStatus: string;
  toStatus: string;
  reason: string | null;
  remarks: string | null;
  status: string;
  createdAt: string;
  requestedByUserId: string | null;
  decidedByUserId: string | null;
  decidedAt: string | null;
  student: { id: string; fullName: string; rollNumber: string | null; section: { code: string | null } | null } | null;
  session: SessionRow | null;
  requestedBy: UserRef | null;
  decidedBy: UserRef | null;
}

export interface FacultyRow {
  id: string;
  date: string;
  checkInAt: string | null;
  checkOutAt: string | null;
  status: string | null;
  remarks: string | null;
  user: UserRef | null;
}

export interface PercentageResp {
  studentId: string;
  totalSessions: number;
  present: number;
  late: number;
  absent: number;
  leave: number;
  attended: number;
  percentage: number;
  requiredPercent: number;
  status: string;
}

export interface ShortageRow {
  studentId: string;
  fullName: string;
  rollNumber: string | null;
  admissionNumber: string;
  sectionCode: string | null;
  present: number;
  totalSessions: number;
  percentage: number;
  requiredPercent: number;
}

export interface SummaryRow {
  subjectCode: string;
  subjectName: string;
  sessions: number;
  present: number;
  late: number;
  absent: number;
  leave: number;
  totalMarked: number;
  attended: number;
  percentage: number;
  requiredPercent: number;
  status: string;
}

export function loadError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

/** Loads the shared attendance lookups (terms/sections/offerings/faculty) once. */
export function useAttendanceLookups() {
  const [lookups, setLookups] = useState<AttendanceLookups | null>(null);
  useEffect(() => {
    let mounted = true;
    apiFetch<AttendanceLookups>('/attendance/lookups')
      .then((res) => {
        if (mounted) setLookups(res);
      })
      .catch(() => {
        if (mounted) setLookups(null);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return lookups;
}

export { fmtDate, selectStyle };