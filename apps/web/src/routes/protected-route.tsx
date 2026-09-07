import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../features/auth/auth-context';

export function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return <div style={{ padding: '2rem' }}>Loading…</div>;
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  return children;
}
