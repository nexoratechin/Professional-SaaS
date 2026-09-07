import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';

export function DashboardPage() {
  const { user, permissions, features, tenantSlug, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div style={{ maxWidth: 720, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>College ERP — Dashboard</h1>
        <Button variant="secondary" onClick={handleLogout}>
          Log out
        </Button>
      </div>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Session</h2>
        <p>Tenant: {tenantSlug}</p>
        <p>User: {user?.fullName} ({user?.email})</p>
        <p>Status: {user?.status}</p>
        <p>Roles: {user?.roles.join(', ') || 'none'}</p>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Effective permissions</h2>
        {permissions.length === 0 ? (
          <p>No permissions granted.</p>
        ) : (
          <ul>
            {permissions.map((permission) => (
              <li key={permission}>{permission}</li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Feature flags for this tenant's plan</h2>
        {Object.keys(features).length === 0 ? (
          <p>Not visible with the current role (requires tenant.features.manage).</p>
        ) : (
          <ul>
            {Object.entries(features).map(([key, enabled]) => (
              <li key={key} style={{ color: enabled ? '#15803d' : '#9ca3af' }}>
                {key}: {enabled ? 'enabled' : 'disabled'}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
