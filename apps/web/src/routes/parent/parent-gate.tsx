import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@college-erp/ui';
import { apiFetch, ApiError } from '../../lib/http';
import { useAuth } from '../../features/auth/auth-context';
import { ParentChild, ParentPortalContext } from './parent-context';

/** Gate that only renders the parent portal when the signed-in user is actually linked to at least
 *  one Guardian row (the API's /parent-portal/children returns 403 otherwise). Keeps staff who
 *  happen to land on /parent from seeing an empty shell. */
export function ParentGate({ children: content }: { children: React.ReactElement }) {
  const { status } = useAuth();
  const [checking, setChecking] = useState(true);
  const [denied, setDenied] = useState<string | null>(null);
  const [children, setChildren] = useState<ParentChild[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiFetch<{ children: ParentChild[] }>('/parent-portal/children');
    if (!result.children.length) {
      throw new ApiError(403, 'Your account is not linked to a student profile. Please contact the registrar.');
    }
    setChildren(result.children);
    setSelectedId((current) =>
      current && result.children.some((child) => child.studentId === current)
        ? current
        : result.children[0]!.studentId,
    );
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') return;
    let mounted = true;
    setChecking(true);
    load()
      .then(() => {
        if (mounted) setDenied(null);
      })
      .catch((err: unknown) => {
        if (mounted) {
          setDenied(err instanceof ApiError ? err.message : 'Unable to open the parent portal.');
        }
      })
      .finally(() => {
        if (mounted) setChecking(false);
      });
    return () => {
      mounted = false;
    };
  }, [status, load]);

  if (status !== 'authenticated' || checking) {
    return <div style={{ padding: '2rem' }}>Loading…</div>;
  }

  if (denied || !selectedId) {
    return (
      <div style={{ maxWidth: 560, margin: '3rem auto', padding: '0 1rem' }}>
        <Card>
          <h1 style={{ fontSize: '1.1rem', marginTop: 0 }}>Parent Portal unavailable</h1>
          <p style={{ color: '#475569' }}>{denied ?? 'No linked children were found.'}</p>
          <p>
            <Link to="/dashboard">Return to the dashboard</Link>
          </p>
        </Card>
      </div>
    );
  }

  const selected = children.find((child) => child.studentId === selectedId) ?? null;

  return (
    <ParentPortalContext.Provider
      value={{
        children,
        selected,
        selectedId,
        selectChild: setSelectedId,
        reloadChildren: async () => {
          await load();
        },
      }}
    >
      {content}
    </ParentPortalContext.Provider>
  );
}
