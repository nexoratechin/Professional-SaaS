/**
 * Centralized taxonomy for the platform_audit_logs trail (see AuditService in
 * apps/api/src/modules/audit). `AUDIT_MODULES` classifies WHICH subsystem produced an entry —
 * one key per apps/api/src/modules/* folder, mirroring FEATURE_KEYS/PERMISSION_KEYS' module
 * naming so the same word means the same subsystem everywhere in this codebase. Modules with no
 * controller yet (students…integrations) are reserved here for the same reason they're already
 * reserved in the permission/feature catalogs: so their future CRUD controller has a stable
 * module tag to log against from day one instead of inventing one later — no audit entries are
 * written for them until that business logic actually exists.
 *
 * `AUDIT_ACTIONS` centralizes the action-name string constants already in use across every
 * service that calls AuditService.record()/SecurityEventsService.record(), so every call site
 * references one shared, typo-proof source instead of a scattered string literal. `action`
 * remains a free-form string column (not a DB enum) — new modules can introduce new action
 * constants here without a migration, matching this project's "make permissions configurable"
 * philosophy applied to audit actions.
 */
export const AUDIT_MODULES = {
  AUTH: 'auth',
  RBAC: 'rbac',
  USERS: 'users',
  TENANTS: 'tenants',
  SAAS: 'saas',
  SECURITY: 'security',
  ORGANIZATION: 'organization',
  NOTIFICATIONS: 'notifications',
  DOCUMENTS: 'documents',
  WORKFLOWS: 'workflows',
  BILLING: 'billing',
  SUPPORT: 'support',
  /** Cross-cutting entries not owned by any one module (e.g. a cross-tenant access attempt). */
  PLATFORM: 'platform',

  // --- Reserved for modules with no controller yet (see doc comment above) ---
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
  REPORTS: 'reports',
  INTEGRATIONS: 'integrations',
} as const;

export type AuditModule = (typeof AUDIT_MODULES)[keyof typeof AUDIT_MODULES];

