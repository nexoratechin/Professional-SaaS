import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Card } from '@college-erp/ui';
import { useAuth, useEntitlement } from '../features/auth/auth-context';
import { openGlobalSearch } from '../features/search/search-palette';

const AUDIT_VIEW_PERMISSION = 'audit.read';
const BILLING_VIEW_PERMISSION = 'tenant.billing.view';
const CONFIG_VIEW_PERMISSION = 'tenant.config.view';
const STUDENTS_VIEW_PERMISSION = 'students.view';
const ADMISSIONS_VIEW_PERMISSION = 'admissions.view';
const ACADEMICS_VIEW_PERMISSION = 'academics.view';
const TIMETABLE_VIEW_PERMISSION = 'timetable.view';
const ATTENDANCE_VIEW_PERMISSION = 'attendance.view';
const EXAMS_VIEW_PERMISSION = 'exams.view';
const CERTIFICATES_VIEW_PERMISSION = 'certificates.view';
const LIBRARY_VIEW_PERMISSION = 'library.view';
const INVENTORY_VIEW_PERMISSION = 'inventory.view';
const HELPDESK_VIEW_PERMISSION = 'helpdesk.view';
const HOSTEL_VIEW_PERMISSION = 'hostel.view';
const TRANSPORT_VIEW_PERMISSION = 'transport.view';
const HR_VIEW_PERMISSION = 'hr.view';
const PLACEMENTS_VIEW_PERMISSION = 'placements.view';
const NOTIFICATIONS_VIEW_PERMISSION = 'notifications.read';
const DOCUMENTS_VIEW_PERMISSION = 'documents.read';
const REPORTS_VIEW_PERMISSION = 'reports.view';
const INTEGRATIONS_VIEW_PERMISSION = 'integrations.view';
const ANALYTICS_VIEW_PERMISSION = 'analytics.view';
const AI_VIEW_PERMISSION = 'ai.view';
const SEARCH_VIEW_PERMISSION = 'search.view';
const ORG_VIEW_PERMISSIONS = ['campuses.read', 'departments.read', 'programs.read', 'academicYears.read', 'terms.read', 'rooms.read', 'buildings.read', 'sections.read', 'batches.read'];
const IMPORT_VIEW_PERMISSIONS = ['students.view', 'hr.view', 'academics.view', 'departments.read', 'fees.view', 'attendance.view', 'exams.view', 'library.view', 'inventory.view'];

/** Entitlement-gated navigation section — rendered links are only as trustworthy as the
 * backend's EntitlementFlagsGuard (a disabled plan entitlement hides the link here, but could
 * never be bypassed by manually calling the API). */
function EntitlementNav() {
  const entitleModules = useEntitlement('attendance.qr');
  const entitleFees = useEntitlement('fees.online_payment');
  const entitleAnalytics = useEntitlement('analytics.advanced');
  const entitleAi = useEntitlement('ai.assistant');

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Modules (entitlement-gated navigation)</h2>
      <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {entitleModules && <li>QR attendance — <Link to="/dashboard">available</Link></li>}
        {entitleFees && <li>Online fee payments — <Link to="/dashboard">available</Link></li>}
        {entitleAnalytics && <li>Advanced analytics — <Link to="/analytics">open</Link></li>}
        {entitleAi && <li>AI assistant — <Link to="/ai-assistant">open</Link></li>}
      </ul>
      {!entitleModules && !entitleFees && !entitleAnalytics && !entitleAi && (
        <p style={{ color: '#9ca3af' }}>No extra entitlements in this tenant's plan.</p>
      )}
    </Card>
  );
}

