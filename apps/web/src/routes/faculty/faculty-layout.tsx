import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { Button } from '@college-erp/ui';
import { useAuth } from '../../features/auth/auth-context';
import { PORTAL_CSS } from '../portal/portal-layout';

const NAV_ITEMS: Array<{ to: string; label: string }> = [
  { to: 'dashboard', label: 'Dashboard' },
  { to: 'profile', label: 'Profile' },
  { to: 'courses', label: 'My Courses' },
  { to: 'students', label: 'Students' },
  { to: 'timetable', label: 'Timetable' },
  { to: 'attendance', label: 'Attendance' },
  { to: 'marks', label: 'Marks' },
  { to: 'academics', label: 'Academics' },
  { to: 'leave', label: 'Leave' },
  { to: 'workload', label: 'Workload' },
  { to: 'notifications', label: 'Notifications' },
  { to: 'reports', label: 'Reports' },
];

export function FacultyPortalLayout() {
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
          <a className="sp-brand" href="/faculty/dashboard">
            Faculty Portal <small>· College ERP</small>
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
