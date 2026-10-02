import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@college-erp/ui';
import { useAuth } from '../../features/auth/auth-context';

/** Mobile-first responsive styles for the portal. The rest of the app uses inline styles; the
 *  portal needs a handful of media queries, so a single scoped stylesheet is injected here. */
const PORTAL_CSS = `
.sp-shell { min-height: 100vh; background: #f8fafc; color: #0f172a; }
.sp-header { position: sticky; top: 0; z-index: 30; background: #1e293b; color: #fff; }
.sp-header-inner { max-width: 1180px; margin: 0 auto; padding: 0.7rem 1rem; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.sp-brand { font-weight: 700; font-size: 1rem; color: #fff; text-decoration: none; white-space: nowrap; }
.sp-brand small { color: #94a3b8; font-weight: 500; }
.sp-menu-btn { margin-left: auto; background: transparent; color: #e2e8f0; border: 1px solid #475569; border-radius: 8px; padding: 6px 12px; font-size: 0.85rem; cursor: pointer; }
.sp-user { color: #cbd5e1; font-size: 0.8rem; }
.sp-nav { display: none; flex-direction: column; width: 100%; gap: 2px; padding: 4px 0 10px; }
.sp-nav.sp-nav-open { display: flex; }
.sp-nav a { color: #cbd5e1; text-decoration: none; padding: 9px 12px; border-radius: 8px; font-size: 0.9rem; }
.sp-nav a.sp-active { background: #334155; color: #fff; }
.sp-main { max-width: 1180px; margin: 0 auto; padding: 1rem; }
.sp-page-head { display: flex; flex-direction: column; gap: 10px; }
.sp-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.sp-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.sp-stat { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; }
.sp-table-wrap { width: 100%; overflow-x: auto; }
.sp-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.sp-muted { color: #64748b; font-size: 0.85rem; }
.sp-row { display: flex; flex-direction: column; gap: 4px; }
.sp-kv { display: grid; grid-template-columns: 1fr; gap: 2px; padding: 6px 0; border-bottom: 1px solid #f1f5f9; }
.sp-kv span:first-child { color: #64748b; font-size: 0.8rem; }
@media (min-width: 768px) {
  .sp-menu-btn { display: none; }
  .sp-nav { display: flex !important; flex-direction: row; width: auto; margin-left: 12px; flex-wrap: wrap; padding: 0; }
  .sp-page-head { flex-direction: row; align-items: center; justify-content: space-between; }
  .sp-user { margin-left: auto; }
  .sp-kv { grid-template-columns: 200px 1fr; }
}
`;

const NAV_ITEMS: Array<{ to: string; label: string }> = [
  { to: 'dashboard', label: 'Dashboard' },
  { to: 'profile', label: 'Profile' },
  { to: 'attendance', label: 'Attendance' },
  { to: 'timetable', label: 'Timetable' },
  { to: 'courses', label: 'Courses' },
  { to: 'fees', label: 'Fees' },
  { to: 'payments', label: 'Payments' },
  { to: 'exams', label: 'Exams' },
  { to: 'results', label: 'Results' },
  { to: 'certificates', label: 'Certificates' },
  { to: 'library', label: 'Library' },
  { to: 'hostel', label: 'Hostel' },
  { to: 'transport', label: 'Transport' },
  { to: 'notices', label: 'Notices' },
  { to: 'tickets', label: 'Support Tickets' },
  { to: 'documents', label: 'Documents' },
];

export function StudentPortalLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="sp-shell">
      <style>{PORTAL_CSS}</style>
      <header className="sp-header">
        <div className="sp-header-inner">
          <a className="sp-brand" href="/portal/dashboard">
            Student Portal <small>· College ERP</small>
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
          <span className="sp-user">{user?.fullName}</span>
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
