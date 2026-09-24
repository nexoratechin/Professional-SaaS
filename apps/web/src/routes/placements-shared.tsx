/**
 * Shared types, constants and data hooks for the Placement Management feature. Follows the
 * hr-shared/timetable-shared conventions: DTO contracts from @college-erp/types, compact loader
 * hooks and the table/form styles kept next to the page component. Row-level student scope is
 * enforced server-side (placements.* permissions + grant scopes), so the UI only renders actions
 * the current user holds via useAuth().permissions.
 */
import { useEffect, useState } from 'react';
import type { CampusLiteDto, DepartmentLiteDto } from '@college-erp/types';
import { apiFetch } from '../lib/http';

export const PLACEMENTS_VIEW = 'placements.view';
export const PLACEMENTS_CREATE = 'placements.create';
export const PLACEMENTS_UPDATE = 'placements.update';
export const PLACEMENTS_APPROVE = 'placements.approve';

export const COMPANY_TYPES = ['MNC', 'INDIAN_MNC', 'STARTUP', 'PSU', 'CORPORATE', 'SME', 'GOVT_ORG', 'NGO', 'OTHER'] as const;
export const DRIVE_MODES = ['ON_CAMPUS', 'OFF_CAMPUS', 'VIRTUAL'] as const;
export const DRIVE_STATUSES = ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const;
export const POSITION_TYPES = ['FULL_TIME', 'INTERNSHIP', 'CONTRACT', 'TRAINEE'] as const;
export const ELIGIBILITY_STATUSES = ['PENDING', 'ELIGIBLE', 'NOT_ELIGIBLE', 'EXEMPTED'] as const;
export const APPLICATION_STATUSES = ['APPLIED', 'SHORTLISTED', 'REJECTED', 'WITHDRAWN'] as const;
export const ROUND_TYPES = [
  'APTITUDE_TEST',
  'TECHNICAL_TEST',
  'PSYCHOMETRIC_TEST',
  'GROUP_DISCUSSION',
  'TECHNICAL_INTERVIEW',
  'HR_INTERVIEW',
  'MANAGERIAL_INTERVIEW',
  'CASE_STUDY',
  'OTHER',
] as const;
export const ROUND_STATUSES = ['SCHEDULED', 'COMPLETED', 'CANCELLED'] as const;
export const ROUND_RESULT_STATUSES = ['PENDING', 'SELECTED', 'REJECTED', 'ON_HOLD', 'ABSENT'] as const;
export const OFFER_STATUSES = ['ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED'] as const;
export const JOINING_STATUSES = ['PENDING', 'JOINED', 'NOT_JOINED', 'POSTPONED'] as const;
export const OUTCOME_STATUSES = ['PLACED', 'NOT_PLACED', 'OPTED_OUT', 'UNREGISTERED'] as const;

export interface PlacementCompanyRef {
  id: string;
  code: string;
  name: string;
  companyType: string;
}

export interface PlacementContactRef {
  id: string;
  fullName: string;
  companyId: string;
}

/** GET /placements/lookups — the lite references the placements forms need (companies, contacts,
 * academic years, enums) plus the shared org pickers reused across every placements screen. */
export interface PlacementLookupsDto {
  campuses: CampusLiteDto[];
  departments: DepartmentLiteDto[];
  programs: { id: string; name: string; code: string; departmentId: string | null }[];
  batches: { id: string; name: string; code: string }[];
  academicYears: { id: string; name: string; code: string }[];
  companies: PlacementCompanyRef[];
  contacts: PlacementContactRef[];
  users: { id: string; email: string; fullName: string }[];
  enums: Record<string, string[]>;
}

export function usePlacementsLookups(): PlacementLookupsDto | null {
  const [lookups, setLookups] = useState<PlacementLookupsDto | null>(null);
  useEffect(() => {
    let mounted = true;
    apiFetch<PlacementLookupsDto>('/placements/lookups')
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

/** Formats an integer rupee-cents package into a readable lakh figure (e.g. "12.5 LPA"). */
export function lpa(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return `${(cents / 1_000_000).toFixed(cents % 1_000_000 === 0 ? 0 : 2)} LPA`;
}

export { loadError, Badge, thStyle, tdStyle, inputStyle, labelStyle, money, fmtDate, selectStyle } from './hr-shared';