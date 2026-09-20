import React, { useEffect, useState } from 'react';
import { Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';

export const COURSE_TYPES = ['CORE', 'ELECTIVE', 'OPEN_ELECTIVE', 'LABORATORY', 'PROJECT', 'INTERNSHIP', 'MINOR', 'OTHER'] as const;
export const CURRICULUM_VERSION_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;
export const COURSE_OFFERING_STATUSES = ['PLANNED', 'ACTIVE', 'CLOSED', 'CANCELLED', 'COMPLETED'] as const;
export const FACULTY_ASSIGNMENT_ROLES = ['PRIMARY', 'CO_TEACHER', 'ASSISTANT'] as const;
export const COURSE_REGISTRATION_STATUSES = ['REGISTERED', 'CONFIRMED', 'WAITLISTED', 'WITHDRAWN', 'DROPPED', 'COMPLETED'] as const;
export const ADVISING_PRIORITIES = ['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const;
export const ADVISING_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
export const PROGRESSION_STATUSES = ['CONTINUING', 'PROMOTED', 'REAPPEARING', 'DETAINED', 'GRADUATED', 'WITHDRAWN'] as const;
export const BACKLOG_STATUSES = ['OPEN', 'CLEARED', 'EXEMPTED'] as const;

export interface IdName {
  id: string;
  code?: string | null;
  name?: string | null;
}

export interface CourseRow {
  id: string;
  code: string;
  name: string;
  creditHours: number | null;
  courseType: string;
  description?: string | null;
  isActive: boolean;
  department?: IdName | null;
  prerequisites?: CoursePrerequisiteRow[];
  requiredBy?: CoursePrerequisiteRow[];
}

export interface CoursePrerequisiteRow {
  id: string;
  minGrade?: string | null;
  requiredCourse?: IdName & { creditHours?: number | null };
  course?: IdName;
}

export interface UserRow {
  id: string;
  fullName: string;
  email: string;
  status: string;
  userRoles?: { role?: { name?: string; key?: string } }[];
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toISOString().slice(0, 10);
}

export const selectStyle: React.CSSProperties = { padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' };

/** Loads the user directory when the caller holds users.view, otherwise returns null so the
 * component can fall back to a free-text user-id input. */
export function useUsers(): UserRow[] | null {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  useEffect(() => {
    let mounted = true;
    apiFetch<UserRow[]>('/users')
      .then((rows) => {
        if (mounted) setUsers(rows);
      })
      .catch(() => {
        if (mounted) setUsers(null);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return users;
}

const ORG_ENTITIES: Record<string, string> = {
  campuses: 'campus',
  departments: 'department',
  programs: 'program',
  'academic-years': 'academic-year',
  terms: 'term',
  sections: 'section',
  batches: 'batch',
};

/** Fetches a simple master-data list from the organization module (programs, terms, ...). */
export function useEntityList(entity: string): IdName[] {
  const [rows, setRows] = useState<IdName[]>([]);
  const route = ORG_ENTITIES[entity] ?? entity;
  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: IdName[]; total: number }>(`/organization/${route}?skip=0&take=200`)
      .then((res) => {
        if (mounted) setRows(res.data);
      })
      .catch(() => {
        if (mounted) setRows([]);
      });
    return () => {
      mounted = false;
    };
  }, [route]);
  return rows;
}

export function UserIdField({
  value,
  users,
  onChange,
}: {
  value: string;
  users: UserRow[] | null;
  onChange: (v: string) => void;
}) {
  if (users) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} style={selectStyle}>
        <option value="">Select user…</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName} ({u.email})
          </option>
        ))}
      </select>
    );
  }
  return <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="User id" style={{ minWidth: 200 }} />;
}