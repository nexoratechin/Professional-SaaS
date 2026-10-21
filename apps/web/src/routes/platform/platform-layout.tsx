import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import type { PlatformMaintenanceModeDto } from '@college-erp/types';
import { Button } from '@college-erp/ui';
import { usePlatformAuth } from '../../features/platform-auth/platform-auth-context';
import { visiblePlatformSections } from '../../features/platform-auth/platform-access';
import {
  clearActiveCompany,
  companyAccent,
  companyInitials,
  readActiveCompany,
} from '../../features/platform-auth/platform-company';
import { platformApiFetch } from '../../lib/platform-http';

/**
 * Console chrome for the platform (control-plane) area.
 *
 * The dark banner with the "PLATFORM ADMIN" label is a human-facing reinforcement of the same
 * boundary lib/platform-http.ts enforces in code: nothing in this shell ever shows or implies a
 * "current tenant" token. The company chip is navigation state only — every page still fetches
 * that company by id with the platform token.
 */
export function PlatformLayout() {
  const { platformUser, logout } = usePlatformAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [maintenance, setMaintenance] = useState<PlatformMaintenanceModeDto | null>(null);

  // Re-read on every navigation so "Switch company" immediately reflects the new selection.
  const activeCompany = readActiveCompany();
  const navLinks = visiblePlatformSections(platformUser?.role);

  useEffect(() => {
    platformApiFetch<PlatformMaintenanceModeDto>('/platform/maintenance')
      .then(setMaintenance)
      .catch(() => setMaintenance(null));
  }, [location.pathname]);

  const handleLogout = async () => {
    clearActiveCompany();
    await logout();
    navigate('/platform/login');
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f6f8fb' }}>
      <header style={{ background: '#0f172a', color: '#f8fafc', position: 'sticky', top: 0, zIndex: 20 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 16,
            padding: '0.7rem 1.25rem',
            borderBottom: '1px solid #1e293b',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
            <Link to="/platform/select-company" style={{ display: 'flex', alignItems: 'center', gap: 9, color: '#f8fafc' }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'linear-gradient(145deg, #3b82f6, #1d4ed8)',
                  fontSize: '0.65rem',
                  fontWeight: 800,
                }}
              >
                CE
              </span>
              <span style={{ fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>
                College<span style={{ fontWeight: 400, color: '#93c5fd' }}>ERP</span>
              </span>
            </Link>
            <span
              style={{
                fontSize: '0.64rem',
                fontWeight: 800,
                letterSpacing: '0.18em',
                color: '#94a3b8',
                borderLeft: '1px solid #334155',
                paddingLeft: 16,
              }}
            >
              PLATFORM ADMIN
            </span>
            {maintenance?.enabled && (
              <span
                title={maintenance.message ?? 'Tenant sign-ins are disabled'}
                style={{
                  fontSize: '0.64rem',
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  background: '#7f1d1d',
                  color: '#fecaca',
                  padding: '3px 8px',
                  borderRadius: 999,
                }}
              >
                MAINTENANCE ON
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {activeCompany ? (
              <button
                type="button"
                onClick={() => navigate(`/platform/tenants/${activeCompany.id}`)}
                title={`Open ${activeCompany.name}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: 999,
                  color: '#e2e8f0',
                  padding: '3px 10px 3px 3px',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    display: 'grid',
                    placeItems: 'center',
                    background: companyAccent(activeCompany.id),
                    fontSize: '0.58rem',
                    fontWeight: 800,
                  }}
                >
                  {companyInitials(activeCompany.name)}
                </span>
                <span style={{ fontSize: '0.78rem', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {activeCompany.name}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => navigate('/platform/select-company')}
                style={{
                  background: 'transparent',
                  border: '1px dashed #475569',
                  borderRadius: 999,
                  color: '#cbd5e1',
                  padding: '4px 10px',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                }}
              >
                Select company
              </button>
            )}
            <span style={{ fontSize: '0.75rem', color: '#94a3b8' }}>
              {platformUser?.fullName} · {platformUser?.role === 'PLATFORM_ADMIN' ? 'Admin' : 'Support'}
            </span>
            <Button variant="secondary" size="sm" onClick={handleLogout}>
              Log out
            </Button>
          </div>
        </div>

        <nav
          style={{
            display: 'flex',
            gap: 4,
            padding: '0 1rem',
            overflowX: 'auto',
            scrollbarWidth: 'thin',
          }}
          aria-label="Platform sections"
        >
          <Link
            to="/platform/select-company"
            style={{
              padding: '0.6rem 0.7rem',
              fontSize: '0.8rem',
              color: location.pathname === '/platform/select-company' ? '#fff' : '#cbd5e1',
              borderBottom:
                location.pathname === '/platform/select-company' ? '2px solid #3b82f6' : '2px solid transparent',
              whiteSpace: 'nowrap',
            }}
          >
            Companies
          </Link>
          {navLinks.map((link) => {
            const isActive = location.pathname === link.to || location.pathname.startsWith(`${link.to}/`);
            return (
              <Link
                key={link.to}
                to={link.to}
                style={{
                  padding: '0.6rem 0.7rem',
                  fontSize: '0.8rem',
                  color: isActive ? '#fff' : '#cbd5e1',
                  borderBottom: isActive ? '2px solid #3b82f6' : '2px solid transparent',
                  whiteSpace: 'nowrap',
                }}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main style={{ flex: 1, padding: '1.5rem', maxWidth: 1180, width: '100%', margin: '0 auto' }}>
        <Outlet />
      </main>
    </div>
  );
}