export function DashboardPage() {
  const { user, permissions, features, entitlements, tenantSlug, logout } = useAuth();
  const navigate = useNavigate();
  // The AI link needs BOTH gates: the plan entitlement (so a tenant that has not bought it never
  // sees it) and the `ai.view` RBAC grant (so a user whose role excludes it never sees it either).
  // Neither is enforcement — the API's guard stack and resolveAiScope are.
  const entitledAi = useEntitlement('ai.assistant');

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>College ERP — Dashboard</h1>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {user?.roles.some((role) => role === 'STUDENT') && (
            <Link to="/portal/dashboard" style={{ fontWeight: 600 }}>
              Student Portal
            </Link>
          )}
          {user?.roles.some((role) => role === 'PARENT') && (
            <Link to="/parent/dashboard" style={{ fontWeight: 600 }}>
              Parent Portal
            </Link>
          )}
          {user?.roles.some((role) => role === 'FACULTY') && (
            <Link to="/faculty/dashboard" style={{ fontWeight: 600 }}>
              Faculty Portal
            </Link>
          )}
          {permissions.includes(STUDENTS_VIEW_PERMISSION) && <Link to="/students">Students</Link>}
          {permissions.includes(ADMISSIONS_VIEW_PERMISSION) && <Link to="/admissions">Admissions</Link>}
          {permissions.includes(ACADEMICS_VIEW_PERMISSION) && <Link to="/academics">Academics</Link>}
          {permissions.includes(TIMETABLE_VIEW_PERMISSION) && <Link to="/timetable">Timetable</Link>}
          {permissions.includes(ATTENDANCE_VIEW_PERMISSION) && <Link to="/attendance">Attendance</Link>}
          {permissions.includes(EXAMS_VIEW_PERMISSION) && <Link to="/exams">Examinations</Link>}
          {permissions.includes(CERTIFICATES_VIEW_PERMISSION) && <Link to="/certificates">Certificates</Link>}
          {permissions.includes(LIBRARY_VIEW_PERMISSION) && <Link to="/library">Library</Link>}
          {permissions.includes(INVENTORY_VIEW_PERMISSION) && <Link to="/inventory">Inventory</Link>}
          {permissions.includes(HELPDESK_VIEW_PERMISSION) && <Link to="/helpdesk">Helpdesk</Link>}
          {permissions.includes(HOSTEL_VIEW_PERMISSION) && <Link to="/hostel">Hostel</Link>}
          {permissions.includes(TRANSPORT_VIEW_PERMISSION) && <Link to="/transport">Transport</Link>}
          {permissions.includes(HR_VIEW_PERMISSION) && <Link to="/hr">HR & Faculty</Link>}
          {permissions.includes(PLACEMENTS_VIEW_PERMISSION) && <Link to="/placements">Placements</Link>}
          {permissions.includes(NOTIFICATIONS_VIEW_PERMISSION) && <Link to="/notifications">Notifications</Link>}
          {permissions.includes(DOCUMENTS_VIEW_PERMISSION) && <Link to="/documents">Documents</Link>}
          {permissions.includes(INTEGRATIONS_VIEW_PERMISSION) && <Link to="/integrations">Integrations</Link>}
          {permissions.includes(REPORTS_VIEW_PERMISSION) && <Link to="/reports">Reports</Link>}
          {permissions.some((p) => IMPORT_VIEW_PERMISSIONS.includes(p)) && <Link to="/imports">Import / Export</Link>}
          {permissions.includes(ANALYTICS_VIEW_PERMISSION) && <Link to="/analytics">Analytics</Link>}
          {entitledAi && permissions.includes(AI_VIEW_PERMISSION) && <Link to="/ai-assistant">AI Assistant</Link>}
          {permissions.some((p) => ORG_VIEW_PERMISSIONS.includes(p)) && <Link to="/organization">Organization</Link>}
          {permissions.includes(AUDIT_VIEW_PERMISSION) && <Link to="/audit">Audit log</Link>}
          {permissions.includes(BILLING_VIEW_PERMISSION) && <Link to="/billing">Billing</Link>}
          {permissions.includes(CONFIG_VIEW_PERMISSION) && <Link to="/settings">Configuration</Link>}
          {permissions.includes(SEARCH_VIEW_PERMISSION) && (
            <Button variant="secondary" onClick={openGlobalSearch}>
              Search (Ctrl K)
            </Button>
          )}
          <Button variant="secondary" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </div>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Session</h2>
        <p>Tenant: {tenantSlug}</p>
        <p>User: {user?.fullName} ({user?.email})</p>
        <p>Status: {user?.status}</p>
        <p>Roles: {user?.roles.join(', ') || 'none'}</p>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Effective permissions</h2>
        {permissions.length === 0 ? (
          <p>No permissions granted.</p>
        ) : (
          <ul>
            {permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Feature flags for this tenant's plan</h2>
        {Object.keys(features).length === 0 ? (
          <p>Not visible with the current role (requires tenant.features.manage).</p>
        ) : (
          <ul>
            {Object.entries(features).map(([key, enabled]) => (
              <li key={key} style={{ color: enabled ? '#15803d' : '#9ca3af' }}>
                {key}: {enabled ? 'enabled' : 'disabled'}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Granular entitlements</h2>
        {Object.keys(entitlements).length === 0 ? (
          <p style={{ color: '#9ca3af' }}>No entitlement data loaded.</p>
        ) : (
          <ul>
            {Object.entries(entitlements).map(([key, enabled]) => (
              <li key={key} style={{ color: enabled ? '#15803d' : '#9ca3af' }}>
                {key}: {enabled ? 'enabled' : 'disabled'}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <EntitlementNav />
    </div>
  );
}
