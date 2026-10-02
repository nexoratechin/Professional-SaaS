import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@college-erp/ui';
import { apiFetch, ApiError } from '../../lib/http';
import { useAuth } from '../../features/auth/auth-context';

/** Gate that only renders the portal when the signed-in user is actually linked to a Student
 *  record (the API's /student-portal/profile returns 403 otherwise). Keeps staff who happen to
 *  land on /portal from seeing an empty shell. */
export function PortalGate({ children }: { children: React.ReactElement }) {
  const { status } = useAuth();
  const [checking, setChecking] = useState(true);
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let mounted = true;
    setChecking(true);
    apiFetch<unknown>('/student-portal/profile')
      .then(() => {
        if (mounted) setDenied(null);
      })
      .catch((err: unknown) => {
        if (mounted) {
          setDenied(err instanceof ApiError ? err.message : 'Unable to open the student portal.');
        }
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, [status]);

  if (status !== 'authenticated' || checking) {
    return <div style={{ padding: '2rem' }}>Loading…</div>;
  }

  if (denied) {
    return (
      <div style={{ maxWidth: 560, margin: '3rem auto', padding: '0 1rem' }}>
        <Card>
          <h1 style={{ fontSize: '1.1rem', marginTop: 0 }}>Student Portal unavailable</h1>
          <p style={{ color: '#475569' }}>{denied}</p>
          <p>
            <Link to="/dashboard">Return to the dashboard</Link>
          </p>
        </Card>
      </div>
    );
  }

  return children;
}
