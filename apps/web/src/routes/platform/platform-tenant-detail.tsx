import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { PlatformTenantDto, TenantUsageDto } from '@college-erp/types';
import { Button, Card } from '@college-erp/ui';
import { platformApiFetch } from '../../lib/platform-http';

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
}

interface PlanDto {
  id: string;
  code: string;
  name: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(1)} ${units[exponent]}`;
}

export function PlatformTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tenant, setTenant] = useState<PlatformTenantDto | null>(null);
  const [usage, setUsage] = useState<TenantUsageDto | null>(null);
  const [subscriptions, setSubscriptions] = useState<SubscriptionDto[]>([]);
  const [invoices, setInvoices] = useState<Record<string, InvoiceDto[]>>({});
  const [plans, setPlans] = useState<PlanDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [newPlanCode, setNewPlanCode] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [tenantRes, usageRes, subscriptionsRes, plansRes] = await Promise.all([
        platformApiFetch<PlatformTenantDto>(`/tenants/${id}`),
        platformApiFetch<TenantUsageDto>(`/tenants/${id}/usage`),
        platformApiFetch<SubscriptionDto[]>(`/tenants/${id}/subscriptions`),
        platformApiFetch<PlanDto[]>('/plans'),
      ]);
      setTenant(tenantRes);
      setUsage(usageRes);
      setSubscriptions(subscriptionsRes);
      setPlans(plansRes);

      const invoicesBySub: Record<string, InvoiceDto[]> = {};
      const tenantInvoices = await platformApiFetch<InvoiceDto[]>(`/tenants/${id}/invoices`);
      for (const invoice of tenantInvoices as Array<InvoiceDto & { subscriptionId: string | null }>) {
        const key = invoice.subscriptionId ?? 'none';
        invoicesBySub[key] = [...(invoicesBySub[key] ?? []), invoice];
      }
      setInvoices(invoicesBySub);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tenant.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (action: () => Promise<unknown>) => {
    setActionError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const activate = () => runAction(() => platformApiFetch(`/tenants/${id}/activate`, { method: 'POST', body: '{}' }));
  const suspend = () => runAction(() => platformApiFetch(`/tenants/${id}/suspend`, { method: 'POST', body: '{}' }));
  const deactivate = () => runAction(() => platformApiFetch(`/tenants/${id}/deactivate`, { method: 'POST', body: '{}' }));

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
    });

  const generateInvoice = (subscriptionId: string) =>
    runAction(() => platformApiFetch(`/subscriptions/${subscriptionId}/invoices`, { method: 'POST', body: '{}' }));

  const markPaid = (invoiceId: string) => runAction(() => platformApiFetch(`/invoices/${invoiceId}/mark-paid`, { method: 'POST' }));
  const voidInvoice = (invoiceId: string) => runAction(() => platformApiFetch(`/invoices/${invoiceId}/void`, { method: 'POST' }));

  if (error) {
    return <p style={{ color: '#b91c1c' }}>{error}</p>;
  }
  if (!tenant || !usage) {
    return <p>Loading…</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>{tenant.name}</h1>
      {actionError && <p style={{ color: '#b91c1c' }}>{actionError}</p>}

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Tenant</h2>
        <p>Slug: {tenant.slug}</p>
        <p>Status: {tenant.status}</p>
        <p>Billing email: {tenant.billingEmail}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <Button onClick={activate}>Activate</Button>
          <Button variant="secondary" onClick={suspend}>
            Suspend
          </Button>
          <Button variant="secondary" onClick={deactivate}>
            Deactivate
          </Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Usage</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
          <div>Total users: {usage.totalUsers}</div>
          <div>Active users: {usage.activeUsers}</div>
          <div>Students (proxy): {usage.studentCount}</div>
          <div>Storage used: {formatBytes(usage.storageUsedBytes)}</div>
          <div>Documents: {usage.documentCount}</div>
          <div>Campuses: {usage.campusCount}</div>
          <div>Departments: {usage.departmentCount}</div>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Subscriptions</h2>
        {subscriptions.length === 0 ? (
          <p>No subscriptions yet.</p>
        ) : (
          subscriptions.map((subscription) => (
            <div key={subscription.id} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f3f4f6' }}>
              <p>
                {subscription.plan.name} ({subscription.plan.code}) — {subscription.status} — {subscription.billingCycle}
              </p>
              <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                {new Date(subscription.currentPeriodStart).toLocaleDateString()} –{' '}
                {new Date(subscription.currentPeriodEnd).toLocaleDateString()}
              </p>
              <Button variant="secondary" onClick={() => generateInvoice(subscription.id)}>
                Generate invoice
              </Button>
              <div style={{ marginTop: 8 }}>
                {(invoices[subscription.id] ?? []).map((invoice) => (
                  <div key={invoice.id} style={{ fontSize: '0.85rem', display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span>
                      {invoice.invoiceNumber} — {(invoice.totalCents / 100).toFixed(2)} {invoice.currency} — {invoice.status}
                    </span>
                    {invoice.status === 'ISSUED' && (
                      <>
                        <Button variant="secondary" onClick={() => markPaid(invoice.id)}>
                          Mark paid
                        </Button>
                        <Button variant="secondary" onClick={() => voidInvoice(invoice.id)}>
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

        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Add subscription — plan code</label>
            <select
              value={newPlanCode}
              onChange={(e) => setNewPlanCode(e.target.value)}
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
          <Button disabled={!newPlanCode} onClick={createSubscription}>
            Subscribe (1 year, annual)
          </Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Recent usage events</h2>
        {usage.recentUsageEvents.length === 0 ? (
          <p>No usage events recorded.</p>
        ) : (
          <ul style={{ fontSize: '0.85rem' }}>
            {usage.recentUsageEvents.map((event) => (
              <li key={event.id}>
                {event.eventType}: {event.quantity} at {new Date(event.occurredAt).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
