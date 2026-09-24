/**
 * Shared types, constants, and data hooks for the HR & Faculty Management feature.
 * Mirrors the conventions of attendance-shared/timetable-shared: plain DTO contracts
 * (mostly re-exported from @college-erp/types), small loader hooks, and inline styles
 * kept close to the UI helper components.
 */
import { useEffect, useState } from 'react';
import type {
  HrLookupsDto,
  CampusLiteDto,
  DepartmentLiteDto,
  HrDesignationDto,
  LeaveTypeDto,
  EmployeeListItemDto,
  EmployeeDetailDto,
  EmployeeDocumentDto,
  EmployeeDocumentDownloadResponseDto,
  EmployeeDocumentUploadResponseDto,
  EmployeeExitDto,
  EmployeeJoiningDto,
  FacultyWorkloadDto,
  HrOverviewDto,
  LeaveApplicationDto,
  LeaveBalanceDto,
  PayslipDto,
  PerformanceReviewDto,
  PayrollRunDetailDto,
  PayrollRunDto,
  SalaryStructureDto,
} from '@college-erp/types';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';

export const EMPLOYEE_TYPES = ['FACULTY', 'STAFF', 'ADMIN'] as const;
export const EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'VISITING', 'ADJUNCT', 'INTERN'] as const;
export const EMPLOYEE_STATUSES = ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'RESIGNED', 'RETIRED', 'TERMINATED'] as const;
export const JOINING_STATUSES = ['PENDING', 'ONBOARDED', 'CONFIRMED', 'CLOSED'] as const;
export const EXIT_TYPES = ['RESIGNATION', 'RETIREMENT', 'TERMINATION', 'END_OF_CONTRACT', 'MUTUAL_SEPARATION'] as const;
export const DOCUMENT_TYPES = [
  'APPOINTMENT_LETTER',
  'OFFER_LETTER',
  'ID_PROOF',
  'EDUCATIONAL_CERTIFICATE',
  'EXPERIENCE_LETTER',
  'PAYSLIP',
  'RELIEVING_LETTER',
  'NO_DUE_CERTIFICATE',
  'OTHER',
] as const;
export const WORKLOAD_TYPES = ['TEACHING', 'ADMINISTRATIVE', 'RESEARCH', 'EXAM_DUTY', 'EXTENSION', 'OTHER'] as const;
export const LEAVE_CATEGORIES = ['CASUAL', 'SICK', 'EARNED', 'MATERNITY', 'PATERNITY', 'UNPAID', 'HALF_DAY', 'COMPENSATORY', 'SPECIAL', 'OTHER'] as const;
export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const HALF_DAY_OPTIONS = ['FIRST_HALF', 'SECOND_HALF'] as const;
export const REVIEW_TYPES = ['SELF', 'SUPERVISOR', 'PEER', 'COMMITTEE'] as const;
export const REVIEW_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'COMPLETED', 'REJECTED'] as const;
export const PAYROLL_RUN_STATUSES = ['DRAFT', 'PROCESSING', 'PROCESSED', 'APPROVED', 'PAID', 'CANCELLED'] as const;
export const NO_DUE_STATUSES = ['PENDING', 'CLEARED', 'DISPUTED'] as const;
export const GENDERS = ['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED'] as const;

export interface HrLookupState {
  campuses: CampusLiteDto[];
  departments: DepartmentLiteDto[];
  designations: HrDesignationDto[];
  leaveTypes: LeaveTypeDto[];
  terms: { id: string; name: string; code: string }[];
  users: { id: string; email: string; fullName: string; status?: string }[];
  enums: Record<string, string[]>;
}

