import React from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { AuthProvider } from './features/auth/auth-context';
import { PlatformAuthProvider } from './features/platform-auth/platform-auth-context';
import { AdvancedAnalyticsPage } from './routes/analytics';
import { AuditLogPage } from './routes/audit-log';
import { BillingPage } from './routes/billing';
import { DashboardPage } from './routes/dashboard';
import { EntitlementRoute } from './routes/entitlement-route';
import { LoginPage } from './routes/login';
import { PlatformAuditLogPage } from './routes/platform/platform-audit-log';
import { PlatformBillingPage } from './routes/platform/platform-billing';
import { PlatformCatalogPage } from './routes/platform/platform-catalog';
import { PlatformDashboardPage } from './routes/platform/platform-dashboard';
import { PlatformLayout } from './routes/platform/platform-layout';
import { PlatformLoginPage } from './routes/platform/platform-login';
import { PlatformProtectedRoute } from './routes/platform/platform-protected-route';
import { PlatformSupportPage } from './routes/platform/platform-support';
import { PlatformTenantDetailPage } from './routes/platform/platform-tenant-detail';
import { PlatformTenantNewPage } from './routes/platform/platform-tenant-new';
import { PlatformTenantsPage } from './routes/platform/platform-tenants';
import { ProtectedRoute } from './routes/protected-route';
import { StudentProfilePage } from './routes/student-profile';
import { StudentsPage } from './routes/students';
import { TenantConfigurationPage } from './routes/tenant-configuration';
import { OrganizationPage } from './routes/organization';
import { AdmissionsPage } from './routes/admissions';
import { AcademicsPage } from './routes/academics';
import { TimetablePage } from './routes/timetable';
import { AttendancePage } from './routes/attendance';
import { ExamsPage } from './routes/exams';
import { CertificatesPage } from './routes/certificates';
import { CertificateVerifyPage } from './routes/certificate-verify';

function ProfileRoute() {
  const { id } = useParams<{ id: string }>();
  if (!id) return <Navigate to="/students" replace />;
  return <StudentProfilePage studentId={id} />;
}

/** Two entirely separate route trees, each wrapped in its OWN auth provider — the tenant realm
 * (AuthProvider) never renders inside the platform realm's tree and vice versa. This is the
 * routing half of the same isolation lib/platform-http.ts enforces at the HTTP layer: there is
 * no shared React state, no shared token, and no code path that crosses from one to the other. */
export function App() {
  return (
    <Routes>
      <Route path="/platform/*" element={<PlatformArea />} />
      <Route path="/*" element={<TenantArea />} />
    </Routes>
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
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute>
              <AuditLogPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/analytics"
          element={
            <ProtectedRoute>
              <EntitlementRoute entitlement="analytics.advanced">
                <AdvancedAnalyticsPage />
              </EntitlementRoute>
            </ProtectedRoute>
          }
        />
        <Route
          path="/billing"
          element={
            <ProtectedRoute>
              <BillingPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <TenantConfigurationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/organization"
          element={
            <ProtectedRoute>
              <OrganizationPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/students"
          element={
            <ProtectedRoute>
              <StudentsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admissions"
          element={
            <ProtectedRoute>
              <AdmissionsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/academics"
          element={
            <ProtectedRoute>
              <AcademicsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/timetable"
          element={
            <ProtectedRoute>
              <TimetablePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/attendance"
          element={
            <ProtectedRoute>
              <AttendancePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/exams"
          element={
            <ProtectedRoute>
              <ExamsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/certificates"
          element={
            <ProtectedRoute>
              <CertificatesPage />
            </ProtectedRoute>
          }
        />
        {/* Public QR landing — intentionally outside ProtectedRoute; the token is the credential. */}
        <Route path="/verify/certificate" element={<CertificateVerifyPage />} />
        <Route
          path="/students/:id"
          element={
            <ProtectedRoute>
              <ProfileRoute />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}
