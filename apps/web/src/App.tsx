import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Spinner } from '@college-erp/ui';
import { AuthProvider } from './features/auth/auth-context';
import { BrandingProvider } from './features/branding/branding-context';
import { GlobalSearchPalette } from './features/search/search-palette';
import { PlatformAuthProvider } from './features/platform-auth/platform-auth-context';

/**
 * Every route module is code-split: the app shell (auth providers, router, search palette) ships
 * eagerly, and each page loads on first navigation. This keeps the initial bundle to the shell
 * instead of the ~60 feature pages, and pairs with the vendor manualChunks in vite.config.
 */
const AppLayout = lazy(() => import('./app/app-shell').then((m) => ({ default: m.AppLayout })));
const AdvancedAnalyticsPage = lazy(() => import('./routes/analytics').then((m) => ({ default: m.AdvancedAnalyticsPage })));
const AiAssistantPage = lazy(() => import('./routes/ai-assistant').then((m) => ({ default: m.AiAssistantPage })));
const AuditLogPage = lazy(() => import('./routes/audit-log').then((m) => ({ default: m.AuditLogPage })));
const BillingPage = lazy(() => import('./routes/billing').then((m) => ({ default: m.BillingPage })));
const DashboardPage = lazy(() => import('./routes/dashboard').then((m) => ({ default: m.DashboardPage })));
const CampusesPage = lazy(() => import('./routes/campuses').then((m) => ({ default: m.CampusesPage })));
const EntitlementRoute = lazy(() => import('./routes/entitlement-route').then((m) => ({ default: m.EntitlementRoute })));
const LoginPage = lazy(() => import('./routes/login').then((m) => ({ default: m.LoginPage })));
const PlatformAnalyticsPage = lazy(() => import('./routes/platform/platform-analytics').then((m) => ({ default: m.PlatformAnalyticsPage })));
const PlatformAuditLogPage = lazy(() => import('./routes/platform/platform-audit-log').then((m) => ({ default: m.PlatformAuditLogPage })));
const PlatformBillingPage = lazy(() => import('./routes/platform/platform-billing').then((m) => ({ default: m.PlatformBillingPage })));
const PlatformCatalogPage = lazy(() => import('./routes/platform/platform-catalog').then((m) => ({ default: m.PlatformCatalogPage })));
const PlatformDashboardPage = lazy(() => import('./routes/platform/platform-dashboard').then((m) => ({ default: m.PlatformDashboardPage })));
const PlatformLayout = lazy(() => import('./routes/platform/platform-layout').then((m) => ({ default: m.PlatformLayout })));
const PlatformLoginPage = lazy(() => import('./routes/platform/platform-login').then((m) => ({ default: m.PlatformLoginPage })));
const PlatformProtectedRoute = lazy(() => import('./routes/platform/platform-protected-route').then((m) => ({ default: m.PlatformProtectedRoute })));
const PlatformSupportPage = lazy(() => import('./routes/platform/platform-support').then((m) => ({ default: m.PlatformSupportPage })));
const PlatformTenantDetailPage = lazy(() => import('./routes/platform/platform-tenant-detail').then((m) => ({ default: m.PlatformTenantDetailPage })));
const PlatformTenantNewPage = lazy(() => import('./routes/platform/platform-tenant-new').then((m) => ({ default: m.PlatformTenantNewPage })));
const PlatformTenantsPage = lazy(() => import('./routes/platform/platform-tenants').then((m) => ({ default: m.PlatformTenantsPage })));
const ProtectedRoute = lazy(() => import('./routes/protected-route').then((m) => ({ default: m.ProtectedRoute })));
const StudentProfilePage = lazy(() => import('./routes/student-profile').then((m) => ({ default: m.StudentProfilePage })));
const StudentsPage = lazy(() => import('./routes/students').then((m) => ({ default: m.StudentsPage })));
const TenantConfigurationPage = lazy(() => import('./routes/tenant-configuration').then((m) => ({ default: m.TenantConfigurationPage })));
const OrganizationPage = lazy(() => import('./routes/organization').then((m) => ({ default: m.OrganizationPage })));
const AdmissionsPage = lazy(() => import('./routes/admissions').then((m) => ({ default: m.AdmissionsPage })));
const AcademicsPage = lazy(() => import('./routes/academics').then((m) => ({ default: m.AcademicsPage })));
const TimetablePage = lazy(() => import('./routes/timetable').then((m) => ({ default: m.TimetablePage })));
const AttendancePage = lazy(() => import('./routes/attendance').then((m) => ({ default: m.AttendancePage })));
const ExamsPage = lazy(() => import('./routes/exams').then((m) => ({ default: m.ExamsPage })));
const CertificatesPage = lazy(() => import('./routes/certificates').then((m) => ({ default: m.CertificatesPage })));
const CertificateVerifyPage = lazy(() => import('./routes/certificate-verify').then((m) => ({ default: m.CertificateVerifyPage })));
const StudentIdVerifyPage = lazy(() => import('./routes/student-id-verify').then((m) => ({ default: m.StudentIdVerifyPage })));
const LibraryPage = lazy(() => import('./routes/library').then((m) => ({ default: m.LibraryPage })));
const InventoryPage = lazy(() => import('./routes/inventory').then((m) => ({ default: m.InventoryPage })));
const HostelPage = lazy(() => import('./routes/hostel').then((m) => ({ default: m.HostelPage })));
const TransportPage = lazy(() => import('./routes/transport').then((m) => ({ default: m.TransportPage })));
const HrPage = lazy(() => import('./routes/hr').then((m) => ({ default: m.HrPage })));
const PlacementsPage = lazy(() => import('./routes/placements').then((m) => ({ default: m.PlacementsPage })));
const HelpdeskPage = lazy(() => import('./routes/helpdesk').then((m) => ({ default: m.HelpdeskPage })));
const NotificationsPage = lazy(() => import('./routes/notifications').then((m) => ({ default: m.NotificationsPage })));
const DocumentsPage = lazy(() => import('./routes/documents').then((m) => ({ default: m.DocumentsPage })));
const IntegrationsPage = lazy(() => import('./routes/integrations').then((m) => ({ default: m.IntegrationsPage })));
const IdentityPage = lazy(() => import('./routes/identity').then((m) => ({ default: m.IdentityPage })));
const SsoCallbackPage = lazy(() => import('./routes/sso-callback').then((m) => ({ default: m.SsoCallbackPage })));
const ReportsPage = lazy(() => import('./routes/reports').then((m) => ({ default: m.ReportsPage })));
const ImportExportPage = lazy(() => import('./routes/import-export').then((m) => ({ default: m.ImportExportPage })));
const PortalGate = lazy(() => import('./routes/portal/portal-gate').then((m) => ({ default: m.PortalGate })));
const StudentPortalLayout = lazy(() => import('./routes/portal/portal-layout').then((m) => ({ default: m.StudentPortalLayout })));
const PortalDashboardPage = lazy(() => import('./routes/portal/portal-dashboard').then((m) => ({ default: m.PortalDashboardPage })));
const PortalIdCardPage = lazy(() => import('./routes/portal/portal-id-card').then((m) => ({ default: m.PortalIdCardPage })));
const PortalProfilePage = lazy(() => import('./routes/portal/portal-profile').then((m) => ({ default: m.PortalProfilePage })));
const PortalAttendancePage = lazy(() => import('./routes/portal/portal-attendance').then((m) => ({ default: m.PortalAttendancePage })));
const PortalTimetablePage = lazy(() => import('./routes/portal/portal-timetable').then((m) => ({ default: m.PortalTimetablePage })));
const PortalCoursesPage = lazy(() => import('./routes/portal/portal-courses').then((m) => ({ default: m.PortalCoursesPage })));
const PortalFeesPage = lazy(() => import('./routes/portal/portal-fees').then((m) => ({ default: m.PortalFeesPage })));
const PortalPaymentsPage = lazy(() => import('./routes/portal/portal-payments').then((m) => ({ default: m.PortalPaymentsPage })));
const PortalExamsPage = lazy(() => import('./routes/portal/portal-exams').then((m) => ({ default: m.PortalExamsPage })));
const PortalResultsPage = lazy(() => import('./routes/portal/portal-results').then((m) => ({ default: m.PortalResultsPage })));
const PortalCertificatesPage = lazy(() => import('./routes/portal/portal-certificates').then((m) => ({ default: m.PortalCertificatesPage })));
const PortalLibraryPage = lazy(() => import('./routes/portal/portal-library').then((m) => ({ default: m.PortalLibraryPage })));
const PortalHostelPage = lazy(() => import('./routes/portal/portal-hostel').then((m) => ({ default: m.PortalHostelPage })));
const PortalTransportPage = lazy(() => import('./routes/portal/portal-transport').then((m) => ({ default: m.PortalTransportPage })));
const PortalNoticesPage = lazy(() => import('./routes/portal/portal-notices').then((m) => ({ default: m.PortalNoticesPage })));
const PortalTicketsPage = lazy(() => import('./routes/portal/portal-tickets').then((m) => ({ default: m.PortalTicketsPage })));
const PortalDocumentsPage = lazy(() => import('./routes/portal/portal-documents').then((m) => ({ default: m.PortalDocumentsPage })));
const ParentGate = lazy(() => import('./routes/parent/parent-gate').then((m) => ({ default: m.ParentGate })));
const ParentPortalLayout = lazy(() => import('./routes/parent/parent-layout').then((m) => ({ default: m.ParentPortalLayout })));
const ParentDashboardPage = lazy(() => import('./routes/parent/parent-dashboard').then((m) => ({ default: m.ParentDashboardPage })));
const ParentProfilePage = lazy(() => import('./routes/parent/parent-profile').then((m) => ({ default: m.ParentProfilePage })));
const ParentAttendancePage = lazy(() => import('./routes/parent/parent-attendance').then((m) => ({ default: m.ParentAttendancePage })));
const ParentTimetablePage = lazy(() => import('./routes/parent/parent-timetable').then((m) => ({ default: m.ParentTimetablePage })));
const ParentFeesPage = lazy(() => import('./routes/parent/parent-fees').then((m) => ({ default: m.ParentFeesPage })));
const ParentPaymentsPage = lazy(() => import('./routes/parent/parent-payments').then((m) => ({ default: m.ParentPaymentsPage })));
const ParentExamsPage = lazy(() => import('./routes/parent/parent-exams').then((m) => ({ default: m.ParentExamsPage })));
const ParentResultsPage = lazy(() => import('./routes/parent/parent-results').then((m) => ({ default: m.ParentResultsPage })));
const ParentNoticesPage = lazy(() => import('./routes/parent/parent-notices').then((m) => ({ default: m.ParentNoticesPage })));
const ParentDocumentsPage = lazy(() => import('./routes/parent/parent-documents').then((m) => ({ default: m.ParentDocumentsPage })));
const ParentTransportPage = lazy(() => import('./routes/parent/parent-transport').then((m) => ({ default: m.ParentTransportPage })));
const ParentHostelPage = lazy(() => import('./routes/parent/parent-hostel').then((m) => ({ default: m.ParentHostelPage })));
const FacultyGate = lazy(() => import('./routes/faculty/faculty-gate').then((m) => ({ default: m.FacultyGate })));
const FacultyPortalLayout = lazy(() => import('./routes/faculty/faculty-layout').then((m) => ({ default: m.FacultyPortalLayout })));
const FacultyDashboardPage = lazy(() => import('./routes/faculty/faculty-dashboard').then((m) => ({ default: m.FacultyDashboardPage })));
const FacultyProfilePage = lazy(() => import('./routes/faculty/faculty-profile').then((m) => ({ default: m.FacultyProfilePage })));
const FacultyCoursesPage = lazy(() => import('./routes/faculty/faculty-courses').then((m) => ({ default: m.FacultyCoursesPage })));
const FacultyStudentsPage = lazy(() => import('./routes/faculty/faculty-students').then((m) => ({ default: m.FacultyStudentsPage })));
const FacultyTimetablePage = lazy(() => import('./routes/faculty/faculty-timetable').then((m) => ({ default: m.FacultyTimetablePage })));
const FacultyAttendancePage = lazy(() => import('./routes/faculty/faculty-attendance').then((m) => ({ default: m.FacultyAttendancePage })));
const FacultyMarksPage = lazy(() => import('./routes/faculty/faculty-marks').then((m) => ({ default: m.FacultyMarksPage })));
const FacultyAcademicsPage = lazy(() => import('./routes/faculty/faculty-academics').then((m) => ({ default: m.FacultyAcademicsPage })));
const FacultyLeavePage = lazy(() => import('./routes/faculty/faculty-leave').then((m) => ({ default: m.FacultyLeavePage })));
const FacultyWorkloadPage = lazy(() => import('./routes/faculty/faculty-workload').then((m) => ({ default: m.FacultyWorkloadPage })));
const FacultyNotificationsPage = lazy(() => import('./routes/faculty/faculty-notifications').then((m) => ({ default: m.FacultyNotificationsPage })));
const FacultyReportsPage = lazy(() => import('./routes/faculty/faculty-reports').then((m) => ({ default: m.FacultyReportsPage })));

