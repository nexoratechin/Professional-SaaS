import React, { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, CardBody, Grid, Inline, PageHeader, Stack, StatCard } from '@college-erp/ui';
import { useAuth, useEntitlement } from '../features/auth/auth-context';
import { openGlobalSearch } from '../features/search/search-palette';
import { Icon } from '../app/icons';
import { NAV_GROUPS, hasAnyPermission, hasAnyRole, type NavItem } from '../app/nav-config';

const SEARCH_VIEW_PERMISSION = 'search.view';

interface ModuleEntry extends NavItem {
  group: string;
}

function ModuleCard({ item }: { item: ModuleEntry }) {
  return (
    <Link
      to={item.to}
      className="ui-card"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        textDecoration: 'none',
        color: 'inherit',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 38,
          height: 38,
          borderRadius: 'var(--ui-radius-md)',
          background: 'var(--ui-color-primary-soft)',
          color: 'var(--ui-color-primary)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flex: '0 0 auto',
        }}
      >
        <Icon name={item.icon} size={19} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{item.label}</span>
        <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--ui-color-text-muted)' }}>{item.group}</span>
      </span>
    </Link>
  );
}

export function DashboardPage() {
  const { user, permissions, features, entitlements, hasFetchedEntitlements, tenantSlug, logout } = useAuth();
  const navigate = useNavigate();
  const entitledAi = useEntitlement('ai.assistant');
  const entitledAnalytics = useEntitlement('analytics.advanced');

  const roles = user?.roles ?? [];

  // Module grid mirrors the sidebar, but the dashboard surfaces the full map so a user can see what
  // they have access to at a glance. Every link is permission/role/entitlement filtered, exactly
  // like the shell — and every destination is independently guarded server-side.
  const modules = useMemo<ModuleEntry[]>(
    () =>
      NAV_GROUPS.flatMap((group) =>
        group.items
          .filter(
            (item) =>
              hasAnyPermission(permissions, item.permissions) &&
              hasAnyRole(roles, item.roles) &&
              (!item.entitlement || !hasFetchedEntitlements || entitlements[item.entitlement] === true),
          )
          .map((item) => ({ ...item, group: group.label })),
      ),
    [permissions, roles, entitlements, hasFetchedEntitlements],
  );

  const featureList = Object.entries(features);
  const entitlementList = Object.entries(entitlements);
  const enabledFeatures = featureList.filter(([, enabled]) => enabled).length;
  const enabledEntitlements = entitlementList.filter(([, enabled]) => enabled).length;
  const firstName = user?.fullName?.split(' ')[0] ?? 'there';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <Stack gap={6}>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description={
          <span>
            {tenantSlug ? <Badge tone="primary">{tenantSlug}</Badge> : null}{' '}
            {user?.email} · {user?.roles.join(', ') || 'no roles'}
          </span>
        }
        actions={
          <>
            {roles.includes('STUDENT') && <Button variant="secondary" onClick={() => navigate('/portal/dashboard')}>Student Portal</Button>}
            {roles.includes('PARENT') && <Button variant="secondary" onClick={() => navigate('/parent/dashboard')}>Parent Portal</Button>}
            {roles.includes('FACULTY') && <Button variant="secondary" onClick={() => navigate('/faculty/dashboard')}>Faculty Portal</Button>}
            {permissions.includes(SEARCH_VIEW_PERMISSION) && (
              <Button variant="secondary" iconLeft={<Icon name="search" size={16} />} onClick={openGlobalSearch}>
                Search
              </Button>
            )}
            <Button variant="ghost" onClick={handleLogout}>
              Sign out
            </Button>
          </>
        }
      />

      <Grid columns={undefined} min={200} gap={4}>
        <StatCard label="Available modules" value={modules.length} hint={user?.status ? `Account: ${user.status}` : undefined} />
        <StatCard label="Effective permissions" value={permissions.length} />
        <StatCard label="Enabled feature flags" value={featureList.length === 0 ? '—' : enabledFeatures} hint={featureList.length === 0 ? 'Requires tenant.features.manage' : undefined} />
        <StatCard label="Active entitlements" value={entitlementList.length === 0 ? '—' : enabledEntitlements} />
      </Grid>

      <Card>
        <CardBody>
          <Inline justify="space-between" style={{ marginBottom: 4 }}>
            <h2 className="ui-card__title">Your modules</h2>
            <span style={{ fontSize: '0.82rem', color: 'var(--ui-color-text-muted)' }}>
              {permissions.includes(SEARCH_VIEW_PERMISSION) ? 'Tip: press Ctrl + K to search anything' : ''}
            </span>
          </Inline>
          {modules.length === 0 ? (
            <p style={{ color: 'var(--ui-color-text-muted)', marginTop: 8 }}>
              No modules are available for your role. Contact your administrator if this looks wrong.
            </p>
          ) : (
            <Grid min={240} gap={4} style={{ marginTop: 12 }}>
              {modules.map((item) => (
                <ModuleCard key={item.to} item={item} />
              ))}
            </Grid>
          )}
        </CardBody>
      </Card>

      {(entitledAi || entitledAnalytics) && (
        <Card>
          <CardBody>
            <h2 className="ui-card__title" style={{ marginBottom: 8 }}>Add-ons on your plan</h2>
            <Inline gap={2}>
              {entitledAnalytics && <Badge tone="success">Advanced analytics</Badge>}
              {entitledAi && <Badge tone="success">AI assistant</Badge>}
            </Inline>
          </CardBody>
        </Card>
      )}

      <details className="ui-card" style={{ padding: 0 }}>
        <summary style={{ cursor: 'pointer', padding: '14px 20px', fontWeight: 600, listStyle: 'revert' }}>
          Account &amp; access details
        </summary>
        <div style={{ padding: '0 20px 20px' }}>
          <Grid min={300} gap={4}>
            <Stack gap={2}>
              <h3 style={{ fontSize: '0.95rem' }}>Session</h3>
              <Kv k="Tenant" v={tenantSlug ?? '—'} />
              <Kv k="User" v={user?.fullName ?? '—'} />
              <Kv k="Email" v={user?.email ?? '—'} />
              <Kv k="Status" v={user?.status ?? '—'} />
              <Kv k="Roles" v={user?.roles.join(', ') || 'none'} />
            </Stack>

            <Stack gap={2}>
              <h3 style={{ fontSize: '0.95rem' }}>Effective permissions ({permissions.length})</h3>
              {permissions.length === 0 ? (
                <p style={{ color: 'var(--ui-color-text-muted)' }}>No permissions granted.</p>
              ) : (
                <Inline gap={1}>
                  {permissions.map((permission) => (
                    <Badge key={permission}>{permission}</Badge>
                  ))}
                </Inline>
              )}
            </Stack>

            <Stack gap={2}>
              <h3 style={{ fontSize: '0.95rem' }}>Feature flags</h3>
              {featureList.length === 0 ? (
                <p style={{ color: 'var(--ui-color-text-muted)' }}>Not visible with the current role (requires tenant.features.manage).</p>
              ) : (
                <Inline gap={1}>
                  {featureList.map(([key, enabled]) => (
                    <Badge key={key} tone={enabled ? 'success' : 'neutral'}>
                      {key}
                    </Badge>
                  ))}
                </Inline>
              )}
            </Stack>

            <Stack gap={2}>
              <h3 style={{ fontSize: '0.95rem' }}>Granular entitlements</h3>
              {entitlementList.length === 0 ? (
                <p style={{ color: 'var(--ui-color-text-muted)' }}>No entitlement data loaded.</p>
              ) : (
                <Inline gap={1}>
                  {entitlementList.map(([key, enabled]) => (
                    <Badge key={key} tone={enabled ? 'success' : 'neutral'}>
                      {key}
                    </Badge>
                  ))}
                </Inline>
              )}
            </Stack>
          </Grid>
        </div>
      </details>
    </Stack>
  );
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', gap: 12, borderBottom: '1px solid var(--ui-color-border)', padding: '6px 0' }}>
      <span style={{ minWidth: 90, color: 'var(--ui-color-text-muted)', fontSize: '0.82rem' }}>{k}</span>
      <span style={{ fontSize: '0.9rem' }}>{v}</span>
    </div>
  );
}
