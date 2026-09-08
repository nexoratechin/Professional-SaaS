import React from 'react';
import { Navigate } from 'react-router-dom';
import { usePlatformAuth } from '../../features/platform-auth/platform-auth-context';

export function PlatformProtectedRoute({ children }: { children: React.ReactElement }) {
  const { status } = usePlatformAuth();

  if (status === 'loading') {
    return <div style={{ padding: '2rem' }}>Loading…</div>;
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/platform/login" replace />;
  }
  return children;
}
