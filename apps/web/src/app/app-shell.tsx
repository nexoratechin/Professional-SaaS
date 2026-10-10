import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Breadcrumbs } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { brandingAssetUrl, useBranding } from '../features/branding/branding-context';
import { openGlobalSearch } from '../features/search/search-palette';
import { PwaChrome } from '../features/pwa/pwa-ui';
import { Icon } from './icons';
import { NAV_GROUPS, SEGMENT_LABELS, hasAnyPermission, hasAnyRole } from './nav-config';
import { APP_SHELL_CSS } from './app-css';

const SEARCH_PERMISSION = 'search.view';
const NOTIFICATIONS_PERMISSION = 'notifications.read';

function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?';
}

function labelFor(segment: string): string {
  if (SEGMENT_LABELS[segment]) return SEGMENT_LABELS[segment] as string;
  // Route params (ids, uuids) get a generic label rather than a raw opaque string.
  return /^[0-9a-f]{8,}$/i.test(segment) || /^\d+$/.test(segment) ? 'Details' : segment;
}

/** Adapter so the shared Breadcrumbs renders react-router links without the ui package depending on it. */
function RouterLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}

/**
 * The authenticated staff application shell: responsive sidebar navigation, topbar with breadcrumbs,
 * command-palette trigger and user menu. Every page under the shell keeps its own inline styles and
 * business logic — the shell only supplies consistent chrome, navigation and accessibility.
 */
export function AppLayout() {
  const { user, permissions, entitlements, hasFetchedEntitlements, tenantSlug, logout } = useAuth();
  const { branding } = useBranding();
  const location = useLocation();
  const navigate = useNavigate();
  const [navOpen, setNavOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const portalName = branding?.portalName ?? 'College ERP';

  useEffect(() => {
    setNavOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const onClick = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [userMenuOpen]);

  const roles = user?.roles ?? [];

  const visibleGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            hasAnyPermission(permissions, item.permissions) &&
            hasAnyRole(roles, item.roles) &&
            (!item.entitlement || !hasFetchedEntitlements || entitlements[item.entitlement] === true),
        ),
      })).filter((group) => group.items.length > 0),
    [permissions, roles, entitlements, hasFetchedEntitlements],
  );

  const breadcrumbs = useMemo(() => {
    const parts = location.pathname.split('/').filter(Boolean);
    const items: Array<{ label: string; to?: string }> = [];
    let acc = '';
    parts.forEach((part, index) => {
      acc += `/${part}`;
      const isLast = index === parts.length - 1;
      items.push({ label: labelFor(part), to: isLast ? undefined : acc });
    });
    if (items.length === 0) return [{ label: 'Dashboard' }];
    if (items.length === 1 && parts[0] === 'dashboard') return items;
    return [{ label: 'Home', to: '/dashboard' }, ...items];
  }, [location.pathname]);

  const pageTitle = breadcrumbs[breadcrumbs.length - 1]?.label ?? portalName;
  useEffect(() => {
    document.title = `${pageTitle} · ${portalName}`;
  }, [pageTitle, portalName]);

  const canSearch = permissions.includes(SEARCH_PERMISSION);
  const canSeeNotifications = permissions.includes(NOTIFICATIONS_PERMISSION);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <style>{APP_SHELL_CSS}</style>
      <PwaChrome />

      <div className={`app-backdrop ${navOpen ? 'app-open' : ''}`} onClick={() => setNavOpen(false)} aria-hidden="true" />

      <aside className={`app-sidebar ${navOpen ? 'app-open' : ''}`}>
        <Link to="/dashboard" className="app-sidebar__brand">
          {branding?.logoUrl ? (
            <img src={brandingAssetUrl(branding.logoUrl) as string} alt={portalName} className="app-sidebar__logoimg" />
          ) : (
            <span className="app-sidebar__logo"><Icon name="academics" size={18} /></span>
          )}
          <span>
            {portalName}
            <small>{tenantSlug ?? 'Workspace'}</small>
          </span>
        </Link>
        <nav className="app-sidebar__nav" aria-label="Main navigation">
          {visibleGroups.map((group) => (
            <div className="app-navgroup" key={group.label}>
              <div className="app-navgroup__label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `app-navlink ${isActive ? 'app-active' : ''}`}
                  end={item.to === '/dashboard'}
                >
                  <Icon name={item.icon} size={17} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="app-sidebar__foot">
          <button type="button" className="app-navlink" style={{ width: '100%', border: 0, background: 'transparent', cursor: 'pointer' }} onClick={handleLogout}>
            <Icon name="logout" size={17} />
            <span>Sign out</span>
          </button>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="app-iconbtn app-topbar__menu"
            aria-label="Toggle navigation"
            aria-expanded={navOpen}
            onClick={() => setNavOpen((open) => !open)}
          >
            <Icon name={navOpen ? 'close' : 'menu'} />
          </button>

          <div className="app-breadcrumbs">
            <Breadcrumbs items={breadcrumbs} linkComponent={RouterLink} />
          </div>

          <div className="app-topbar__actions">
            {canSearch && (
              <button type="button" className="app-searchbtn" onClick={openGlobalSearch} aria-label="Open global search">
                <Icon name="search" size={16} />
                <span className="app-searchbtn__label">Search…</span>
                <kbd>Ctrl K</kbd>
              </button>
            )}
            {canSeeNotifications && (
              <Link to="/notifications" className="app-iconbtn" aria-label="Notifications">
                <Icon name="notifications" />
              </Link>
            )}
            <div className="app-user" ref={userMenuRef}>
              <button
                type="button"
                className="app-user__btn"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
                onClick={() => setUserMenuOpen((open) => !open)}
              >
                <span className="app-avatar" aria-hidden="true">{initials(user?.fullName)}</span>
                <span className="app-user__name">{user?.fullName ?? 'Account'}</span>
                <Icon name="chevron" size={14} />
              </button>
              {userMenuOpen && (
                <div className="app-menu" role="menu">
                  <div className="app-menu__head">
                    <strong>{user?.fullName ?? 'Signed in'}</strong>
                    <span>{user?.email}</span>
                    <span>{tenantSlug}</span>
                  </div>
                  <button type="button" role="menuitem" onClick={handleLogout}>
                    <Icon name="logout" size={16} />
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="app-content">
          <div className="app-content__inner">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
