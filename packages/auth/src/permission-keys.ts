/**
 * Tenant-scoped RBAC permission catalog. Single source of truth, consumed by
 * packages/database/prisma/seed.ts (to populate the Permission table) and by apps/api's
 * @RequirePermission() decorator call sites.
 *
 * Every permission has a stable string `key` (what code references — never renamed once a
 * controller depends on it) plus structured `module`/`action` metadata (what makes this
 * "hierarchical" RBAC rather than a flat list of opaque strings): `action` is one of the nine
 * canonical actions below, mirrored 1:1 by the Prisma `PermissionAction` enum. A key's string
 * doesn't have to spell out its action verbatim (e.g. `notifications.send` is action CREATE) —
 * the key is an identifier, the action field is the queryable classification.
 *
 * Modules with a real controller today: tenants (self-service), users, roles, audit,
 * organization (campuses/departments/programs/academic-years/terms/rooms/buildings/sections/
 * batches — full CRUD API in apps/api's organization module), notifications, documents.
 * Every other module below
 * (students…integrations, matching the blueprint's full product map) has no controller yet —
 * their permissions exist now so the 13 default tenant roles (see DEFAULT_ROLE_DEFINITIONS)
 * have real, differentiated grants to seed, and so each module's future CRUD controller has a
 * stable permission catalog to enforce against from day one instead of inventing one later.
 */

export const PERMISSION_ACTIONS = {
  VIEW: 'VIEW',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  APPROVE: 'APPROVE',
  PUBLISH: 'PUBLISH',
  EXPORT: 'EXPORT',
  REFUND: 'REFUND',
  MANAGE: 'MANAGE',
} as const;

export type PermissionAction = (typeof PERMISSION_ACTIONS)[keyof typeof PERMISSION_ACTIONS];

/** MANAGE on a module implies full CRUD on that module. PermissionsService expands this at
 * effective-permission-resolution time by looking up whichever VIEW/CREATE/UPDATE/DELETE
 * permissions actually EXIST for a managed module (DB-driven, not this hardcoded list applied
 * blindly) — so granting `fees.manage` to a role also grants `fees.view`/`fees.create`/
 * `fees.update` without a separate RolePermission row for each. */
export const ACTIONS_IMPLIED_BY_MANAGE: readonly PermissionAction[] = [
  PERMISSION_ACTIONS.VIEW,
  PERMISSION_ACTIONS.CREATE,
  PERMISSION_ACTIONS.UPDATE,
  PERMISSION_ACTIONS.DELETE,
];

export const PERMISSION_SCOPE_TYPES = {
  GLOBAL: 'GLOBAL',
  CAMPUS: 'CAMPUS',
  DEPARTMENT: 'DEPARTMENT',
  PROGRAM: 'PROGRAM',
  OWN: 'OWN',
} as const;

export type PermissionScopeType = (typeof PERMISSION_SCOPE_TYPES)[keyof typeof PERMISSION_SCOPE_TYPES];

