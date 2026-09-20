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

/**
 * Granular entitlement catalog — finer-grained capability flags BELOW the module level that
 * subscription/plan gating should be able to turn on/off independently of whole modules. These
 * map 1:1 onto PlanModule.moduleKey / Entitlement.key rows and are resolved through the single
 * centralized EntitlementsGatewayService (never a one-off toggle). Naming mirrors the user's
 * requested keys exactly: `attendance.qr`, `fees.online_payment`, `multi_campus.enabled`, etc.
 *
 * NOTE on the handful of "subsumed" keys (ADVANCED_ANALYTICS / multi_campus / sso): the existing
 * FEATURE_KEYS.ADVANCED_ANALYTICS ('advanced_analytics') predates this category and is kept for
 * backward compat. The canonical, granular keys below (analytics.advanced, multi_campus.enabled,
 * sso.enabled) are what NEW enforcement sites should reference; existing call sites may keep
 * using the legacy key which resolves to the same underlying entitlement row name for BOOLEAN.
 */
export const ENTITLEMENT_KEYS = {
  // --- Attendance (module: attendance) ---
  ATTENDANCE_BASIC: 'attendance.basic',
  ATTENDANCE_QR: 'attendance.qr',
  ATTENDANCE_BIOMETRIC: 'attendance.biometric',

  // --- Fees (module: fees) ---
  FEES_ONLINE_PAYMENT: 'fees.online_payment',
  FEES_INSTALLMENT: 'fees.installment',

  // --- Exams (module: exams) ---
  EXAMS_REVALUATION: 'exams.revaluation',

  // --- Reports / analytics (module: reports) ---
  ANALYTICS_ADVANCED: 'analytics.advanced',

  // --- AI assistant (cross-cutting, module: ai) ---
  AI_ASSISTANT: 'ai.assistant',

  // --- Transport (module: transport) ---
  TRANSPORT_GPS: 'transport.gps',

  // --- Library (module: library) ---
  LIBRARY_BARCODE: 'library.barcode',

  // --- Cross-cutting (module: platform) ---
  MULTI_CAMPUS_ENABLED: 'multi_campus.enabled',
  SSO_ENABLED: 'sso.enabled',
} as const;

export type EntitlementKey = (typeof ENTITLEMENT_KEYS)[keyof typeof ENTITLEMENT_KEYS];

/** Every granular entitlement is currently a BOOLEAN capability; left as a non-empty const so a
 * future QUANTITY entitlement can be added without changing call sites. */
export const BOOLEAN_ENTITLEMENT_KEYS: readonly EntitlementKey[] = Object.values(ENTITLEMENT_KEYS);

export interface EntitlementCatalogEntry {
  key: EntitlementKey;
  /** The module-level FeatureKey this granular key is nested under (drives nav/module gating). */
  module: FeatureKey;
  name: string;
  description: string;
}

export const ENTITLEMENT_CATALOG: EntitlementCatalogEntry[] = [
  { key: ENTITLEMENT_KEYS.ATTENDANCE_BASIC, module: FEATURE_KEYS.ATTENDANCE, name: 'Manual attendance', description: 'Standard manual attendance marking.' },
  { key: ENTITLEMENT_KEYS.ATTENDANCE_QR, module: FEATURE_KEYS.ATTENDANCE, name: 'QR attendance', description: 'QR-code based attendance capture.' },
  { key: ENTITLEMENT_KEYS.ATTENDANCE_BIOMETRIC, module: FEATURE_KEYS.ATTENDANCE, name: 'Biometric attendance', description: 'Biometric device attendance capture.' },
  { key: ENTITLEMENT_KEYS.FEES_ONLINE_PAYMENT, module: FEATURE_KEYS.FEES, name: 'Online payments', description: 'Accept fee payments online through payment gateways.' },
  { key: ENTITLEMENT_KEYS.FEES_INSTALLMENT, module: FEATURE_KEYS.FEES, name: 'Installment plans', description: 'Split fee demands into installments.' },
  { key: ENTITLEMENT_KEYS.EXAMS_REVALUATION, module: FEATURE_KEYS.EXAMS, name: 'Revaluation', description: 'Result revaluation/retotalling workflow.' },
  { key: ENTITLEMENT_KEYS.ANALYTICS_ADVANCED, module: FEATURE_KEYS.REPORTS, name: 'Advanced analytics', description: 'Advanced BI/analytics dashboards and exports.' },
  { key: ENTITLEMENT_KEYS.AI_ASSISTANT, module: FEATURE_KEYS.REPORTS, name: 'AI assistant', description: 'AI-powered assistant across the platform.' },
  { key: ENTITLEMENT_KEYS.TRANSPORT_GPS, module: FEATURE_KEYS.TRANSPORT, name: 'GPS tracking', description: 'Live GPS vehicle tracking.' },
  { key: ENTITLEMENT_KEYS.LIBRARY_BARCODE, module: FEATURE_KEYS.LIBRARY, name: 'Barcode scanning', description: 'Barcode scanning for library check-in/out.' },
  { key: ENTITLEMENT_KEYS.MULTI_CAMPUS_ENABLED, module: FEATURE_KEYS.ACADEMICS, name: 'Multi-campus', description: 'Multiple campuses under one tenant.' },
  { key: ENTITLEMENT_KEYS.SSO_ENABLED, module: FEATURE_KEYS.INTEGRATIONS, name: 'Single sign-on', description: 'SSO / SAML / OIDC enterprise login.' },
];

/** Map granular entitlement key -> the module feature flag it belongs to. */
export const ENTITLEMENT_MODULE_MAP: Record<EntitlementKey, FeatureKey> = ENTITLEMENT_CATALOG.reduce(
  (acc, entry) => {
    acc[entry.key] = entry.module;
    return acc;
  },
  {} as Record<EntitlementKey, FeatureKey>,
);

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
