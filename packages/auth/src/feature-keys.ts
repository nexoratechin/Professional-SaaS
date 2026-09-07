/**
 * Feature-flag catalog — one key per product module (matches apps/api/src/modules/* folder
 * names). Business logic for these modules is built in later phases; the flags exist from
 * Phase 1 so subscription/plan gating (@RequireFeature()) is already wired end-to-end.
 */
export const FEATURE_KEYS = {
  STUDENTS: 'students',
  ACADEMICS: 'academics',
  TIMETABLE: 'timetable',
  ATTENDANCE: 'attendance',
  ADMISSIONS: 'admissions',
  FEES: 'fees',
  PAYMENTS: 'payments',
  EXAMS: 'exams',
  RESULTS: 'results',
  CERTIFICATES: 'certificates',
  LIBRARY: 'library',
  HOSTEL: 'hostel',
  TRANSPORT: 'transport',
  HR: 'hr',
  PLACEMENTS: 'placements',
  INVENTORY: 'inventory',
  NOTIFICATIONS: 'notifications',
  REPORTS: 'reports',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  INTEGRATIONS: 'integrations',
  MFA: 'mfa',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

export interface FeatureFlagCatalogEntry {
  key: FeatureKey;
  name: string;
  module: string;
}

export const FEATURE_FLAG_CATALOG: FeatureFlagCatalogEntry[] = [
  { key: FEATURE_KEYS.STUDENTS, name: 'Student 360', module: 'students' },
  { key: FEATURE_KEYS.ACADEMICS, name: 'Academics', module: 'academics' },
  { key: FEATURE_KEYS.TIMETABLE, name: 'Timetable', module: 'timetable' },
  { key: FEATURE_KEYS.ATTENDANCE, name: 'Attendance', module: 'attendance' },
  { key: FEATURE_KEYS.ADMISSIONS, name: 'Admissions', module: 'admissions' },
  { key: FEATURE_KEYS.FEES, name: 'Fees', module: 'fees' },
  { key: FEATURE_KEYS.PAYMENTS, name: 'Payments', module: 'payments' },
  { key: FEATURE_KEYS.EXAMS, name: 'Exams', module: 'exams' },
  { key: FEATURE_KEYS.RESULTS, name: 'Results', module: 'results' },
  { key: FEATURE_KEYS.CERTIFICATES, name: 'Certificates', module: 'certificates' },
  { key: FEATURE_KEYS.LIBRARY, name: 'Library', module: 'library' },
  { key: FEATURE_KEYS.HOSTEL, name: 'Hostel', module: 'hostel' },
  { key: FEATURE_KEYS.TRANSPORT, name: 'Transport', module: 'transport' },
  { key: FEATURE_KEYS.HR, name: 'HR / Faculty', module: 'hr' },
  { key: FEATURE_KEYS.PLACEMENTS, name: 'Placements', module: 'placements' },
  { key: FEATURE_KEYS.INVENTORY, name: 'Inventory / Assets', module: 'inventory' },
  { key: FEATURE_KEYS.NOTIFICATIONS, name: 'Notifications', module: 'notifications' },
  { key: FEATURE_KEYS.REPORTS, name: 'Basic Reports', module: 'reports' },
  { key: FEATURE_KEYS.ADVANCED_ANALYTICS, name: 'Advanced Analytics', module: 'reports' },
  { key: FEATURE_KEYS.INTEGRATIONS, name: 'External Integrations', module: 'integrations' },
  { key: FEATURE_KEYS.MFA, name: 'Multi-Factor Authentication', module: 'security' },
];

export const PLAN_CODES = {
  STARTER: 'starter',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
  UNIVERSITY_CUSTOM: 'university_custom',
} as const;

export interface PlanDefinition {
  code: (typeof PLAN_CODES)[keyof typeof PLAN_CODES];
  name: string;
  isCustom: boolean;
  features: FeatureKey[];
}

/** Plan -> module mapping straight from the blueprint's Subscription & Feature Management table. */
export const PLAN_DEFINITIONS: PlanDefinition[] = [
  {
    code: PLAN_CODES.STARTER,
    name: 'Starter',
    isCustom: false,
    features: [FEATURE_KEYS.STUDENTS, FEATURE_KEYS.ACADEMICS, FEATURE_KEYS.ATTENDANCE, FEATURE_KEYS.REPORTS],
  },
  {
    code: PLAN_CODES.PROFESSIONAL,
    name: 'Professional',
    isCustom: false,
    features: [
      FEATURE_KEYS.STUDENTS,
      FEATURE_KEYS.ACADEMICS,
      FEATURE_KEYS.ATTENDANCE,
      FEATURE_KEYS.REPORTS,
      FEATURE_KEYS.ADMISSIONS,
      FEATURE_KEYS.FEES,
      FEATURE_KEYS.PAYMENTS,
      FEATURE_KEYS.EXAMS,
      FEATURE_KEYS.RESULTS,
      FEATURE_KEYS.NOTIFICATIONS,
      FEATURE_KEYS.MFA,
    ],
  },
  {
    code: PLAN_CODES.ENTERPRISE,
    name: 'Enterprise',
    isCustom: false,
    features: [
      FEATURE_KEYS.STUDENTS,
      FEATURE_KEYS.ACADEMICS,
      FEATURE_KEYS.TIMETABLE,
      FEATURE_KEYS.ATTENDANCE,
      FEATURE_KEYS.REPORTS,
      FEATURE_KEYS.ADMISSIONS,
      FEATURE_KEYS.FEES,
      FEATURE_KEYS.PAYMENTS,
      FEATURE_KEYS.EXAMS,
      FEATURE_KEYS.RESULTS,
      FEATURE_KEYS.CERTIFICATES,
      FEATURE_KEYS.NOTIFICATIONS,
      FEATURE_KEYS.LIBRARY,
      FEATURE_KEYS.HOSTEL,
      FEATURE_KEYS.TRANSPORT,
      FEATURE_KEYS.HR,
      FEATURE_KEYS.PLACEMENTS,
      FEATURE_KEYS.INVENTORY,
      FEATURE_KEYS.ADVANCED_ANALYTICS,
      FEATURE_KEYS.MFA,
    ],
  },
  {
    code: PLAN_CODES.UNIVERSITY_CUSTOM,
    name: 'University / Custom',
    isCustom: true,
    features: Object.values(FEATURE_KEYS),
  },
];
