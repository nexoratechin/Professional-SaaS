import React from 'react';
import { Navigate } from 'react-router-dom';
import { useEntitlement } from '../features/auth/auth-context';

/**
 * Wraps a protected child route so it only renders when the current tenant is entitled to the
 * given granular capability. This is a UI/navigation-layer gate ONLY — the backend
 * EntitlementFlagsGuard independently rejects unauthorized API calls. Without the entitlement the
 * user is sent to /dashboard rather than shown a 403, matching the pattern of ProtectedRoute.
 */
export function EntitlementRoute({
  entitlement,
  children,
}: {
  entitlement: string;
  children: React.ReactElement;
}) {
  const enabled = useEntitlement(entitlement);
  if (!enabled) {
    return <Navigate to="/dashboard" replace />;
  }
  return children;
}