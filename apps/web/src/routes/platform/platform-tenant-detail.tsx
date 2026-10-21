import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type {
  AuditLogEntryDto,
  PlatformTenantDto,
  PlatformTenantUserDto,
  TenantUsageDto,
} from '@college-erp/types';
import { Badge, Button, Card, Input, Tabs } from '@college-erp/ui';
import { Icon } from '../../app/icons';
import { usePlatformAuth } from '../../features/platform-auth/platform-auth-context';
import { isPlatformAdmin } from '../../features/platform-auth/platform-access';
import {
  companyAccent,
  companyInitials,
  writeActiveCompany,
} from '../../features/platform-auth/platform-company';
import { platformApiFetch, platformApiFetchPaged } from '../../lib/platform-http';

interface SubscriptionDto {
  id: string;
  status: string;
  billingCycle: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  plan: { code: string; name: string };
}

interface InvoiceDto {
  id: string;
  invoiceNumber: string;
  status: string;
  totalCents: number;
  currency: string;
  dueAt: string | null;
  issuedAt: string | null;
  subscriptionId?: string | null;
}

interface PlanDto {
  id: string;
  code: string;
  name: string;
}

interface EntitlementDto {
  id: string;
  key: string;
  type: 'BOOLEAN' | 'LIMIT';
  boolValue: boolean;
  limitValue: number | null;
  source: string;
  reason: string | null;
  effectiveUntil: string | null;
}

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'users', label: 'Users' },
  { key: 'billing', label: 'Billing' },
  { key: 'features', label: 'Features & limits' },
  { key: 'activity', label: 'Activity' },
  { key: 'settings', label: 'Settings' },
];

const STATUS_TONE: Record<PlatformTenantDto['status'], 'info' | 'success' | 'warning' | 'neutral'> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  CANCELED: 'neutral',
};

const USER_STATUS_TONE: Record<PlatformTenantUserDto['status'], 'success' | 'warning' | 'neutral' | 'info'> = {
  ACTIVE: 'success',
  INVITED: 'info',
  SUSPENDED: 'warning',
  DEACTIVATED: 'neutral',
};

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`;
}

function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  return new Date(value).toLocaleString(undefined, withTime ? undefined : { dateStyle: 'medium' });
}

/** Small label/value block used across the overview and settings tabs. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#94a3b8' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.88rem', color: '#0f172a', marginTop: 3, overflowWrap: 'anywhere' }}>{children}</div>
    </div>
  );
}

/**
 * The superadmin's company console: everything an operator needs to manage one tenant without
 * being signed in as that tenant's user. It is intentionally NOT impersonation — every call here
 * uses the platform token against `/tenants/:id/*`, and the tenant realm's token is never
 * created. The page reads the tenant's data through the control plane's own endpoints.
 */