export const PERMISSION_KEYS = {
  // --- Foundation (has controllers) ---
  TENANT_SETTINGS_MANAGE: 'tenant.settings.manage',
  TENANT_FEATURES_VIEW: 'tenant.features.view',
  TENANT_BILLING_VIEW: 'tenant.billing.view',
  TENANT_CONFIG_VIEW: 'tenant.config.view',
  TENANT_CONFIG_MANAGE: 'tenant.config.manage',
  BILLING_UPDATE: 'billing.update',
  USERS_VIEW: 'users.read',
  USERS_MANAGE: 'users.manage',
  ROLES_VIEW: 'roles.read',
  ROLES_MANAGE: 'roles.manage',
  AUDIT_VIEW: 'audit.read',
  SECURITY_SETTINGS_VIEW: 'security.settings.view',
  SECURITY_SETTINGS_MANAGE: 'security.settings.manage',
  SECURITY_EVENTS_VIEW: 'security.events.view',

  // --- Organization (full CRUD API in apps/api's organization module) ---
  CAMPUSES_VIEW: 'campuses.read',
  CAMPUSES_MANAGE: 'campuses.manage',
  DEPARTMENTS_VIEW: 'departments.read',
  DEPARTMENTS_MANAGE: 'departments.manage',
  PROGRAMS_VIEW: 'programs.view',
  PROGRAMS_MANAGE: 'programs.manage',
  ACADEMIC_YEARS_VIEW: 'academic_years.read',
  ACADEMIC_YEARS_MANAGE: 'academic_years.manage',
  TERMS_VIEW: 'terms.read',
  TERMS_MANAGE: 'terms.manage',
  ROOMS_VIEW: 'rooms.read',
  ROOMS_MANAGE: 'rooms.manage',
  BUILDINGS_VIEW: 'buildings.read',
  BUILDINGS_MANAGE: 'buildings.manage',
  SECTIONS_VIEW: 'sections.read',
  SECTIONS_MANAGE: 'sections.manage',
  BATCHES_VIEW: 'batches.read',
  BATCHES_MANAGE: 'batches.manage',

  // --- Notifications / Documents (have controllers) ---
  NOTIFICATIONS_VIEW: 'notifications.read',
  NOTIFICATIONS_SEND: 'notifications.send',
  NOTIFICATIONS_TEMPLATES_MANAGE: 'notifications.templates.manage',
  NOTIFICATIONS_CAMPAIGNS_MANAGE: 'notifications.campaigns.manage',
  NOTIFICATIONS_TRIGGERS_MANAGE: 'notifications.triggers.manage',
  NOTIFICATIONS_CONFIG_MANAGE: 'notifications.config.manage',
  DOCUMENTS_VIEW: 'documents.read',
  DOCUMENTS_MANAGE: 'documents.manage',
  DOCUMENTS_APPROVE: 'documents.approve',

  // --- Student 360 ---
  STUDENTS_VIEW: 'students.view',
  STUDENTS_CREATE: 'students.create',
  STUDENTS_UPDATE: 'students.update',
  STUDENTS_DELETE: 'students.delete',
  STUDENTS_EXPORT: 'students.export',
  STUDENTS_MANAGE: 'students.manage',

  // --- Academics (curriculum/courses/enrollment) ---
  ACADEMICS_VIEW: 'academics.view',
  ACADEMICS_CREATE: 'academics.create',
  ACADEMICS_UPDATE: 'academics.update',
  ACADEMICS_DELETE: 'academics.delete',
  ACADEMICS_MANAGE: 'academics.manage',

  // --- Timetable ---
  TIMETABLE_VIEW: 'timetable.view',
  TIMETABLE_CREATE: 'timetable.create',
  TIMETABLE_UPDATE: 'timetable.update',
  TIMETABLE_PUBLISH: 'timetable.publish',
  TIMETABLE_MANAGE: 'timetable.manage',

  // --- Attendance ---
  ATTENDANCE_VIEW: 'attendance.view',
  ATTENDANCE_CREATE: 'attendance.create',
  ATTENDANCE_UPDATE: 'attendance.update',
  ATTENDANCE_EXPORT: 'attendance.export',
  ATTENDANCE_MANAGE: 'attendance.manage',

  // --- Admissions ---
  ADMISSIONS_VIEW: 'admissions.view',
  ADMISSIONS_CREATE: 'admissions.create',
  ADMISSIONS_UPDATE: 'admissions.update',
  ADMISSIONS_APPROVE: 'admissions.approve',
  ADMISSIONS_EXPORT: 'admissions.export',
  ADMISSIONS_MANAGE: 'admissions.manage',

  // --- Fees ---
  FEES_VIEW: 'fees.view',
  FEES_CREATE: 'fees.create',
  FEES_UPDATE: 'fees.update',
  FEES_REFUND: 'fees.refund',
  FEES_EXPORT: 'fees.export',
  FEES_MANAGE: 'fees.manage',

  // --- Payments ---
  PAYMENTS_VIEW: 'payments.view',
  PAYMENTS_CREATE: 'payments.create',
  PAYMENTS_EXPORT: 'payments.export',
  PAYMENTS_MANAGE: 'payments.manage',

  // --- Exams ---
  EXAMS_VIEW: 'exams.view',
  EXAMS_CREATE: 'exams.create',
  EXAMS_UPDATE: 'exams.update',
  EXAMS_APPROVE: 'exams.approve',
  EXAMS_PUBLISH: 'exams.publish',
  EXAMS_MANAGE: 'exams.manage',

  // --- Results ---
  RESULTS_VIEW: 'results.view',
  RESULTS_PUBLISH: 'results.publish',
  RESULTS_EXPORT: 'results.export',
  RESULTS_MANAGE: 'results.manage',

  // --- Certificates ---
  CERTIFICATES_VIEW: 'certificates.view',
  CERTIFICATES_CREATE: 'certificates.create',
  CERTIFICATES_APPROVE: 'certificates.approve',
  CERTIFICATES_EXPORT: 'certificates.export',
  CERTIFICATES_MANAGE: 'certificates.manage',

  // --- Library ---
  LIBRARY_VIEW: 'library.view',
  LIBRARY_CREATE: 'library.create',
  LIBRARY_UPDATE: 'library.update',
  LIBRARY_DELETE: 'library.delete',
  LIBRARY_MANAGE: 'library.manage',

  // --- Hostel ---
  HOSTEL_VIEW: 'hostel.view',
  HOSTEL_CREATE: 'hostel.create',
  HOSTEL_UPDATE: 'hostel.update',
  HOSTEL_DELETE: 'hostel.delete',
  HOSTEL_MANAGE: 'hostel.manage',

  // --- Transport ---
  TRANSPORT_VIEW: 'transport.view',
  TRANSPORT_CREATE: 'transport.create',
  TRANSPORT_UPDATE: 'transport.update',
  TRANSPORT_DELETE: 'transport.delete',
  TRANSPORT_MANAGE: 'transport.manage',

  // --- HR / Faculty employment ---
  HR_VIEW: 'hr.view',
  HR_CREATE: 'hr.create',
  HR_UPDATE: 'hr.update',
  HR_DELETE: 'hr.delete',
  HR_EXPORT: 'hr.export',
  HR_MANAGE: 'hr.manage',

  // --- Placements ---
  PLACEMENTS_VIEW: 'placements.view',
  PLACEMENTS_CREATE: 'placements.create',
  PLACEMENTS_UPDATE: 'placements.update',
  PLACEMENTS_APPROVE: 'placements.approve',
  PLACEMENTS_EXPORT: 'placements.export',
  PLACEMENTS_MANAGE: 'placements.manage',

  // --- Inventory / Assets ---
  INVENTORY_VIEW: 'inventory.view',
  INVENTORY_CREATE: 'inventory.create',
  INVENTORY_UPDATE: 'inventory.update',
  INVENTORY_DELETE: 'inventory.delete',
  INVENTORY_MANAGE: 'inventory.manage',

  // --- Helpdesk / Feedback ---
  HELPDESK_VIEW: 'helpdesk.view',
  HELPDESK_CREATE: 'helpdesk.create',
  HELPDESK_UPDATE: 'helpdesk.update',
  HELPDESK_DELETE: 'helpdesk.delete',
  HELPDESK_EXPORT: 'helpdesk.export',
  HELPDESK_MANAGE: 'helpdesk.manage',

  // --- Reports / Analytics ---
  REPORTS_VIEW: 'reports.view',
  REPORTS_EXPORT: 'reports.export',
  REPORTS_MANAGE: 'reports.manage',

  // --- External integrations ---
  INTEGRATIONS_VIEW: 'integrations.view',
  INTEGRATIONS_MANAGE: 'integrations.manage',

  // --- Workflow engine (has a controller — see apps/api's workflow module) ---
  WORKFLOWS_VIEW: 'workflows.view',
  WORKFLOWS_APPROVE: 'workflows.approve',
  WORKFLOWS_MANAGE: 'workflows.manage',
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

export interface PermissionCatalogEntry {
  key: PermissionKey;
  module: string;
  action: PermissionAction;
  description: string;
}

const { VIEW, CREATE, UPDATE, DELETE, APPROVE, PUBLISH, EXPORT, REFUND, MANAGE } = PERMISSION_ACTIONS;

/** Builds the repetitive `{module}.{action}`-style entries; irregular ones (tenant self-service)
 * are listed separately below since they don't fit the one-key-per-action-per-module shape. */
function modulePermissions(
  module: string,
  entries: Array<[key: PermissionKey, action: PermissionAction, description: string]>,
): PermissionCatalogEntry[] {
  return entries.map(([key, action, description]) => ({ key, module, action, description }));
}

export const PERMISSION_CATALOG: PermissionCatalogEntry[] = [
  {
    key: PERMISSION_KEYS.TENANT_SETTINGS_MANAGE,
    module: 'tenants',
    action: MANAGE,
    description: 'Manage tenant profile/settings (name, branding, timezone).',
  },
  {
    key: PERMISSION_KEYS.TENANT_FEATURES_VIEW,
    module: 'tenants',
    action: VIEW,
    description: "View the tenant's effective feature flags.",
  },
  {
    key: PERMISSION_KEYS.TENANT_BILLING_VIEW,
    module: 'tenants',
    action: VIEW,
    description: "View the tenant's own invoices and billing history.",
  },
  {
    key: PERMISSION_KEYS.BILLING_UPDATE,
    module: 'billing',
    action: UPDATE,
    description:
      "Manage the tenant's own subscription billing: upgrade/downgrade the plan, cancel or reinstate at the current period end.",
  },
  {
    key: PERMISSION_KEYS.TENANT_CONFIG_VIEW,
    module: 'tenants',
    action: VIEW,
    description: "View the tenant's configuration engine document (branding, academic calendar, fee rules, etc.).",
  },
  {
    key: PERMISSION_KEYS.TENANT_CONFIG_MANAGE,
    module: 'tenants',
    action: MANAGE,
    description: "Manage the tenant's configuration engine document (branding, academic calendar, fee rules, etc.).",
  },
  ...modulePermissions('users', [
    [PERMISSION_KEYS.USERS_VIEW, VIEW, 'View users within the tenant.'],
    [PERMISSION_KEYS.USERS_MANAGE, MANAGE, 'Invite, activate, suspend, and deactivate tenant users.'],
    [PERMISSION_KEYS.ROLES_VIEW, VIEW, 'View roles and their permissions.'],
    [
      PERMISSION_KEYS.ROLES_MANAGE,
      MANAGE,
      'Create custom roles, assign permissions, and assign roles to users (system roles are protected).',
    ],
  ]),
  ...modulePermissions('audit', [[PERMISSION_KEYS.AUDIT_VIEW, VIEW, "View the tenant's audit log."]]),
  ...modulePermissions('security', [
    [PERMISSION_KEYS.SECURITY_SETTINGS_VIEW, VIEW, "View the tenant's security policy (MFA enforcement, lockout, password history, trusted devices)."],
    [PERMISSION_KEYS.SECURITY_SETTINGS_MANAGE, MANAGE, "Manage the tenant's security policy."],
    [PERMISSION_KEYS.SECURITY_EVENTS_VIEW, VIEW, "View the tenant's security event feed (MFA changes, suspicious logins, lockouts)."],
  ]),
  ...modulePermissions('organization', [
    [PERMISSION_KEYS.CAMPUSES_VIEW, VIEW, 'View campuses.'],
    [PERMISSION_KEYS.CAMPUSES_MANAGE, MANAGE, 'Create, update, and archive campuses.'],
    [PERMISSION_KEYS.DEPARTMENTS_VIEW, VIEW, 'View departments.'],
    [PERMISSION_KEYS.DEPARTMENTS_MANAGE, MANAGE, 'Create, update, and archive departments.'],
    [PERMISSION_KEYS.PROGRAMS_VIEW, VIEW, 'View academic programs.'],
    [PERMISSION_KEYS.PROGRAMS_MANAGE, MANAGE, 'Create, update, and archive academic programs.'],
    [PERMISSION_KEYS.ACADEMIC_YEARS_VIEW, VIEW, 'View academic years.'],
    [PERMISSION_KEYS.ACADEMIC_YEARS_MANAGE, MANAGE, 'Create, update, and archive academic years.'],
    [PERMISSION_KEYS.TERMS_VIEW, VIEW, 'View terms.'],
    [PERMISSION_KEYS.TERMS_MANAGE, MANAGE, 'Create, update, and archive terms within an academic year.'],
    [PERMISSION_KEYS.ROOMS_VIEW, VIEW, 'View rooms.'],
    [PERMISSION_KEYS.ROOMS_MANAGE, MANAGE, 'Create, update, and archive rooms.'],
    [PERMISSION_KEYS.BUILDINGS_VIEW, VIEW, 'View buildings.'],
    [PERMISSION_KEYS.BUILDINGS_MANAGE, MANAGE, 'Create, update, and archive buildings.'],
    [PERMISSION_KEYS.SECTIONS_VIEW, VIEW, 'View sections.'],
    [PERMISSION_KEYS.SECTIONS_MANAGE, MANAGE, 'Create, update, and archive sections.'],
    [PERMISSION_KEYS.BATCHES_VIEW, VIEW, 'View batches.'],
    [PERMISSION_KEYS.BATCHES_MANAGE, MANAGE, 'Create, update, and archive batches.'],
  ]),
  ...modulePermissions('notifications', [
    [PERMISSION_KEYS.NOTIFICATIONS_VIEW, VIEW, "View the tenant's notification history, campaigns and delivery logs."],
    [PERMISSION_KEYS.NOTIFICATIONS_SEND, CREATE, 'Send notifications to tenant users.'],
    [PERMISSION_KEYS.NOTIFICATIONS_TEMPLATES_MANAGE, MANAGE, 'Create, edit and archive notification templates.'],
    [PERMISSION_KEYS.NOTIFICATIONS_CAMPAIGNS_MANAGE, MANAGE, 'Create, schedule, launch, and cancel notification campaigns.'],
    [PERMISSION_KEYS.NOTIFICATIONS_TRIGGERS_MANAGE, MANAGE, 'Map event keys to notification templates (event-triggered notifications).'],
    [PERMISSION_KEYS.NOTIFICATIONS_CONFIG_MANAGE, MANAGE, 'Configure tenant sender providers (SMTP, SMS/WhatsApp/push gateways).'],
  ]),
  ...modulePermissions('documents', [
    [
      PERMISSION_KEYS.DOCUMENTS_VIEW,
      VIEW,
      "View and download the tenant's documents (subject to per-document access grants).",
    ],
    [
      PERMISSION_KEYS.DOCUMENTS_MANAGE,
      MANAGE,
      'Upload, replace, expire, delete, and share tenant documents; manage document types and access grants.',
    ],
    [
      PERMISSION_KEYS.DOCUMENTS_APPROVE,
      APPROVE,
      'Verify or reject tenant documents (reviewers).',
    ],
  ]),
  ...modulePermissions('students', [
    [PERMISSION_KEYS.STUDENTS_VIEW, VIEW, 'View student profiles.'],
    [PERMISSION_KEYS.STUDENTS_CREATE, CREATE, 'Create student profiles.'],
    [PERMISSION_KEYS.STUDENTS_UPDATE, UPDATE, 'Update student profiles.'],
    [PERMISSION_KEYS.STUDENTS_DELETE, DELETE, 'Remove student profiles.'],
    [PERMISSION_KEYS.STUDENTS_EXPORT, EXPORT, 'Export student data.'],
    [PERMISSION_KEYS.STUDENTS_MANAGE, MANAGE, 'Full student-record management.'],
  ]),
  ...modulePermissions('academics', [
    [PERMISSION_KEYS.ACADEMICS_VIEW, VIEW, 'View courses, curricula, and enrollments.'],
    [PERMISSION_KEYS.ACADEMICS_CREATE, CREATE, 'Create courses/curricula/course offerings.'],
    [PERMISSION_KEYS.ACADEMICS_UPDATE, UPDATE, 'Update courses/curricula/enrollments.'],
    [PERMISSION_KEYS.ACADEMICS_DELETE, DELETE, 'Remove courses/curricula.'],
    [PERMISSION_KEYS.ACADEMICS_MANAGE, MANAGE, 'Full academics management.'],
  ]),
  ...modulePermissions('timetable', [
    [PERMISSION_KEYS.TIMETABLE_VIEW, VIEW, 'View timetables.'],
    [PERMISSION_KEYS.TIMETABLE_CREATE, CREATE, 'Create timetable slots.'],
    [PERMISSION_KEYS.TIMETABLE_UPDATE, UPDATE, 'Update timetable slots.'],
    [PERMISSION_KEYS.TIMETABLE_PUBLISH, PUBLISH, 'Publish the timetable to students/faculty.'],
    [PERMISSION_KEYS.TIMETABLE_MANAGE, MANAGE, 'Full timetable management.'],
  ]),
  ...modulePermissions('attendance', [
    [PERMISSION_KEYS.ATTENDANCE_VIEW, VIEW, 'View attendance records.'],
    [PERMISSION_KEYS.ATTENDANCE_CREATE, CREATE, 'Take attendance.'],
    [PERMISSION_KEYS.ATTENDANCE_UPDATE, UPDATE, 'Correct attendance records.'],
    [PERMISSION_KEYS.ATTENDANCE_EXPORT, EXPORT, 'Export attendance data.'],
    [PERMISSION_KEYS.ATTENDANCE_MANAGE, MANAGE, 'Full attendance management, incl. rules/thresholds.'],
  ]),
  ...modulePermissions('admissions', [
    [PERMISSION_KEYS.ADMISSIONS_VIEW, VIEW, 'View enquiries and applications.'],
    [PERMISSION_KEYS.ADMISSIONS_CREATE, CREATE, 'Create enquiries/applications.'],
    [PERMISSION_KEYS.ADMISSIONS_UPDATE, UPDATE, 'Update/verify applications.'],
    [PERMISSION_KEYS.ADMISSIONS_APPROVE, APPROVE, 'Approve/reject applications and offers.'],
    [PERMISSION_KEYS.ADMISSIONS_EXPORT, EXPORT, 'Export admissions data.'],
    [PERMISSION_KEYS.ADMISSIONS_MANAGE, MANAGE, 'Full admissions management.'],
  ]),
  ...modulePermissions('fees', [
    [PERMISSION_KEYS.FEES_VIEW, VIEW, 'View fee structures and demands.'],
    [PERMISSION_KEYS.FEES_CREATE, CREATE, 'Create fee structures/demands.'],
    [PERMISSION_KEYS.FEES_UPDATE, UPDATE, 'Update fee structures/demands/concessions.'],
    [PERMISSION_KEYS.FEES_REFUND, REFUND, 'Issue fee refunds.'],
    [PERMISSION_KEYS.FEES_EXPORT, EXPORT, 'Export fee data.'],
    [PERMISSION_KEYS.FEES_MANAGE, MANAGE, 'Full fee management.'],
  ]),
  ...modulePermissions('payments', [
    [PERMISSION_KEYS.PAYMENTS_VIEW, VIEW, 'View payment transactions.'],
    [PERMISSION_KEYS.PAYMENTS_CREATE, CREATE, 'Record/initiate payments.'],
    [PERMISSION_KEYS.PAYMENTS_EXPORT, EXPORT, 'Export payment/reconciliation data.'],
    [PERMISSION_KEYS.PAYMENTS_MANAGE, MANAGE, 'Full payments management.'],
  ]),
  ...modulePermissions('exams', [
    [PERMISSION_KEYS.EXAMS_VIEW, VIEW, 'View exam sessions and registrations.'],
    [PERMISSION_KEYS.EXAMS_CREATE, CREATE, 'Create exam sessions and seating.'],
    [PERMISSION_KEYS.EXAMS_UPDATE, UPDATE, 'Update exam sessions/marks entry.'],
    [PERMISSION_KEYS.EXAMS_APPROVE, APPROVE, 'Approve/moderate marks.'],
    [PERMISSION_KEYS.EXAMS_PUBLISH, PUBLISH, 'Publish exam schedules/admit cards.'],
    [PERMISSION_KEYS.EXAMS_MANAGE, MANAGE, 'Full exam management.'],
  ]),
  ...modulePermissions('results', [
    [PERMISSION_KEYS.RESULTS_VIEW, VIEW, 'View results.'],
    [PERMISSION_KEYS.RESULTS_PUBLISH, PUBLISH, 'Publish results.'],
    [PERMISSION_KEYS.RESULTS_EXPORT, EXPORT, 'Export result data.'],
    [PERMISSION_KEYS.RESULTS_MANAGE, MANAGE, 'Full results management.'],
  ]),
  ...modulePermissions('certificates', [
    [PERMISSION_KEYS.CERTIFICATES_VIEW, VIEW, 'View certificate/transcript requests.'],
    [PERMISSION_KEYS.CERTIFICATES_CREATE, CREATE, 'Generate certificates/transcripts.'],
    [PERMISSION_KEYS.CERTIFICATES_APPROVE, APPROVE, 'Approve certificate issuance.'],
    [PERMISSION_KEYS.CERTIFICATES_EXPORT, EXPORT, 'Export certificate records.'],
    [PERMISSION_KEYS.CERTIFICATES_MANAGE, MANAGE, 'Full certificate management.'],
  ]),
  ...modulePermissions('library', [
    [PERMISSION_KEYS.LIBRARY_VIEW, VIEW, 'View catalog, copies, and loans.'],
    [PERMISSION_KEYS.LIBRARY_CREATE, CREATE, 'Add catalog items; issue loans.'],
    [PERMISSION_KEYS.LIBRARY_UPDATE, UPDATE, 'Update catalog items/loans/returns.'],
    [PERMISSION_KEYS.LIBRARY_DELETE, DELETE, 'Remove catalog items.'],
    [PERMISSION_KEYS.LIBRARY_MANAGE, MANAGE, 'Full library management, incl. fines.'],
  ]),
  ...modulePermissions('hostel', [
    [PERMISSION_KEYS.HOSTEL_VIEW, VIEW, 'View hostels, rooms, and allocations.'],
    [PERMISSION_KEYS.HOSTEL_CREATE, CREATE, 'Create hostel allocations.'],
    [PERMISSION_KEYS.HOSTEL_UPDATE, UPDATE, 'Update hostel allocations.'],
    [PERMISSION_KEYS.HOSTEL_DELETE, DELETE, 'Remove hostel allocations.'],
    [PERMISSION_KEYS.HOSTEL_MANAGE, MANAGE, 'Full hostel management.'],
  ]),
  ...modulePermissions('transport', [
    [PERMISSION_KEYS.TRANSPORT_VIEW, VIEW, 'View routes, vehicles, and passes.'],
    [PERMISSION_KEYS.TRANSPORT_CREATE, CREATE, 'Create routes/passes.'],
    [PERMISSION_KEYS.TRANSPORT_UPDATE, UPDATE, 'Update routes/passes.'],
    [PERMISSION_KEYS.TRANSPORT_DELETE, DELETE, 'Remove routes/passes.'],
    [PERMISSION_KEYS.TRANSPORT_MANAGE, MANAGE, 'Full transport management.'],
  ]),
  ...modulePermissions('hr', [
    [PERMISSION_KEYS.HR_VIEW, VIEW, 'View employee records, leave, and workload.'],
    [PERMISSION_KEYS.HR_CREATE, CREATE, 'Create employee records.'],
    [PERMISSION_KEYS.HR_UPDATE, UPDATE, 'Update employee records/leave.'],
    [PERMISSION_KEYS.HR_DELETE, DELETE, 'Remove employee records.'],
    [PERMISSION_KEYS.HR_EXPORT, EXPORT, 'Export HR data.'],
    [PERMISSION_KEYS.HR_MANAGE, MANAGE, 'Full HR management, incl. payroll integration.'],
  ]),
  ...modulePermissions('placements', [
    [PERMISSION_KEYS.PLACEMENTS_VIEW, VIEW, 'View companies, drives, and applications.'],
    [PERMISSION_KEYS.PLACEMENTS_CREATE, CREATE, 'Create placement drives.'],
    [PERMISSION_KEYS.PLACEMENTS_UPDATE, UPDATE, 'Update drives/applications.'],
    [PERMISSION_KEYS.PLACEMENTS_APPROVE, APPROVE, 'Approve student eligibility/offers.'],
    [PERMISSION_KEYS.PLACEMENTS_EXPORT, EXPORT, 'Export placement data.'],
    [PERMISSION_KEYS.PLACEMENTS_MANAGE, MANAGE, 'Full placements management.'],
  ]),
  ...modulePermissions('inventory', [
    [PERMISSION_KEYS.INVENTORY_VIEW, VIEW, 'View inventory/assets.'],
    [PERMISSION_KEYS.INVENTORY_CREATE, CREATE, 'Create purchase/asset records.'],
    [PERMISSION_KEYS.INVENTORY_UPDATE, UPDATE, 'Update stock/asset records.'],
    [PERMISSION_KEYS.INVENTORY_DELETE, DELETE, 'Remove inventory/asset records.'],
    [PERMISSION_KEYS.INVENTORY_MANAGE, MANAGE, 'Full inventory management.'],
  ]),
  ...modulePermissions('helpdesk', [
    [PERMISSION_KEYS.HELPDESK_VIEW, VIEW, 'View helpdesk tickets, categories, departments, and SLA policies.'],
    [PERMISSION_KEYS.HELPDESK_CREATE, CREATE, 'Raise helpdesk tickets and add comments/attachments.'],
    [PERMISSION_KEYS.HELPDESK_UPDATE, UPDATE, 'Update, assign, resolve, close, and reopen helpdesk tickets.'],
    [PERMISSION_KEYS.HELPDESK_DELETE, DELETE, 'Delete helpdesk tickets.'],
    [PERMISSION_KEYS.HELPDESK_EXPORT, EXPORT, 'Export helpdesk reports.'],
    [
      PERMISSION_KEYS.HELPDESK_MANAGE,
      MANAGE,
      'Full helpdesk management: SLA policies, escalation, categories, departments, and ticket administration.',
    ],
  ]),
  ...modulePermissions('reports', [
    [PERMISSION_KEYS.REPORTS_VIEW, VIEW, 'View management/operational reports and dashboards.'],
    [PERMISSION_KEYS.REPORTS_EXPORT, EXPORT, 'Export reports.'],
    [PERMISSION_KEYS.REPORTS_MANAGE, MANAGE, 'Manage saved reports, templates, schedules, and report runs.'],
  ]),
  ...modulePermissions('integrations', [
    [PERMISSION_KEYS.INTEGRATIONS_VIEW, VIEW, 'View configured external integrations.'],
    [PERMISSION_KEYS.INTEGRATIONS_MANAGE, MANAGE, 'Configure external integrations.'],
  ]),
  ...modulePermissions('workflows', [
    [PERMISSION_KEYS.WORKFLOWS_VIEW, VIEW, 'View workflow definitions, instances, and their history.'],
    [
      PERMISSION_KEYS.WORKFLOWS_APPROVE,
      APPROVE,
      'Act (approve/reject) on workflow approval tasks assigned to a role the user holds.',
    ],
    [
      PERMISSION_KEYS.WORKFLOWS_MANAGE,
      MANAGE,
      'Define and configure workflow definitions (states, transitions, approvers) for the tenant.',
    ],
  ]),
];

/** System roles seeded for every tenant at provisioning time (RolesService/RolesController
 * refuse to modify permissions on, or delete, any role with isSystem=true). TENANT_ADMIN
 * ("College Admin") is provisioned separately with every currently-defined permission at
 * GLOBAL scope (see TenantProvisioningService) rather than a fixed grant list — it's meant to
 * always have everything, including permissions added after this catalog was last extended.
 * "SaaS Super Admin" from the product's role list is NOT one of these: it's the existing
 * platform control-plane's PlatformUserRole.PLATFORM_ADMIN, a different, tenant-less realm —
 * creating a duplicate tenant-scoped role for it would misrepresent that separation. */
export const SYSTEM_ROLE_CODES = {
  TENANT_ADMIN: 'TENANT_ADMIN',
  PRINCIPAL: 'PRINCIPAL',
  REGISTRAR: 'REGISTRAR',
  HOD: 'HOD',
  FACULTY: 'FACULTY',
  ACCOUNTANT: 'ACCOUNTANT',
  EXAM_CONTROLLER: 'EXAM_CONTROLLER',
  LIBRARIAN: 'LIBRARIAN',
  HOSTEL_WARDEN: 'HOSTEL_WARDEN',
  TRANSPORT_MANAGER: 'TRANSPORT_MANAGER',
  HR: 'HR',
  PLACEMENT_OFFICER: 'PLACEMENT_OFFICER',
  STUDENT: 'STUDENT',
  PARENT: 'PARENT',
} as const;

export interface DefaultRolePermissionGrant {
  key: PermissionKey;
  /** Defaults to GLOBAL when omitted. */
  scopeType?: PermissionScopeType;
}

export interface DefaultRoleDefinition {
  code: string;
  name: string;
  description: string;
  grants: DefaultRolePermissionGrant[];
}

const K = PERMISSION_KEYS;
const S = PERMISSION_SCOPE_TYPES;

/** The 13 non-admin default roles seeded for every new tenant (TENANT_ADMIN/"College Admin" is
 * seeded separately — see SYSTEM_ROLE_CODES doc comment). Scope types here describe what the
 * ROLE grants; the concrete campus/department/program a given holder is bound to is set on
 * their UserRole at assignment time (see UsersService.assignRole). */
export const DEFAULT_ROLE_DEFINITIONS: DefaultRoleDefinition[] = [
  {
    code: SYSTEM_ROLE_CODES.PRINCIPAL,
    name: 'Principal',
    description: 'Institution-wide oversight: broad visibility plus approval authority on key workflows.',
    grants: [
      { key: K.USERS_VIEW },
      { key: K.ROLES_VIEW },
      { key: K.AUDIT_VIEW },
      { key: K.SECURITY_EVENTS_VIEW },
      { key: K.STUDENTS_VIEW },
      { key: K.ACADEMICS_VIEW },
      { key: K.TIMETABLE_VIEW },
      { key: K.ATTENDANCE_VIEW },
      { key: K.ADMISSIONS_VIEW },
      { key: K.ADMISSIONS_APPROVE },
      { key: K.FEES_VIEW },
      { key: K.EXAMS_VIEW },
      { key: K.EXAMS_APPROVE },
      { key: K.RESULTS_VIEW },
      { key: K.RESULTS_PUBLISH },
      { key: K.CERTIFICATES_VIEW },
      { key: K.CERTIFICATES_APPROVE },
      { key: K.LIBRARY_VIEW },
      { key: K.HOSTEL_VIEW },
      { key: K.TRANSPORT_VIEW },
      { key: K.HR_VIEW },
      { key: K.PLACEMENTS_VIEW },
      { key: K.REPORTS_VIEW },
      { key: K.REPORTS_EXPORT },
      { key: K.REPORTS_MANAGE },
      { key: K.NOTIFICATIONS_VIEW },
      { key: K.DOCUMENTS_VIEW },
      { key: K.DOCUMENTS_APPROVE },
      { key: K.WORKFLOWS_VIEW },
      { key: K.WORKFLOWS_APPROVE },
      { key: K.HELPDESK_VIEW },
      { key: K.HELPDESK_MANAGE },
      { key: K.HELPDESK_EXPORT },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.REGISTRAR,
    name: 'Registrar',
    description: 'Owns admissions, student records, and academic administration.',
    grants: [
      { key: K.STUDENTS_MANAGE },
      { key: K.ACADEMICS_MANAGE },
      { key: K.TIMETABLE_CREATE },
      { key: K.TIMETABLE_UPDATE },
      { key: K.TIMETABLE_PUBLISH },
      { key: K.TIMETABLE_MANAGE },
      { key: K.ADMISSIONS_MANAGE },
      { key: K.CERTIFICATES_MANAGE },
      { key: K.CAMPUSES_VIEW },
      { key: K.DEPARTMENTS_VIEW },
      { key: K.PROGRAMS_VIEW },
      { key: K.ACADEMIC_YEARS_VIEW },
      { key: K.TERMS_VIEW },
      { key: K.BUILDINGS_VIEW },
      { key: K.SECTIONS_VIEW },
      { key: K.BATCHES_VIEW },
      { key: K.REPORTS_VIEW },
      { key: K.REPORTS_EXPORT },
      { key: K.REPORTS_MANAGE },
      { key: K.WORKFLOWS_VIEW },
      { key: K.WORKFLOWS_APPROVE },
      { key: K.NOTIFICATIONS_TEMPLATES_MANAGE },
      { key: K.NOTIFICATIONS_CAMPAIGNS_MANAGE },
      { key: K.NOTIFICATIONS_TRIGGERS_MANAGE },
      { key: K.NOTIFICATIONS_CONFIG_MANAGE },
      { key: K.DOCUMENTS_MANAGE },
      { key: K.DOCUMENTS_APPROVE },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.HOD,
    name: 'Head of Department',
    description: "Manages their department's academics, timetable, and exam approvals.",
    grants: [
      { key: K.STUDENTS_VIEW, scopeType: S.DEPARTMENT },
      { key: K.ACADEMICS_VIEW, scopeType: S.DEPARTMENT },
      { key: K.ACADEMICS_UPDATE, scopeType: S.DEPARTMENT },
      { key: K.TIMETABLE_VIEW, scopeType: S.DEPARTMENT },
      { key: K.TIMETABLE_CREATE, scopeType: S.DEPARTMENT },
      { key: K.TIMETABLE_UPDATE, scopeType: S.DEPARTMENT },
      { key: K.TIMETABLE_PUBLISH, scopeType: S.DEPARTMENT },
{ key: K.ATTENDANCE_VIEW, scopeType: S.DEPARTMENT },
  { key: K.ATTENDANCE_CREATE, scopeType: S.DEPARTMENT },
  { key: K.ATTENDANCE_UPDATE, scopeType: S.DEPARTMENT },
  { key: K.EXAMS_VIEW, scopeType: S.DEPARTMENT },
      { key: K.EXAMS_APPROVE, scopeType: S.DEPARTMENT },
      { key: K.RESULTS_VIEW, scopeType: S.DEPARTMENT },
      { key: K.REPORTS_VIEW, scopeType: S.DEPARTMENT },
      { key: K.HR_VIEW, scopeType: S.DEPARTMENT },
      { key: K.WORKFLOWS_VIEW, scopeType: S.DEPARTMENT },
      { key: K.WORKFLOWS_APPROVE, scopeType: S.DEPARTMENT },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.FACULTY,
    name: 'Faculty',
    description: 'Takes attendance and enters marks for their own classes; views their department.',
    grants: [
      { key: K.STUDENTS_VIEW, scopeType: S.DEPARTMENT },
      { key: K.ACADEMICS_VIEW, scopeType: S.DEPARTMENT },
      { key: K.TIMETABLE_VIEW, scopeType: S.OWN },
      { key: K.TIMETABLE_CREATE, scopeType: S.OWN },
      { key: K.ATTENDANCE_VIEW, scopeType: S.OWN },
      { key: K.ATTENDANCE_CREATE, scopeType: S.OWN },
      { key: K.ATTENDANCE_UPDATE, scopeType: S.OWN },
      { key: K.EXAMS_VIEW, scopeType: S.OWN },
      { key: K.EXAMS_CREATE, scopeType: S.OWN },
      { key: K.RESULTS_VIEW, scopeType: S.OWN },
      { key: K.HR_VIEW, scopeType: S.OWN },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.ACCOUNTANT,
    name: 'Accountant',
    description: 'Owns fee structures, demands, refunds, and payment reconciliation.',
    grants: [
      { key: K.FEES_MANAGE },
      { key: K.PAYMENTS_MANAGE },
      { key: K.TENANT_BILLING_VIEW },
      { key: K.BILLING_UPDATE },
      { key: K.STUDENTS_VIEW },
      { key: K.REPORTS_VIEW },
      { key: K.REPORTS_EXPORT },
      { key: K.REPORTS_MANAGE },
      { key: K.WORKFLOWS_VIEW },
      { key: K.WORKFLOWS_APPROVE },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.EXAM_CONTROLLER,
    name: 'Exam Controller',
    description: 'Owns exam scheduling, seating, moderation, and result/certificate publication.',
    grants: [
      { key: K.EXAMS_MANAGE },
      { key: K.RESULTS_MANAGE },
      { key: K.CERTIFICATES_VIEW },
      { key: K.CERTIFICATES_CREATE },
      { key: K.CERTIFICATES_EXPORT },
      { key: K.STUDENTS_VIEW },
      { key: K.WORKFLOWS_VIEW },
      { key: K.WORKFLOWS_APPROVE },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.LIBRARIAN,
    name: 'Librarian',
    description: "Manages their campus's library catalog, loans, and fines.",
    grants: [{ key: K.LIBRARY_MANAGE, scopeType: S.CAMPUS }],
  },
  {
    code: SYSTEM_ROLE_CODES.HOSTEL_WARDEN,
    name: 'Hostel Warden',
    description: "Manages their campus's hostel allocations.",
    grants: [{ key: K.HOSTEL_MANAGE, scopeType: S.CAMPUS }],
  },
  {
    code: SYSTEM_ROLE_CODES.TRANSPORT_MANAGER,
    name: 'Transport Manager',
    description: "Manages their campus's transport routes, vehicles, and passes.",
    grants: [{ key: K.TRANSPORT_MANAGE, scopeType: S.CAMPUS }],
  },
  {
    code: SYSTEM_ROLE_CODES.HR,
    name: 'HR',
    description: 'Owns employee records, leave, and workload; manages tenant user accounts for staff.',
    grants: [
      { key: K.HR_MANAGE },
      { key: K.USERS_VIEW },
      { key: K.USERS_MANAGE },
      { key: K.WORKFLOWS_VIEW },
      { key: K.WORKFLOWS_APPROVE },
      { key: K.HELPDESK_VIEW },
      { key: K.HELPDESK_MANAGE },
      { key: K.DOCUMENTS_MANAGE },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.PLACEMENT_OFFICER,
    name: 'Placement Officer',
    description: 'Owns placement drives, company relationships, and eligibility approvals.',
    grants: [
      { key: K.PLACEMENTS_MANAGE },
      { key: K.STUDENTS_VIEW },
      { key: K.WORKFLOWS_VIEW },
      { key: K.WORKFLOWS_APPROVE },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.STUDENT,
    name: 'Student',
    description: 'Self-service access to their own academic, attendance, exam, and fee records.',
    grants: [
      { key: K.STUDENTS_VIEW, scopeType: S.OWN },
      { key: K.ACADEMICS_VIEW, scopeType: S.OWN },
      { key: K.ACADEMICS_CREATE, scopeType: S.OWN },
      { key: K.ACADEMICS_UPDATE, scopeType: S.OWN },
      { key: K.TIMETABLE_VIEW, scopeType: S.OWN },
      { key: K.ATTENDANCE_VIEW, scopeType: S.OWN },
      { key: K.EXAMS_VIEW, scopeType: S.OWN },
      { key: K.RESULTS_VIEW, scopeType: S.OWN },
      { key: K.FEES_VIEW, scopeType: S.OWN },
      { key: K.LIBRARY_VIEW, scopeType: S.OWN },
      { key: K.NOTIFICATIONS_VIEW, scopeType: S.OWN },
      { key: K.WORKFLOWS_VIEW, scopeType: S.OWN },
    ],
  },
  {
    code: SYSTEM_ROLE_CODES.PARENT,
    name: 'Parent',
    description:
      "Read-only access to their linked child's academic, attendance, exam, and fee records " +
      '(the student-guardian link is established when the Student module is built; scope is ' +
      'OWN in the interim).',
    grants: [
      { key: K.STUDENTS_VIEW, scopeType: S.OWN },
      { key: K.ATTENDANCE_VIEW, scopeType: S.OWN },
      { key: K.EXAMS_VIEW, scopeType: S.OWN },
      { key: K.RESULTS_VIEW, scopeType: S.OWN },
      { key: K.FEES_VIEW, scopeType: S.OWN },
      { key: K.NOTIFICATIONS_VIEW, scopeType: S.OWN },
      { key: K.WORKFLOWS_VIEW, scopeType: S.OWN },
    ],
  },
];
