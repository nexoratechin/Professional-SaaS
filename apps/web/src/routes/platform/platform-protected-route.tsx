import React from 'react';
import { Navigate } from 'react-router-dom';
import { usePlatformAuth } from '../../features/platform-auth/platform-auth-context';
import { isPlatformAdmin, isPlatformRole } from '../../features/platform-auth/platform-access';

interface PlatformProtectedRouteProps {
  children: React.ReactElement;
  /** Routes that change platform state (billing, plans, audit, tenant creation) are admin-only. */
  adminOnly?: boolean;
}

/**
 * Gate for every page under `/platform/*` except the login screen.
 *
 * Three distinct outcomes, in order:
 *   1. session still restoring        → wait (never render a tenant or admin screen early)
 *   2. no valid platform session/role → `/platform/login`
 *   3. authenticated but not an admin → `/platform/dashboard` (support keeps its read-only shell)
 *
 * The platform role is verified here as well as in the navigation, so a support account cannot
 * reach an admin URL by typing it. Server-side `@RequirePlatformRole` remains the real boundary.
 */
export function PlatformProtectedRoute({ children, adminOnly = false }: PlatformProtectedRouteProps) {
  const { status, platformUser } = usePlatformAuth();

  if (status === 'loading') {
    return <div style={{ padding: '2rem' }}>Loading…</div>;
  }
  if (status === 'unauthenticated' || !platformUser || !isPlatformRole(platformUser.role)) {
    return <Navigate to="/platform/login" replace />;
  }
  if (adminOnly && !isPlatformAdmin(platformUser.role)) {
    return <Navigate to="/platform/dashboard" replace />;
  }
  return children;
}