export function PlatformTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { platformUser } = usePlatformAuth();
  const isAdmin = isPlatformAdmin(platformUser?.role);

  const [tab, setTab] = useState('overview');
  const [tenant, setTenant] = useState<PlatformTenantDto | null>(null);
  const [usage, setUsage] = useState<TenantUsageDto | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDto[]>([]);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [users, setUsers] = useState<PlatformTenantUserDto[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementDto[]>([]);
  const [activity, setActivity] = useState<AuditLogEntryDto[]>([]);
  const [newPlanCode, setNewPlanCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const [tenantRes, usageRes, subscriptionsRes, plansRes, usersRes, entitlementsRes, invoiceRes] = await Promise.all([
        platformApiFetch<PlatformTenantDto>(`/tenants/${id}`),
        platformApiFetch<TenantUsageDto>(`/tenants/${id}/usage`),
        platformApiFetch<SubscriptionDto[]>(`/tenants/${id}/subscriptions`),
        platformApiFetch<PlanDto[]>('/plans'),
        platformApiFetch<PlatformTenantUserDto[]>(`/tenants/${id}/users`).catch(() => []),
        platformApiFetch<EntitlementDto[]>(`/tenants/${id}/entitlements`).catch(() => []),
        platformApiFetch<InvoiceDto[]>(`/tenants/${id}/invoices`).catch(() => []),
      ]);
      setTenant(tenantRes);
      setUsage(usageRes);
      setSubscriptions(subscriptionsRes);
      setPlans(plansRes);
      setUsers(usersRes);
      setEntitlements(entitlementsRes);
      setInvoices(invoiceRes);
      writeActiveCompany({ id: tenantRes.id, name: tenantRes.name, slug: tenantRes.slug });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load company.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadActivity = useCallback(async () => {
    if (!id) return;
    try {
      const { data } = await platformApiFetchPaged<AuditLogEntryDto[]>(`/platform/audit-logs?tenantId=${id}&take=50`);
      setActivity(data);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to load activity.');
    }
  }, [id]);

  useEffect(() => {
    if (tab === 'activity') void loadActivity();
  }, [tab, loadActivity]);

  const runAction = async (action: () => Promise<unknown>, successMessage: string) => {
    setActionError(null);
    setNotice(null);
    setBusy(true);
    try {
      await action();
      await load();
      setNotice(successMessage);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const activate = () => runAction(() => platformApiFetch(`/tenants/${id}/activate`, { method: 'POST', body: '{}' }), 'Company activated.');
  const suspend = () => runAction(() => platformApiFetch(`/tenants/${id}/suspend`, { method: 'POST', body: '{}' }), 'Company suspended. Tenant sign-ins are blocked.');
  const deactivate = () => runAction(() => platformApiFetch(`/tenants/${id}/deactivate`, { method: 'POST', body: '{}' }), 'Company deactivated.');

  const createSubscription = () =>
    runAction(() => {
      const now = new Date();
      const oneYearOut = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
      return platformApiFetch('/subscriptions', {
        method: 'POST',
        body: JSON.stringify({
          tenantId: id,
          planCode: newPlanCode,
          billingCycle: 'ANNUAL',
          currentPeriodStart: now.toISOString(),
          currentPeriodEnd: oneYearOut.toISOString(),
        }),
      });
    }, 'Subscription created.');

  const generateInvoice = (subscriptionId: string) =>
    runAction(() => platformApiFetch(`/subscriptions/${subscriptionId}/invoices`, { method: 'POST', body: '{}' }), 'Invoice generated.');
  const markPaid = (invoiceId: string) =>
    runAction(() => platformApiFetch(`/invoices/${invoiceId}/mark-paid`, { method: 'POST' }), 'Invoice marked paid.');
  const voidInvoice = (invoiceId: string) =>
    runAction(() => platformApiFetch(`/invoices/${invoiceId}/void`, { method: 'POST' }), 'Invoice voided.');

  const updateUserStatus = (userId: string, status: PlatformTenantUserDto['status']) =>
    runAction(
      () => platformApiFetch(`/tenants/${id}/users/${userId}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
      'User status updated.',
    );

  const saveSettings = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    return runAction(
      () =>
        platformApiFetch(`/tenants/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            name: String(form.get('name') ?? ''),
            billingEmail: String(form.get('billingEmail') ?? ''),
            timezone: String(form.get('timezone') ?? ''),
          }),
        }),
      'Company profile saved.',
    );
  };

  const setEntitlement = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const type = String(form.get('type') ?? 'BOOLEAN') as 'BOOLEAN' | 'LIMIT';
    return runAction(
      () =>
        platformApiFetch(`/tenants/${id}/entitlements`, {
          method: 'PATCH',
          body: JSON.stringify({
            key: String(form.get('key') ?? '').trim(),
            type,
            ...(type === 'BOOLEAN'
              ? { boolValue: form.get('boolValue') === 'on' }
              : { limitValue: Number(form.get('limitValue') ?? 0) }),
            reason: String(form.get('reason') ?? '') || undefined,
          }),
        }),
      'Entitlement override saved.',
    );
  };

  const removeEntitlementOverride = (key: string) =>
    runAction(
      () => platformApiFetch(`/tenants/${id}/entitlements/${encodeURIComponent(key)}/remove-override`, { method: 'POST', body: '{}' }),
      'Override removed.',
    );

  const activeSubscription = useMemo(
    () => subscriptions.find((subscription) => subscription.status === 'ACTIVE') ?? subscriptions[0],
    [subscriptions],
  );

  if (!id) {
    return <p>Missing company id.</p>;
  }
  if (loading) {
    return <p>Loading company…</p>;
  }
  if (error || !tenant || !usage) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ color: '#b91c1c' }}>{error ?? 'Company not found.'}</p>
        <Link to="/platform/select-company" style={{ color: '#1d4ed8' }}>
          ← Back to companies
        </Link>
      </div>
    );
  }

  const tone = STATUS_TONE[tenant.status];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <Link to="/platform/select-company" style={{ fontSize: '0.8rem', color: '#64748b' }}>
          ← All companies
        </Link>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginTop: 10, flexWrap: 'wrap' }}>
          <span
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: '0.85rem',
              background: companyAccent(tenant.id),
            }}
          >
            {companyInitials(tenant.name)}
          </span>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: '1.4rem', letterSpacing: '-0.02em', margin: 0 }}>{tenant.name}</h1>
            <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
              {tenant.slug} · Company ID {tenant.id.slice(0, 12)}…
            </div>
          </div>
          <Badge tone={tone}>{tenant.status}</Badge>
          {activeSubscription && (
            <span style={{ fontSize: '0.78rem', color: '#475569' }}>
              Plan: <strong>{activeSubscription.plan.name}</strong> ({activeSubscription.billingCycle})
            </span>
          )}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/platform/tenants')}
            >
              <Icon name="campuses" size={14} /> Manage all tenants
            </Button>
            <Button size="sm" onClick={() => setTab('billing')}>
              Billing
            </Button>
          </div>
        </div>
      </div>

      {(actionError || notice) && (
        <div
          role="status"
          style={{
            borderRadius: 8,
            padding: '0.6rem 0.8rem',
            fontSize: '0.83rem',
            background: actionError ? '#fef2f2' : '#f0fdf4',
            border: `1px solid ${actionError ? '#fecaca' : '#bbf7d0'}`,
            color: actionError ? '#b91c1c' : '#15803d',
          }}
        >
          {actionError ?? notice}
        </div>
      )}

      <Tabs items={TABS} value={tab} onChange={setTab} />

      {tab === 'overview' && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Total users</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{usage.totalUsers}</div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Active users</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{usage.activeUsers}</div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Campuses</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{usage.campusCount}</div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Storage used</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{formatBytes(usage.storageUsedBytes)}</div>
            </Card>
            <Card>
              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Documents</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 700 }}>{usage.documentCount}</div>
            </Card>
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Company profile</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
              <Field label="Company name">{tenant.name}</Field>
              <Field label="Slug">{tenant.slug}</Field>
              <Field label="Billing email">{tenant.billingEmail}</Field>
              <Field label="Timezone">{tenant.timezone}</Field>
              <Field label="Data isolation">{tenant.dataIsolationMode ?? 'SHARED'}</Field>
              <Field label="Created">{formatDate(tenant.createdAt)}</Field>
              <Field label="Departments">{usage.departmentCount}</Field>
              <Field label="Students (role holders)">{usage.studentCount}</Field>
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Recent usage events</h2>
            {usage.recentUsageEvents.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No usage events recorded.</p>
            ) : (
              <ul style={{ fontSize: '0.83rem', margin: 0, paddingLeft: '1.1rem' }}>
                {usage.recentUsageEvents.slice(0, 8).map((event) => (
                  <li key={event.id} style={{ marginBottom: 4 }}>
                    <strong>{event.eventType}</strong> · {event.quantity} · {formatDate(event.occurredAt, true)}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      {tab === 'users' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 10 }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>Tenant users ({users.length})</h2>
            <span style={{ fontSize: '0.75rem', color: '#64748b' }}>Platform-side view · actions are audited</span>
          </div>
          {users.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No users found for this company.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '7px 8px' }}>User</th>
                    <th style={{ padding: '7px 8px' }}>Roles</th>
                    <th style={{ padding: '7px 8px' }}>Status</th>
                    <th style={{ padding: '7px 8px' }}>Last login</th>
                    <th style={{ padding: '7px 8px' }}>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '7px 8px' }}>
                        <div style={{ fontWeight: 600 }}>{user.fullName}</div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{user.email}</div>
                      </td>
                      <td style={{ padding: '7px 8px' }}>
                        {user.roles.length === 0 ? '—' : user.roles.map((role) => role.name).join(', ')}
                      </td>
                      <td style={{ padding: '7px 8px' }}>
                        <Badge tone={USER_STATUS_TONE[user.status]}>{user.status}</Badge>
                      </td>
                      <td style={{ padding: '7px 8px' }}>{formatDate(user.lastLoginAt, true)}</td>
                      <td style={{ padding: '7px 8px' }}>
                        {isAdmin && user.status !== 'DEACTIVATED' ? (
                          <select
                            aria-label={`Access for ${user.email}`}
                            value={user.status}
                            disabled={busy}
                            onChange={(event) => updateUserStatus(user.id, event.target.value as PlatformTenantUserDto['status'])}
                            style={{ padding: '0.25rem 0.4rem', borderRadius: 6, border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="SUSPENDED">Suspended</option>
                            <option value="DEACTIVATED">Deactivated</option>
                          </select>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'billing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Subscriptions</h2>
            {subscriptions.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No subscriptions yet.</p>
            ) : (
              subscriptions.map((subscription) => (
                <div key={subscription.id} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <strong>{subscription.plan.name}</strong> ({subscription.plan.code}) · {subscription.billingCycle}
                      <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                        {formatDate(subscription.currentPeriodStart)} – {formatDate(subscription.currentPeriodEnd)}
                      </div>
                    </div>
                    <Badge tone={subscription.status === 'ACTIVE' ? 'success' : 'warning'}>{subscription.status}</Badge>
                  </div>
                  {isAdmin && (
                    <Button variant="secondary" size="sm" onClick={() => generateInvoice(subscription.id)} style={{ marginTop: 8 }}>
                      Generate invoice
                    </Button>
                  )}
                  <div style={{ marginTop: 8 }}>
                    {invoices
                      .filter((invoice) => invoice.subscriptionId === subscription.id)
                      .map((invoice) => (
                        <div
                          key={invoice.id}
                          style={{ fontSize: '0.82rem', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '3px 0' }}
                        >
                          <span>
                            {invoice.invoiceNumber} — {(invoice.totalCents / 100).toFixed(2)} {invoice.currency} —{' '}
                            <strong>{invoice.status}</strong>
                          </span>
                          {isAdmin && invoice.status === 'ISSUED' && (
                            <>
                              <Button variant="secondary" size="sm" onClick={() => markPaid(invoice.id)}>
                                Mark paid
                              </Button>
                              <Button variant="ghost" size="sm" onClick={() => voidInvoice(invoice.id)}>
                                Void
                              </Button>
                            </>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              ))
            )}

            {isAdmin && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.82rem', color: '#374151' }}>Add subscription — plan</label>
                  <select
                    value={newPlanCode}
                    onChange={(event) => setNewPlanCode(event.target.value)}
                    style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
                  >
                    <option value="">Select a plan…</option>
                    {plans.map((plan) => (
                      <option key={plan.id} value={plan.code}>
                        {plan.name}
                      </option>
                    ))}
                  </select>
                </div>
                <Button disabled={!newPlanCode || busy} onClick={createSubscription}>
                  Subscribe (1 year, annual)
                </Button>
              </div>
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Invoices</h2>
            {invoices.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No invoices for this company.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '6px 8px' }}>Invoice</th>
                    <th style={{ padding: '6px 8px' }}>Issued</th>
                    <th style={{ padding: '6px 8px' }}>Due</th>
                    <th style={{ padding: '6px 8px' }}>Total</th>
                    <th style={{ padding: '6px 8px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px' }}>{invoice.invoiceNumber}</td>
                      <td style={{ padding: '6px 8px' }}>{formatDate(invoice.issuedAt)}</td>
                      <td style={{ padding: '6px 8px' }}>{formatDate(invoice.dueAt)}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {(invoice.totalCents / 100).toFixed(2)} {invoice.currency}
                      </td>
                      <td style={{ padding: '6px 8px' }}>{invoice.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      )}

      {tab === 'features' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Entitlements</h2>
            {entitlements.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No entitlements registered for this company.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                      <th style={{ padding: '6px 8px' }}>Key</th>
                      <th style={{ padding: '6px 8px' }}>Type</th>
                      <th style={{ padding: '6px 8px' }}>Value</th>
                      <th style={{ padding: '6px 8px' }}>Source</th>
                      <th style={{ padding: '6px 8px' }}>Reason</th>
                      {isAdmin && <th style={{ padding: '6px 8px' }} />}
                    </tr>
                  </thead>
                  <tbody>
                    {entitlements.map((entitlement) => (
                      <tr key={entitlement.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '6px 8px', fontFamily: 'monospace', fontSize: '0.78rem' }}>{entitlement.key}</td>
                        <td style={{ padding: '6px 8px' }}>{entitlement.type}</td>
                        <td style={{ padding: '6px 8px' }}>
                          {entitlement.type === 'BOOLEAN' ? (entitlement.boolValue ? 'Enabled' : 'Disabled') : entitlement.limitValue ?? '—'}
                        </td>
                        <td style={{ padding: '6px 8px' }}>
                          <Badge tone={entitlement.source === 'TENANT_OVERRIDE' ? 'info' : 'neutral'}>{entitlement.source}</Badge>
                        </td>
                        <td style={{ padding: '6px 8px', color: '#64748b' }}>{entitlement.reason ?? '—'}</td>
                        {isAdmin && (
                          <td style={{ padding: '6px 8px' }}>
                            {entitlement.source === 'TENANT_OVERRIDE' && (
                              <Button variant="ghost" size="sm" onClick={() => removeEntitlementOverride(entitlement.key)}>
                                Remove override
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {isAdmin && (
            <Card>
              <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Set an override</h2>
              <form onSubmit={setEntitlement} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, alignItems: 'end' }}>
                <Input label="Entitlement key" name="key" placeholder="e.g. ai.assistant" required />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <label style={{ fontSize: '0.82rem', color: '#374151' }}>Type</label>
                  <select name="type" defaultValue="BOOLEAN" style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
                    <option value="BOOLEAN">Boolean</option>
                    <option value="LIMIT">Limit</option>
                  </select>
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', paddingBottom: 8 }}>
                  <input type="checkbox" name="boolValue" /> Enable (boolean)
                </label>
                <Input label="Limit" name="limitValue" type="number" placeholder="number" />
                <Input label="Reason" name="reason" placeholder="why this exception exists" />
                <Button type="submit" disabled={busy}>
                  Save override
                </Button>
              </form>
            </Card>
          )}
        </div>
      )}

      {tab === 'activity' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>Recent activity</h2>
            <Button variant="secondary" size="sm" onClick={() => void loadActivity()}>
              Refresh
            </Button>
          </div>
          {activity.length === 0 ? (
            <p style={{ color: '#64748b', fontSize: '0.85rem' }}>No audit entries for this company yet.</p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '6px 8px' }}>Time</th>
                    <th style={{ padding: '6px 8px' }}>Module</th>
                    <th style={{ padding: '6px 8px' }}>Action</th>
                    <th style={{ padding: '6px 8px' }}>Actor</th>
                    <th style={{ padding: '6px 8px' }}>Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((entry) => (
                    <tr key={entry.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{formatDate(entry.createdAt, true)}</td>
                      <td style={{ padding: '6px 8px' }}>{entry.module}</td>
                      <td style={{ padding: '6px 8px' }}>{entry.action}</td>
                      <td style={{ padding: '6px 8px' }}>{entry.actorEmail ?? entry.actorType}</td>
                      <td style={{ padding: '6px 8px' }}>
                        {entry.entityType}
                        {entry.entityId ? ` #${entry.entityId.slice(0, 8)}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'settings' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Company profile</h2>
            <form onSubmit={saveSettings} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              <Input label="Company name" name="name" defaultValue={tenant.name} required disabled={!isAdmin} />
              <Input label="Billing email" name="billingEmail" type="email" defaultValue={tenant.billingEmail} required disabled={!isAdmin} />
              <Input label="Timezone" name="timezone" defaultValue={tenant.timezone} disabled={!isAdmin} />
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <Button type="submit" disabled={!isAdmin || busy}>
                  Save changes
                </Button>
              </div>
            </form>
            <p style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 8 }}>
              Slug and company ID are immutable. Changes here are recorded in the platform audit log.
            </p>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 4, color: '#b91c1c' }}>Lifecycle / danger zone</h2>
            <p style={{ fontSize: '0.83rem', color: '#64748b', marginTop: 0 }}>
              Suspending a company immediately blocks its tenant sign-ins. Deactivating is a stronger
              terminal-ish state used for offboarding.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button onClick={activate} disabled={!isAdmin || busy || tenant.status === 'ACTIVE'}>
                Activate
              </Button>
              <Button variant="secondary" onClick={suspend} disabled={!isAdmin || busy || tenant.status === 'SUSPENDED'}>
                Suspend
              </Button>
              <Button variant="danger" onClick={deactivate} disabled={!isAdmin || busy || tenant.status === 'CANCELED'}>
                Deactivate
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
