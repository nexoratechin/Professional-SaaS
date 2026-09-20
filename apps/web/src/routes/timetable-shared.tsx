import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/http';
import { selectStyle } from './academics-shared';

export const TIMETABLE_STATUSES = ['DRAFT', 'GENERATED', 'PUBLISHED', 'ARCHIVED'] as const;
export const ENTRY_TYPES = ['LECTURE', 'LAB', 'TUTORIAL', 'OTHER'] as const;
export const CONFLICT_TYPES = ['ROOM', 'FACULTY', 'SECTION'] as const;
export const SUBSTITUTION_STATUSES = ['REQUESTED', 'APPROVED', 'DECLINED', 'CANCELLED', 'EXECUTED'] as const;
export const WEEK_DAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export interface IdName {
  id: string;
  code?: string | null;
  name?: string | null;
}

export interface TermRow extends IdName {
  isCurrent: boolean;
}

export type CampusRow = IdName;

export interface RoomRow extends IdName {
  roomType: string;
  capacity?: number | null;
  campusId: string;
}

export interface SectionRow extends IdName {
  programId?: string | null;
}

export interface OfferingRow {
  id: string;
  code: string;
  termId: string;
  campusId?: string | null;
  course: { id: string; code: string; name: string; creditHours?: number | null; courseType: string };
  section?: SectionRow | null;
}

export interface Lookups {
  terms: TermRow[];
  campuses: CampusRow[];
  rooms: RoomRow[];
  sections: SectionRow[];
  offerings: OfferingRow[];
}

export interface PeriodRow {
  id: string;
  sequence: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
  isActive: boolean;
}

export interface UserRef {
  id: string;
  fullName: string;
  email?: string | null;
}

export interface EntryRow {
  id: string;
  dayOfWeek: number;
  entryType: string;
  title?: string | null;
  notes?: string | null;
  period?: { id: string; sequence: number; startTime: string; endTime: string };
  courseOffering?: {
    id: string;
    code: string;
    course: { id: string; code: string; name: string; creditHours?: number | null; courseType: string };
  };
  section?: IdName | null;
  room?: IdName & { roomType?: string; capacity?: number | null };
  assignedUser?: UserRef | null;
}

export interface HolidayRow {
  id: string;
  date: string;
  name: string;
  description?: string | null;
}

export interface AvailabilityRow {
  id: string;
  userId: string;
  user: UserRef;
  termId?: string | null;
  campusId?: string | null;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  isBlocked: boolean;
  isActive: boolean;
  note?: string | null;
}

export interface SubstitutionRow {
  id: string;
  entryId: string;
  entry: EntryRow;
  originalUserId?: string | null;
  substituteUser: UserRef;
  effectiveDate: string;
  reason?: string | null;
  status: string;
  requestedById?: string | null;
  decidedById?: string | null;
  decidedAt?: string | null;
}

export interface ConflictRow {
  id: string;
  conflictType: string;
  dayOfWeek: number;
  periodId?: string | null;
  entryAId?: string | null;
  entryBId?: string | null;
  substitutionAId?: string | null;
  substitutionBId?: string | null;
  description: string;
  source: string;
  detectedAt: string;
  resolvedAt?: string | null;
}

export interface HistoryRow {
  id: string;
  action: string;
  actorId?: string | null;
  description?: string | null;
  createdAt: string;
}

export interface TimetableRow {
  id: string;
  name: string;
  code?: string | null;
  termId: string;
  campusId: string;
  status: string;
  workingDays: number[];
  createdAt: string;
  term?: IdName & { academicYear?: IdName };
  campus?: IdName;
  _count?: { entries?: number; periods?: number };
}

export interface TimetableDetail extends TimetableRow {
  entryCount: number;
  holidayCount: number;
  substitutionCount: number;
  unresolvedConflictCount: number;
  periods: PeriodRow[];
  publishedBy?: UserRef;
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function entryLabel(e: EntryRow): string {
  const parts: string[] = [];
  parts.push(e.courseOffering?.course?.name ?? e.title ?? e.entryType ?? 'Session');
  if (e.section?.code) parts.push(e.section.code);
  if (e.assignedUser?.fullName) parts.push(e.assignedUser.fullName);
  return parts.join(' · ');
}

export function useLookups(): Lookups | null {
  const [lookups, setLookups] = useState<Lookups | null>(null);
  useEffect(() => {
    let mounted = true;
    apiFetch<Lookups>('/timetable/lookups')
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

export { selectStyle };