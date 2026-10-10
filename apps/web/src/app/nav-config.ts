import type { IconName } from './icons';

/**
 * Single source of truth for the staff app's sidebar navigation. `permissions` is any-of (empty =
 * visible to every authenticated user); `roles` is any-of against the user's roles; `entitlement`
 * must be enabled on the tenant plan. This only decides what renders — every API call behind each
 * link is independently guarded server-side (RBAC guards + EntitlementFlagsGuard), so hiding a link
 * is never the enforcement.
 */
export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  permissions?: string[];
  roles?: string[];
  entitlement?: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

const IMPORT_VIEW_PERMISSIONS = ['students.view', 'hr.view', 'academics.view', 'departments.read', 'fees.view', 'attendance.view', 'exams.view', 'library.view', 'inventory.view'];
const ORG_VIEW_PERMISSIONS = ['campuses.read', 'departments.read', 'programs.read', 'academicYears.read', 'terms.read', 'rooms.read', 'buildings.read', 'sections.read', 'batches.read'];
const CAMPUS_VIEW_PERMISSIONS = ['campus.settings.view', 'campus.analytics.view'];

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }],
  },
  {
    label: 'Academics',
    items: [
      { to: '/students', label: 'Students', icon: 'users', permissions: ['students.view'] },
      { to: '/admissions', label: 'Admissions', icon: 'application', permissions: ['admissions.view'] },
      { to: '/academics', label: 'Academics', icon: 'academics', permissions: ['academics.view'] },
      { to: '/timetable', label: 'Timetable', icon: 'timetable', permissions: ['timetable.view'] },
      { to: '/attendance', label: 'Attendance', icon: 'attendance', permissions: ['attendance.view'] },
      { to: '/exams', label: 'Examinations', icon: 'exams', permissions: ['exams.view'] },
      { to: '/certificates', label: 'Certificates', icon: 'certificates', permissions: ['certificates.view'] },
    ],
  },
  {
    label: 'Campus & Services',
    items: [
      { to: '/library', label: 'Library', icon: 'library', permissions: ['library.view'] },
      { to: '/inventory', label: 'Inventory', icon: 'inventory', permissions: ['inventory.view'] },
      { to: '/hostel', label: 'Hostel', icon: 'hostel', permissions: ['hostel.view'] },
      { to: '/transport', label: 'Transport', icon: 'transport', permissions: ['transport.view'] },
      { to: '/hr', label: 'HR & Faculty', icon: 'hr', permissions: ['hr.view'] },
      { to: '/placements', label: 'Placements', icon: 'placements', permissions: ['placements.view'] },
      { to: '/helpdesk', label: 'Helpdesk', icon: 'helpdesk', permissions: ['helpdesk.view'] },
    ],
  },
  {
    label: 'Operations',
    items: [
      { to: '/notifications', label: 'Notifications', icon: 'notifications', permissions: ['notifications.read'] },
      { to: '/documents', label: 'Documents', icon: 'documents', permissions: ['documents.read'] },
      { to: '/integrations', label: 'Integrations', icon: 'integrations', permissions: ['integrations.view'] },
      { to: '/identity', label: 'Single sign-on', icon: 'identity', permissions: ['identity.view'] },
      { to: '/reports', label: 'Reports', icon: 'reports', permissions: ['reports.view'] },
      { to: '/imports', label: 'Import / Export', icon: 'imports', permissions: IMPORT_VIEW_PERMISSIONS },
      { to: '/analytics', label: 'Analytics', icon: 'analytics', permissions: ['analytics.view'], entitlement: 'analytics.advanced' },
      { to: '/ai-assistant', label: 'AI Assistant', icon: 'ai', permissions: ['ai.view'], entitlement: 'ai.assistant' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { to: '/organization', label: 'Organization', icon: 'organization', permissions: ORG_VIEW_PERMISSIONS },
      { to: '/campuses', label: 'Campuses', icon: 'campuses', permissions: CAMPUS_VIEW_PERMISSIONS },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/audit', label: 'Audit log', icon: 'audit', permissions: ['audit.read'] },
      { to: '/billing', label: 'Billing', icon: 'billing', permissions: ['tenant.billing.view'] },
      { to: '/settings', label: 'Configuration', icon: 'settings', permissions: ['tenant.config.view'] },
    ],
  },
  {
    label: 'My portals',
    items: [
      { to: '/portal/dashboard', label: 'Student Portal', icon: 'academics', roles: ['STUDENT'] },
      { to: '/parent/dashboard', label: 'Parent Portal', icon: 'parent', roles: ['PARENT'] },
      { to: '/faculty/dashboard', label: 'Faculty Portal', icon: 'faculty', roles: ['FACULTY'] },
    ],
  },
];

/** Human labels for path segments, used to build breadcrumbs and the page title. */
export const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  students: 'Students',
  admissions: 'Admissions',
  academics: 'Academics',
  timetable: 'Timetable',
  attendance: 'Attendance',
  exams: 'Examinations',
  certificates: 'Certificates',
  library: 'Library',
  inventory: 'Inventory',
  hostel: 'Hostel',
  transport: 'Transport',
  hr: 'HR & Faculty',
  placements: 'Placements',
  helpdesk: 'Helpdesk',
  notifications: 'Notifications',
  documents: 'Documents',
  integrations: 'Integrations',
  identity: 'Single sign-on',
  reports: 'Reports',
  imports: 'Import / Export',
  analytics: 'Analytics',
  'ai-assistant': 'AI Assistant',
  organization: 'Organization',
  campuses: 'Campuses',
  audit: 'Audit log',
  billing: 'Billing',
  settings: 'Configuration',
  portal: 'Student Portal',
  parent: 'Parent Portal',
  faculty: 'Faculty Portal',
  profile: 'Profile',
  'id-card': 'Digital ID',
  fees: 'Fees',
  payments: 'Payments',
  results: 'Results',
  courses: 'Courses',
  notices: 'Notices',
  tickets: 'Support Tickets',
  marks: 'Marks',
  leave: 'Leave',
  workload: 'Workload',
};

export function hasAnyPermission(granted: string[], required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  return required.some((permission) => granted.includes(permission));
}

export function hasAnyRole(roles: string[], required?: string[]): boolean {
  if (!required || required.length === 0) return true;
  return required.some((role) => roles.includes(role));
}
