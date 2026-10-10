import React from 'react';
import { Navigate } from 'react-router-dom';
import { Spinner } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';

export function ProtectedRoute({ children }: { children: React.ReactElement }) {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 10, color: '#475569' }}>
        <Spinner />
        <span>Loading…</span>
      </div>
    );
  }
  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace />;
  }
  return children;
}