export function useHrLookups(): HrLookupState | null {
  const [lookups, setLookups] = useState<HrLookupState | null>(null);
  useEffect(() => {
    let mounted = true;
    apiFetch<HrLookupsDto>('/hr/lookups')
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

export function loadError(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  fontSize: '0.8rem',
  color: '#6b7280',
};

export const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #f3f4f6',
  fontSize: '0.875rem',
};

export const inputStyle: React.CSSProperties = {
  padding: '0.5rem',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  width: '100%',
};

export const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: '0.8rem',
  color: '#4b5563',
};

export const statusBadge: Record<string, React.CSSProperties> = {
  ACTIVE: { color: '#15803d', background: '#f0fdf4' },
  ON_LEAVE: { color: '#b45309', background: '#fef3c7' },
  SUSPENDED: { color: '#7c3aed', background: '#f5f3ff' },
  RESIGNED: { color: '#6b7280', background: '#f3f4f6' },
  RETIRED: { color: '#374151', background: '#e5e7eb' },
  TERMINATED: { color: '#b91c1c', background: '#fef2f2' },
  PENDING: { color: '#b45309', background: '#fef3c7' },
  APPROVED: { color: '#15803d', background: '#f0fdf4' },
  REJECTED: { color: '#b91c1c', background: '#fef2f2' },
  CANCELLED: { color: '#6b7280', background: '#f3f4f6' },
  DRAFT: { color: '#6b7280', background: '#f3f4f6' },
  SUBMITTED: { color: '#1d4ed8', background: '#eff6ff' },
  COMPLETED: { color: '#15803d', background: '#f0fdf4' },
  PROCESSING: { color: '#1d4ed8', background: '#eff6ff' },
  PROCESSED: { color: '#7c3aed', background: '#f5f3ff' },
  PAID: { color: '#15803d', background: '#f0fdf4' },
  CLEARED: { color: '#15803d', background: '#f0fdf4' },
  DISPUTED: { color: '#b91c1c', background: '#fef2f2' },
  VERIFIED: { color: '#15803d', background: '#f0fdf4' },
  FACULTY: { color: '#1d4ed8', background: '#eff6ff' },
  STAFF: { color: '#7c3aed', background: '#f5f3ff' },
  ADMIN: { color: '#b45309', background: '#fef3c7' },
};

export function Badge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <span style={{ ...(statusBadge[value] ?? {}), padding: '2px 8px', borderRadius: 999, fontSize: '0.75rem' }}>{value}</span>;
}

export function money(value: number | string | null | undefined): string {
  const n = Number(value ?? 0);
  if (Number.isNaN(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Loads an employee detail with all its lifecycle sub-resources. */
export function useEmployeeDetail(id: string | null) {
  const [detail, setDetail] = useState<EmployeeDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    if (!id) {
      setDetail(null);
      setError(null);
      return;
    }
    apiFetch<EmployeeDetailDto>(`/hr/employees/${id}`)
      .then((res) => {
        if (mounted) setDetail(res);
      })
      .catch((e) => {
        if (mounted) setError(loadError(e, 'Failed to load employee'));
      });
    return () => {
      mounted = false;
    };
  }, [id]);
  return { detail, error, reload: id };
}

/** Puts a file to a presigned URL and returns the uploaded byte count. */
export async function uploadToUrl(uploadUrl: string, file: File): Promise<number> {
  const response = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!response.ok) throw new Error(`Upload failed (${response.status})`);
  return file.size;
}

export async function requestUpload(
  employeeId: string,
  input: { documentType: string; title?: string; filename: string; mimeType: string },
): Promise<EmployeeDocumentUploadResponseDto> {
  return apiFetch<EmployeeDocumentUploadResponseDto>(`/hr/employees/${employeeId}/documents/upload-url`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function downloadDocument(documentId: string): Promise<EmployeeDocumentDownloadResponseDto> {
  return apiFetch<EmployeeDocumentDownloadResponseDto>(`/hr/documents/${documentId}/download-url`);
}

export type {
  CampusLiteDto,
  DepartmentLiteDto,
  HrDesignationDto,
  LeaveTypeDto,
  EmployeeListItemDto,
  EmployeeDetailDto,
  EmployeeDocumentDto,
  EmployeeExitDto,
  EmployeeJoiningDto,
  FacultyWorkloadDto,
  HrOverviewDto,
  LeaveApplicationDto,
  LeaveBalanceDto,
  PayslipDto,
  PerformanceReviewDto,
  PayrollRunDetailDto,
  PayrollRunDto,
  SalaryStructureDto,
  HrLookupsDto,
};

export { fmtDate, selectStyle };