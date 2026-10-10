/**
 * Shared contracts for the self-service college onboarding wizard (apps/api's onboarding module,
 * apps/web's /onboarding page). Plain data only — no decorators — so the frontend imports these
 * exactly like every other DTO in this package.
 *
 * The wizard is a linear ten-step flow. Steps are addressed by stable string keys (not by index)
 * so the server can record completion out of order (e.g. a user jumping back to edit branding)
 * without corrupting progress, and so a new optional step can be inserted without renumbering.
 */
export const ONBOARDING_STEPS = [
  'ACCOUNT',
  'COLLEGE',
  'PLAN',
  'BRANDING',
  'ACADEMIC_STRUCTURE',
  'MODULES',
  'DATA_IMPORT',
  'ADMINISTRATOR',
  'NOTIFICATIONS',
  'COMPLETE',
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** Human labels for the client stepper — kept here so API and web never disagree on naming. */
export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  ACCOUNT: 'Create account',
  COLLEGE: 'Create college',
  PLAN: 'Select plan',
  BRANDING: 'Configure branding',
  ACADEMIC_STRUCTURE: 'Academic structure',
  MODULES: 'Configure modules',
  DATA_IMPORT: 'Import data',
  ADMINISTRATOR: 'Create administrator',
  NOTIFICATIONS: 'Configure notifications',
  COMPLETE: 'Complete onboarding',
};

/** Steps a user may defer: everything except the account/college/plan/administrator/complete spine. */
export const ONBOARDING_OPTIONAL_STEPS: readonly OnboardingStep[] = [
  'BRANDING',
  'ACADEMIC_STRUCTURE',
  'MODULES',
  'DATA_IMPORT',
  'NOTIFICATIONS',
];

export type OnboardingSessionStatus = 'IN_PROGRESS' | 'COMPLETED' | 'ABANDONED';

/** The public projection of an onboarding session — never includes the token or password hash. */
export interface OnboardingSessionDto {
  id: string;
  status: OnboardingSessionStatus;
  currentStep: number;
  completedSteps: OnboardingStep[];
  accountEmail: string;
  accountFullName: string;
  tenantId: string | null;
  tenantSlug: string | null;
  tenantName: string | null;
  planCode: string | null;
  adminEmail: string | null;
  adminFullName: string | null;
  completedAt: string | null;
  expiresAt: string;
  /** Non-secret per-step answers accumulated so far (branding, academic structure, modules, …). */
  data: Record<string, unknown>;
}

export interface OnboardingAccountResponseDto {
  /** Opaque session token. Returned exactly once, on account creation; the client stores it and
   *  sends it as X-Onboarding-Token on every later wizard request. */
  onboardingToken: string;
  session: OnboardingSessionDto;
}

/** A plan offered in step 3, with the module/feature keys it grants. */
export interface OnboardingPlanOptionDto {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceCents: number | null;
  currency: string;
  billingCycle: 'MONTHLY' | 'ANNUAL' | 'ONE_TIME';
  isCustom: boolean;
  /** Feature (module) keys included in this plan. */
  features: string[];
  /** Granular entitlement keys included in this plan. */
  entitlements: string[];
}

/** A module toggle offered in step 6. `enabled` reflects the effective state (plan + overrides). */
export interface OnboardingModuleOptionDto {
  key: string;
  name: string;
  module: string;
  enabled: boolean;
  /** Whether the currently selected plan already includes this module (cannot be disabled below
   *  the plan on self-service — but may be explicitly enabled as an add-on). */
  includedInPlan: boolean;
}

/** Result of the optional data-import step (step 7) — mirrors OrganizationService.ImportResult. */
export interface OnboardingImportResultDto {
  entity: string;
  mode: 'validate' | 'upsert';
  total: number;
  valid: number;
  inserted: number;
  updated: number;
  errors: Array<{ row: number; code: string; success: boolean; error?: string }>;
}

/** Final summary returned by POST /onboarding/complete. */
export interface OnboardingCompletionDto {
  tenant: { id: string; slug: string; name: string; status: 'ACTIVE' };
  admin: { id: string; email: string; fullName: string };
  rolesCreated: number;
  permissionsGranted: number;
  configurationInitialized: boolean;
  welcomeNotificationSent: boolean;
  completedAt: string;
}
