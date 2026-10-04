import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@college-erp/ui';
import { useAuth } from '../../features/auth/auth-context';
import { PwaChrome } from '../../features/pwa/pwa-ui';
import { PORTAL_CSS } from '../portal/portal-layout';
import { useParentPortal } from './parent-context';

const NAV_ITEMS: Array<{ to: string; label: string }> = [
  { to: 'dashboard', label: 'Dashboard' },
  { to: 'profile', label: 'Profile' },
  { to: 'attendance', label: 'Attendance' },
  { to: 'timetable', label: 'Timetable' },
  { to: 'fees', label: 'Fees' },
  { to: 'payments', label: 'Payments' },
  { to: 'exams', label: 'Exams' },
  { to: 'results', label: 'Results' },
  { to: 'notices', label: 'Notices' },
  { to: 'documents', label: 'Documents' },
  { to: 'transport', label: 'Transport' },
  { to: 'hostel', label: 'Hostel' },
];

export function ParentPortalLayout() {
  const { user, logout } = useAuth();
  const { children, selected, selectChild } = useParentPortal();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="sp-shell">
      <style>{PORTAL_CSS}</style>
      <PwaChrome />
      <header className="sp-header">
        <div className="sp-header-inner">
          <a className="sp-brand" href="/parent/dashboard">
            Parent Portal <small>· College ERP</small>
          </a>
          <button
            type="button"
            className="sp-menu-btn"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
          >
            {menuOpen ? 'Close' : 'Menu'}
          </button>
          <nav className={`sp-nav ${menuOpen ? 'sp-nav-open' : ''}`}>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'sp-active' : undefined)}
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          {(children.length > 1 || (selected && user)) && (
            <span className="sp-user" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {children.length > 1 && (
                <select
                  aria-label="Select child"
                  value={selected?.studentId ?? ''}
                  onChange={(event) => selectChild(event.target.value)}
                  style={{ padding: 6, borderRadius: 8, border: '1px solid #475569' }}
                >
                  {children.map((child) => (
                    <option key={child.studentId} value={child.studentId}>
                      {child.fullName}
                    </option>
                  ))}
                </select>
              )}
              {children.length === 1 && selected && <span>{selected.fullName}</span>}
            </span>
          )}
          <Button variant="secondary" onClick={handleLogout}>
            Log out
          </Button>
        </div>
      </header>
      <main className="sp-main">
        <Outlet />
      </main>
    </div>
  );
}