function ProfileRoute() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/students" replace />;
  return <StudentProfilePage studentId={id} />;
}

/** Two entirely separate route trees, each wrapped in its OWN auth provider — the tenant realm
 *  (AuthProvider) never renders inside the platform realm's tree and vice versa. This is the
 *  routing half of the same isolation lib/platform-http.ts enforces at the HTTP layer: there is
 *  no shared React state, no shared token, and no code path that crosses from one to the other. */
function RouteLoadingFallback() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '40vh', color: '#475569', gap: 10 }}>
      <Spinner />
      <span>Loading…</span>
    </div>
  );
}

export function App() {
  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/platform/*" element={<PlatformArea />} />
        <Route path="/*" element={<TenantArea />} />
      </Routes>
    </Suspense>
  );
}

function PlatformArea() {
  return (
    <PlatformAuthProvider>
      <Routes>
        <Route path="login" element={<PlatformLoginPage />} />
        <Route
          element={
            <PlatformProtectedRoute>
              <PlatformLayout />
            </PlatformProtectedRoute>
          }
        >
          <Route path="dashboard" element={<PlatformDashboardPage />} />
          <Route path="tenants" element={<PlatformTenantsPage />} />
          <Route path="tenants/new" element={<PlatformTenantNewPage />} />
          <Route path="tenants/:id" element={<PlatformTenantDetailPage />} />
          <Route path="billing" element={<PlatformBillingPage />} />
          <Route path="analytics" element={<PlatformAnalyticsPage />} />
          <Route path="catalog" element={<PlatformCatalogPage />} />
          <Route path="support" element={<PlatformSupportPage />} />
          <Route path="audit-log" element={<PlatformAuditLogPage />} />
        </Route>
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
    </PlatformAuthProvider>
  );
}

function TenantArea() {
  return (
    <AuthProvider>
      <BrandingProvider>
        <GlobalSearchPalette />
        <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/sso/callback" element={<SsoCallbackPage />} />

        {/* Staff console — every page shares the responsive app shell (sidebar, breadcrumbs,
            command palette, user menu). The shell is chrome only; each page keeps its own logic. */}
        <Route
          element={
            <ProtectedRoute>
              <AppLayout />
            </ProtectedRoute>
          }
        >
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="audit" element={<AuditLogPage />} />
          <Route
            path="analytics"
            element={
              <EntitlementRoute entitlement="analytics.advanced">
                <AdvancedAnalyticsPage />
              </EntitlementRoute>
            }
          />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="imports" element={<ImportExportPage />} />
          <Route
            path="ai-assistant"
            element={
              <EntitlementRoute entitlement="ai.assistant">
                <AiAssistantPage />
              </EntitlementRoute>
            }
          />
          <Route path="billing" element={<BillingPage />} />
          <Route path="settings" element={<TenantConfigurationPage />} />
          <Route path="campuses" element={<CampusesPage />} />
          <Route path="organization" element={<OrganizationPage />} />
          <Route path="students" element={<StudentsPage />} />
          <Route path="students/:id" element={<ProfileRoute />} />
          <Route path="admissions" element={<AdmissionsPage />} />
          <Route path="academics" element={<AcademicsPage />} />
          <Route path="timetable" element={<TimetablePage />} />
          <Route path="attendance" element={<AttendancePage />} />
          <Route path="exams" element={<ExamsPage />} />
          <Route path="certificates" element={<CertificatesPage />} />
          <Route path="library" element={<LibraryPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="hostel" element={<HostelPage />} />
          <Route path="transport" element={<TransportPage />} />
          <Route path="hr" element={<HrPage />} />
          <Route path="placements" element={<PlacementsPage />} />
          <Route path="helpdesk" element={<HelpdeskPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="documents" element={<DocumentsPage />} />
          <Route path="integrations" element={<IntegrationsPage />} />
          <Route path="identity" element={<IdentityPage />} />
        </Route>

        {/* Student self-service portal — only reachable by users linked to a Student record. */}
        <Route
          path="/portal"
          element={
            <ProtectedRoute>
              <PortalGate>
                <StudentPortalLayout />
              </PortalGate>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<PortalDashboardPage />} />
          <Route path="id-card" element={<PortalIdCardPage />} />
          <Route path="profile" element={<PortalProfilePage />} />
          <Route path="attendance" element={<PortalAttendancePage />} />
          <Route path="timetable" element={<PortalTimetablePage />} />
          <Route path="courses" element={<PortalCoursesPage />} />
          <Route path="fees" element={<PortalFeesPage />} />
          <Route path="payments" element={<PortalPaymentsPage />} />
          <Route path="exams" element={<PortalExamsPage />} />
          <Route path="results" element={<PortalResultsPage />} />
          <Route path="certificates" element={<PortalCertificatesPage />} />
          <Route path="library" element={<PortalLibraryPage />} />
          <Route path="hostel" element={<PortalHostelPage />} />
          <Route path="transport" element={<PortalTransportPage />} />
          <Route path="notices" element={<PortalNoticesPage />} />
          <Route path="tickets" element={<PortalTicketsPage />} />
          <Route path="documents" element={<PortalDocumentsPage />} />
        </Route>
        {/* Parent/Guardian portal — only reachable by users linked to a Guardian record. */}
        <Route
          path="/parent"
          element={
            <ProtectedRoute>
              <ParentGate>
                <ParentPortalLayout />
              </ParentGate>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<ParentDashboardPage />} />
          <Route path="profile" element={<ParentProfilePage />} />
          <Route path="attendance" element={<ParentAttendancePage />} />
          <Route path="timetable" element={<ParentTimetablePage />} />
          <Route path="fees" element={<ParentFeesPage />} />
          <Route path="payments" element={<ParentPaymentsPage />} />
          <Route path="exams" element={<ParentExamsPage />} />
          <Route path="results" element={<ParentResultsPage />} />
          <Route path="notices" element={<ParentNoticesPage />} />
          <Route path="documents" element={<ParentDocumentsPage />} />
          <Route path="transport" element={<ParentTransportPage />} />
          <Route path="hostel" element={<ParentHostelPage />} />
        </Route>
        {/* Faculty self-service portal — only reachable by users linked to an Employee record. */}
        <Route
          path="/faculty"
          element={
            <ProtectedRoute>
              <FacultyGate>
                <FacultyPortalLayout />
              </FacultyGate>
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<FacultyDashboardPage />} />
          <Route path="profile" element={<FacultyProfilePage />} />
          <Route path="courses" element={<FacultyCoursesPage />} />
          <Route path="students" element={<FacultyStudentsPage />} />
          <Route path="timetable" element={<FacultyTimetablePage />} />
          <Route path="attendance" element={<FacultyAttendancePage />} />
          <Route path="marks" element={<FacultyMarksPage />} />
          <Route path="academics" element={<FacultyAcademicsPage />} />
          <Route path="leave" element={<FacultyLeavePage />} />
          <Route path="workload" element={<FacultyWorkloadPage />} />
          <Route path="notifications" element={<FacultyNotificationsPage />} />
          <Route path="reports" element={<FacultyReportsPage />} />
        </Route>
        {/* Public QR landing — intentionally outside ProtectedRoute; the token is the credential. */}
        <Route path="/verify/certificate" element={<CertificateVerifyPage />} />
        <Route path="/verify/student-id" element={<StudentIdVerifyPage />} />
      </Routes>
      </BrandingProvider>
    </AuthProvider>
  );
}
