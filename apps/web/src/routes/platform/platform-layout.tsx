import React from 'react';
import { Link, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@college-erp/ui';
import { usePlatformAuth } from '../../features/platform-auth/platform-auth-context';

const NAV_LINKS = [
  { to: '/platform/dashboard', label: 'Dashboard' },
  { to: '/platform/tenants', label: 'Tenants' },
  { to: '/platform/billing', label: 'Billing' },
  { to: '/platform/catalog', label: 'Plans & Features' },
  { to: '/platform/support', label: 'Support' },
  { to: '/platform/audit-log', label: 'Audit Log' },
];

/** A visibly distinct chrome (dark banner, "PLATFORM ADMIN" label) around every page in this
 * area — a human-facing reinforcement of the same boundary lib/platform-http.ts enforces in
 * code: nothing in this shell ever shows or implies a "current tenant". */
export function PlatformLayout() {
  const { platformUser, logout } = usePlatformAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/platform/login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          background: '#111827',
          color: '#f9fafb',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <strong style={{ letterSpacing: '0.05em', fontSize: '0.9rem' }}>⚙ PLATFORM ADMIN</strong>
          <nav style={{ display: 'flex', gap: 16 }}>
            {NAV_LINKS.map((link) => (
              <Link key={link.to} to={link.to} style={{ color: '#e5e7eb', fontSize: '0.85rem', textDecoration: 'none' }}>
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>
            {platformUser?.fullName} ({platformUser?.role})
          </span>
          <Button variant="secondary" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>
      <main style={{ flex: 1, padding: '1.5rem', maxWidth: 1100, width: '100%', margin: '0 auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
