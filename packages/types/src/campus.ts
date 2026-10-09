/**
 * Shared contracts for the multi-campus operations surface (apps/api's campus module and
 * apps/web's /campuses page): the campus overview/compare endpoints, per-campus configuration
 * documents, and the global cross-campus policies. Plain data only, mirroring every other type
 * module in this package.
 *
 * The section shapes (branding, academicCalendar, attendance, fees, numbering, templates) reuse
 * the tenant configuration section types from ./index — a campus document is the same kind of
 * JSON config document as the tenant's, just scoped to one campus.
 */
import type {
  TenantConfigAcademicCalendar,
  TenantConfigAttendance,
  TenantConfigBranding,
  TenantConfigFees,
  TenantConfigNumbering,
  TenantConfigTemplates,
} from './index';

// ---------------------------------------------------------------------------
// Campus directory + overview (GET /campuses/overview)
// ---------------------------------------------------------------------------

/** Identity row for one campus — the directory/filter options every tab of the UI consumes. */
export interface CampusDirectoryItemDto {
  id: string;
  code: string;
  name: string;
  city: string | null;
  state: string | null;
  country: string | null;
  isActive: boolean;
  createdAt: string;
}

/** Aggregate headcounts for one campus, derived from the tenant's own operational tables. */
export interface CampusCountsDto {
  departments: number;
  programs: number;
  students: number;
  employees: number;
  /** Sum of SUCCEEDED student payments, in paise/cents — the campus's collected fee volume. */
  feeCollectedCents: number;
}

/** One row of GET /campuses/overview — directory identity + live aggregate counts. */
export interface CampusOverviewRowDto extends CampusDirectoryItemDto {
  /** Version of this campus's configuration document (0 = none created yet). */
  configVersion: number;
  /** The campus's configured timezone (its own setting, falling back to the global default). */
  timezone: string | null;
  counts: CampusCountsDto;
}

/** GET /campuses/overview response — always an array of the campuses the caller can see. */
export interface CampusOverviewDto {
  campuses: CampusOverviewRowDto[];
}

// ---------------------------------------------------------------------------
// Campus comparison (GET /campuses/compare)
// ---------------------------------------------------------------------------

/** One campus's column header in the comparison table. */
export interface CampusCompareCampusDto {
  id: string;
  code: string;
  name: string;
  city: string | null;
}

/** One metric row of the comparison — the same metric measured across the selected campuses. */
export interface CampusMetricRowDto {
  metric: 'students' | 'departments' | 'programs' | 'employees' | 'feeCollectedCents';
  label: string;
  /** `null` when that campus has no value computable for the metric (e.g. no fee data). */
  values: Array<{ campusId: string; value: number | null }>;
}

/**
 * GET /campuses/compare?campusIds=a&campusIds=b — campuses in the order requested, then metric
 * rows × campuses. The backend already rejected any campusId outside the caller's scope.
 */
export interface CampusComparisonDto {
  campuses: CampusCompareCampusDto[];
  metrics: CampusMetricRowDto[];
}

// ---------------------------------------------------------------------------
// Per-campus configuration (GET/PATCH /campuses/:campusId/config)
// ---------------------------------------------------------------------------

/**
 * One campus's configuration document — a typed view over the CampusConfiguration JSONB `data`
 * column. Sections mirror the tenant configuration engine but are campus-scoped; every section
 * is optional/nullable so a fresh campus with only defaults still renders.
 */
export interface CampusSettingsDocument {
  /** IANA timezone this campus operates in (the tenant's global default on first creation). */
  timezone: string | null;
  branding: Partial<TenantConfigBranding> | null;
  academicCalendar: Partial<TenantConfigAcademicCalendar> | null;
  attendance: Partial<TenantConfigAttendance> | null;
  fees: Partial<TenantConfigFees> | null;
  numbering: Partial<TenantConfigNumbering> | null;
  templates: Partial<TenantConfigTemplates> | null;
}

/** GET /campuses/:campusId/config response. */
export interface CampusConfigurationDto {
  id: string;
  tenantId: string;
  campusId: string;
  version: number;
  config: CampusSettingsDocument;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Global cross-campus policies (GET/PATCH /campuses/policies)
// ---------------------------------------------------------------------------

/**
 * The institution-wide (university-level) campus policy document. Stored as the `policies`
 * section of the tenant configuration engine so it lives in the same versioned document as the
 * rest of the tenant config, but only the global `campus.policies.manage` grant can touch it.
 * `campusSettingsEnabled` and `campusAnalyticsEnabled` are enforced by the campus module's own
 * endpoints; `allowCampusAdminRole` is the policy intent the RBAC assignment flow should honor;
 * `defaultTimezone` is applied when a campus' configuration is first created.
 */
export interface GlobalCampusPoliciesDto {
  /** When false, every PATCH /campuses/:campusId/config is rejected with 403. */
  campusSettingsEnabled: boolean;
  /** When false, GET /campuses/overview and /campuses/compare are rejected with 403. */
  campusAnalyticsEnabled: boolean;
  /** When false, the CAMPUS_ADMIN system role should not be assignable to new users. */
  allowCampusAdminRole: boolean;
  /** IANA timezone new campus configurations are seeded with (applied at find-or-create). */
  defaultTimezone: string | null;
}

/** GET /campuses/policies response. */
export interface GlobalCampusPoliciesResponseDto {
  version: number;
  policies: GlobalCampusPoliciesDto;
  updatedAt: string;
}