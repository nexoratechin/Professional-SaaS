import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, Card } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { readCachedWorkspaces, workspaceLoginPath } from '../features/auth/tenant-workspace';

/**
 * Workspace picker.
 *
 * Tenant sessions are per-college (a JWT is bound to one tenant id), so choosing a different
 * college ends the current session and hands the login form that college's slug plus the last
 * email. The picker itself is public: it must render after logout, from the cached directory.
 *
 * If the directory is empty (new device, cleared storage) we send the user to the normal login
 * form rather than guessing a tenant — there is no default tenant anywhere in this system.
 */
export function SelectTenantPage() {
  const { status, tenants, tenantSlug, lastEmail, logout } = useAuth();
  const navigate = useNavigate();
  const [switchingSlug, setSwitchingSlug] = useState<string | null>(null);

  const options = tenants.length > 0 ? tenants : readCachedWorkspaces();

  if (options.length === 0) {
    return <Navigate to={status === 'authenticated' ? '/dashboard' : '/login'} replace />;
  }

  const choose = async (slug: string) => {
    if (status === 'authenticated' && slug === tenantSlug) {
      navigate('/dashboard');
      return;
    }
    setSwitchingSlug(slug);
    if (status === 'authenticated') {
      await logout();
    }
    navigate(workspaceLoginPath(slug, lastEmail));
  };

  return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: '4rem', minHeight: '100vh' }}>
      <Card style={{ width: 440 }}>
        <h1 style={{ fontSize: '1.25rem', marginBottom: '0.25rem' }}>Choose a workspace</h1>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '1rem' }}>
          {lastEmail ? `Signed in as ${lastEmail}. ` : ''}
          Pick the college you want to open.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {options.map((workspace) => {
            const isCurrent = status === 'authenticated' && workspace.slug === tenantSlug;
            return (
              <button
                key={workspace.slug}
                type="button"
                onClick={() => choose(workspace.slug)}
                disabled={switchingSlug !== null}
                style={{
                  textAlign: 'left',
                  padding: '0.75rem 1rem',
                  borderRadius: 8,
                  border: isCurrent ? '2px solid var(--ui-color-primary, #1d4ed8)' : '1px solid #e5e7eb',
                  background: isCurrent ? '#eff6ff' : '#fff',
                  cursor: switchingSlug === null ? 'pointer' : 'wait',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <span>
                  <strong style={{ display: 'block', fontSize: '0.95rem' }}>{workspace.name}</strong>
                  <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>{workspace.slug}</span>
                </span>
                <span style={{ fontSize: '0.75rem', color: isCurrent ? '#1d4ed8' : '#6b7280' }}>
                  {switchingSlug === workspace.slug ? 'Opening…' : isCurrent ? 'Current' : 'Open'}
                </span>
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
          <Button variant="secondary" onClick={() => navigate('/login')}>
            Use another college
          </Button>
        </div>
      </Card>
    </div>
  );
}