export const AUDIT_ACTIONS = {
  // --- Auth: login/logout (module AUTH) ---
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGOUT: 'LOGOUT',
  PLATFORM_LOGIN_SUCCESS: 'PLATFORM_LOGIN_SUCCESS',
  PLATFORM_LOGOUT: 'PLATFORM_LOGOUT',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  PLATFORM_ACCOUNT_LOCKED: 'PLATFORM_ACCOUNT_LOCKED',
  REFRESH_TOKEN_REUSE_DETECTED: 'REFRESH_TOKEN_REUSE_DETECTED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET_REQUESTED: 'PASSWORD_RESET_REQUESTED',
  PASSWORD_RESET_COMPLETED: 'PASSWORD_RESET_COMPLETED',
  EMAIL_VERIFICATION_REQUESTED: 'EMAIL_VERIFICATION_REQUESTED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  MFA_ENABLED: 'MFA_ENABLED',
  MFA_DISABLED: 'MFA_DISABLED',
  SESSION_REVOKED: 'SESSION_REVOKED',

  // --- RBAC: role/permission changes (module RBAC) ---
  ROLE_CREATED: 'ROLE_CREATED',
  ROLE_PERMISSIONS_UPDATED: 'ROLE_PERMISSIONS_UPDATED',
  ROLE_ASSIGNED: 'ROLE_ASSIGNED',
  ROLE_UNASSIGNED: 'ROLE_UNASSIGNED',

  // --- Users: user creation/status (module USERS) ---
  USER_INVITED: 'USER_INVITED',
  USER_STATUS_CHANGED: 'USER_STATUS_CHANGED',

  // --- Tenants: tenant/config changes (module TENANTS) ---
  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_STATUS_CHANGED: 'TENANT_STATUS_CHANGED',
  TENANT_SETTINGS_UPDATED: 'TENANT_SETTINGS_UPDATED',
  TENANT_FEATURE_OVERRIDE_SET: 'TENANT_FEATURE_OVERRIDE_SET',
  TENANT_CONFIGURATION_UPDATED: 'TENANT_CONFIGURATION_UPDATED',

  // --- Organization: campus/department/program/academic-year/term/room/building/section/batch
  // changes (module ORGANIZATION, see apps/api's organization module) ---
  CAMPUS_CREATED: 'CAMPUS_CREATED',
  CAMPUS_UPDATED: 'CAMPUS_UPDATED',
  CAMPUS_ARCHIVED: 'CAMPUS_ARCHIVED',
  DEPARTMENT_CREATED: 'DEPARTMENT_CREATED',
  DEPARTMENT_UPDATED: 'DEPARTMENT_UPDATED',
  DEPARTMENT_ARCHIVED: 'DEPARTMENT_ARCHIVED',
  PROGRAM_CREATED: 'PROGRAM_CREATED',
  PROGRAM_UPDATED: 'PROGRAM_UPDATED',
  PROGRAM_ARCHIVED: 'PROGRAM_ARCHIVED',
  ACADEMIC_YEAR_CREATED: 'ACADEMIC_YEAR_CREATED',
  ACADEMIC_YEAR_UPDATED: 'ACADEMIC_YEAR_UPDATED',
  ACADEMIC_YEAR_ARCHIVED: 'ACADEMIC_YEAR_ARCHIVED',
  TERM_CREATED: 'TERM_CREATED',
  TERM_UPDATED: 'TERM_UPDATED',
  TERM_ARCHIVED: 'TERM_ARCHIVED',
  ROOM_CREATED: 'ROOM_CREATED',
  ROOM_UPDATED: 'ROOM_UPDATED',
  ROOM_ARCHIVED: 'ROOM_ARCHIVED',
  BUILDING_CREATED: 'BUILDING_CREATED',
  BUILDING_UPDATED: 'BUILDING_UPDATED',
  BUILDING_ARCHIVED: 'BUILDING_ARCHIVED',
  SECTION_CREATED: 'SECTION_CREATED',
  SECTION_UPDATED: 'SECTION_UPDATED',
  SECTION_ARCHIVED: 'SECTION_ARCHIVED',
  BATCH_CREATED: 'BATCH_CREATED',
  BATCH_UPDATED: 'BATCH_UPDATED',
  BATCH_ARCHIVED: 'BATCH_ARCHIVED',
  ORGANIZATION_IMPORTED: 'ORGANIZATION_IMPORTED',
  ORGANIZATION_EXPORTED: 'ORGANIZATION_EXPORTED',

  // --- SaaS: subscriptions, plans, feature-flag catalog (module SAAS) ---
  SUBSCRIPTION_CREATED: 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_STATUS_CHANGED: 'SUBSCRIPTION_STATUS_CHANGED',
  SUBSCRIPTION_ITEM_ADDED: 'SUBSCRIPTION_ITEM_ADDED',
  SUBSCRIPTION_ITEM_UPDATED: 'SUBSCRIPTION_ITEM_UPDATED',
  SUBSCRIPTION_ITEM_REMOVED: 'SUBSCRIPTION_ITEM_REMOVED',
  PLAN_CREATED: 'PLAN_CREATED',
  PLAN_UPDATED: 'PLAN_UPDATED',
  PLAN_MODULES_UPDATED: 'PLAN_MODULES_UPDATED',
  FEATURE_FLAG_CREATED: 'FEATURE_FLAG_CREATED',
  FEATURE_FLAG_UPDATED: 'FEATURE_FLAG_UPDATED',
  ENTITLEMENT_OVERRIDE_SET: 'ENTITLEMENT_OVERRIDE_SET',

  // --- Security: configuration changes (module SECURITY) ---
  PLATFORM_SECURITY_SETTINGS_UPDATED: 'PLATFORM_SECURITY_SETTINGS_UPDATED',
  TENANT_SECURITY_SETTINGS_UPDATED: 'TENANT_SECURITY_SETTINGS_UPDATED',

  // --- Documents: document access (module DOCUMENTS) ---
  DOCUMENT_UPLOAD_REQUESTED: 'DOCUMENT_UPLOAD_REQUESTED',
  DOCUMENT_UPLOAD_CONFIRMED: 'DOCUMENT_UPLOAD_CONFIRMED',
  DOCUMENT_DOWNLOADED: 'DOCUMENT_DOWNLOADED',
  DOCUMENT_DELETED: 'DOCUMENT_DELETED',

  // --- Notifications (module NOTIFICATIONS) ---
  NOTIFICATION_QUEUED: 'NOTIFICATION_QUEUED',

  // --- Workflow engine (module WORKFLOWS) ---
  WORKFLOW_DEFINITION_CREATED: 'WORKFLOW_DEFINITION_CREATED',
  WORKFLOW_DEFINITION_ACTIVATED: 'WORKFLOW_DEFINITION_ACTIVATED',
  WORKFLOW_DEFINITION_DEACTIVATED: 'WORKFLOW_DEFINITION_DEACTIVATED',
  WORKFLOW_INSTANCE_STARTED: 'WORKFLOW_INSTANCE_STARTED',
  WORKFLOW_TASK_APPROVED: 'WORKFLOW_TASK_APPROVED',
  WORKFLOW_TASK_REJECTED: 'WORKFLOW_TASK_REJECTED',
  WORKFLOW_TRANSITIONED: 'WORKFLOW_TRANSITIONED',
  WORKFLOW_ESCALATED: 'WORKFLOW_ESCALATED',
  WORKFLOW_RESUBMITTED: 'WORKFLOW_RESUBMITTED',
  WORKFLOW_COMPLETED: 'WORKFLOW_COMPLETED',
  WORKFLOW_CANCELLED: 'WORKFLOW_CANCELLED',

  // --- Billing (module BILLING) ---
  INVOICE_GENERATED: 'INVOICE_GENERATED',
  INVOICE_MARKED_PAID: 'INVOICE_MARKED_PAID',
  INVOICE_VOIDED: 'INVOICE_VOIDED',
  /** Written by apps/worker's SubscriptionLifecycleProcessor sweep, not an HTTP request. */
  INVOICE_OVERDUE: 'INVOICE_OVERDUE',
  SUBSCRIPTION_PAST_DUE: 'SUBSCRIPTION_PAST_DUE',
  SUBSCRIPTION_EXPIRED: 'SUBSCRIPTION_EXPIRED',
  /** Written by apps/worker's SubscriptionLifecycleProcessor sweep when an overdue invoice's
   * due date passes the configured grace period — the tenant keeps access while PAST_DUE, then
   * loses it (SUSPENDED) once the grace period elapses. */
  SUBSCRIPTION_SUSPENDED_FOR_NONPAYMENT: 'SUBSCRIPTION_SUSPENDED_FOR_NONPAYMENT',
  /** Worker sweep renewal: a paid invoice for a fresh billing period + rolled period dates. */
  SUBSCRIPTION_RENEWED: 'SUBSCRIPTION_RENEWED',
  /** Upgrade/downgrade via a plan change with (typically) a prorated adjustment invoice. */
  SUBSCRIPTION_UPGRADED: 'SUBSCRIPTION_UPGRADED',
  SUBSCRIPTION_DOWNGRADED: 'SUBSCRIPTION_DOWNGRADED',
  SUBSCRIPTION_PLAN_CHANGED: 'SUBSCRIPTION_PLAN_CHANGED',
  /** Tenant/self-service or admin choice to stop auto-renewal at the current period end. */
  SUBSCRIPTION_CANCEL_SCHEDULED: 'SUBSCRIPTION_CANCEL_SCHEDULED',
  /** Reversing a scheduled end-of-period cancellation (subscription keeps auto-renewing). */
  SUBSCRIPTION_REINSTATED: 'SUBSCRIPTION_REINSTATED',
  SUBSCRIPTION_CANCELED: 'SUBSCRIPTION_CANCELED',
  PAYMENT_RECORDED: 'PAYMENT_RECORDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_RETRIED: 'PAYMENT_RETRIED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  /** Platform admin edits the SaaS-wide billing configuration (tax, numbering, grace/due days). */
  BILLING_CONFIG_UPDATED: 'BILLING_CONFIG_UPDATED',

  // --- Support tickets (module SUPPORT) ---
  SUPPORT_TICKET_CREATED: 'SUPPORT_TICKET_CREATED',
  SUPPORT_TICKET_UPDATED: 'SUPPORT_TICKET_UPDATED',
  SUPPORT_TICKET_ASSIGNED: 'SUPPORT_TICKET_ASSIGNED',
  SUPPORT_TICKET_COMMENTED: 'SUPPORT_TICKET_COMMENTED',

  // --- Cross-cutting (module PLATFORM) ---
  CROSS_TENANT_ACCESS_ATTEMPT: 'CROSS_TENANT_ACCESS_ATTEMPT',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];
