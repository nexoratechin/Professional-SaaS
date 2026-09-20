import React, { useCallback, useEffect, useState } from 'react';
import type { PlanChangePreviewDto, TenantBillingOverviewDto } from '@college-erp/types';
import { Button, Card } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';

const BILLING_VIEW = 'tenant.billing.view';
const BILLING_UPDATE = 'billing.update';

function formatCents(cents: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(cents / 100);
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '—';
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    ACTIVE: '#15803d',
    TRIALING: '#1d4ed8',
    PAST_DUE: '#b45309',
    SUSPENDED: '#b91c1c',
    ISSUED: '#1d4ed8',
    OVERDUE: '#b45309',
    PAID: '#15803d',
    VOID: '#6b7280',
    PENDING: '#6b7280',
    SUCCEEDED: '#15803d',
    FAILED: '#b91c1c',
    REFUNDED: '#6b7280',
  };
  return <span style={{ color: colors[status] ?? '#111827', fontWeight: 600 }}>{status}</span>;
}

/** Tenant self-service billing: current plan, plan change with prorated cost preview,
 *  cancel-at-period-end, and the invoice/payment history with PDF downloads. All data comes from
 *  the tenant's own JWT-scoped endpoints; the server enforces TENANT_BILLING_VIEW/BILLING_UPDATE,
 *  so this page's permission check is purely cosmetic navigation. */
export function BillingPage() {
  const { permissions } = useAuth();
  const [overview, setOverview] = useState<TenantBillingOverviewDto | null>(null);
  const [preview, setPreview] = useState<PlanChangePreviewDto | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<TenantBillingOverviewDto>('/tenant/billing');
      setOverview(data);
      setPreview(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedPlan) return;
    void apiFetch<PlanChangePreviewDto>('/tenant/subscription/preview-change', {
      method: 'POST',
      body: JSON.stringify({ planCode: selectedPlan }),
    })
      .then(setPreview)
      .catch((err) => setError(err instanceof Error ? err.message : 'Preview failed.'));
  }, [selectedPlan]);

  const canView = permissions.includes(BILLING_VIEW);
  const canUpdate = permissions.includes(BILLING_UPDATE);

  const run = async (action: () => Promise<unknown>, successMessage?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      if (successMessage) setNotice(successMessage);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  const changePlan = () =>
    run(
      () =>
        apiFetch('/tenant/subscription/change-plan', {
          method: 'POST',
          body: JSON.stringify({ planCode: selectedPlan }),
        }),
      'Plan changed — a prorated adjustment invoice has been issued.',
    );

  const toggleCancel = () => {
    if (!overview?.subscription) return;
    const cancelAtPeriodEnd = !overview.subscription.cancelAtPeriodEnd;
    run(
      () =>
        apiFetch('/tenant/subscription/cancel-at-period-end', {
          method: 'POST',
          body: JSON.stringify({ cancelAtPeriodEnd }),
        }),
      cancelAtPeriodEnd ? 'Cancellation scheduled at the end of the current period.' : 'Reinstated — the plan will auto-renew.',
    );
  };

  const downloadPdf = async (invoiceId: string) => {
    try {
      const { url } = await apiFetch<{ url: string; invoiceNumber: string }>(`/tenant/invoices/${invoiceId}/pdf`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF generation failed.');
    }
  };

  if (error) {
    return <p style={{ color: '#b91c1c' }}>{error}</p>;
  }

  return (
    <div style={{ maxWidth: 820, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Subscription & Billing</h1>

      {!canView && (
        <Card>
          <p style={{ color: '#9ca3af' }}>You don't have billing visibility for this tenant.</p>
        </Card>
      )}

      {canView && !overview && <p>Loading…</p>}

      {canView && overview && (
        <>
          {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>
              Current plan{' '}
              {overview.subscription && <StatusBadge status={overview.subscription.status} />}
            </h2>
            {!overview.subscription ? (
              <p>No active subscription for this tenant.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p>
                  <strong>{overview.subscription.plan.name}</strong> ({overview.subscription.plan.code}) ·{' '}
                  {formatCents(overview.subscription.plan.priceCents ?? 0, overview.subscription.plan.currency)} /{' '}
                  {overview.subscription.billingCycle.toLowerCase()}
                </p>
                <p>
                  Period: {formatDate(overview.subscription.currentPeriodStart)} →{' '}
                  {formatDate(overview.subscription.currentPeriodEnd)}
                </p>
                <p>
                  Renewal:{' '}
                  {overview.subscription.cancelAtPeriodEnd ? (
                    <strong style={{ color: '#b91c1c' }}>canceled at period end</strong>
                  ) : (
                    'auto-renews'
                  )}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <Button variant="secondary" onClick={toggleCancel} disabled={busy}>
                    {overview.subscription.cancelAtPeriodEnd ? 'Reinstate' : 'Cancel at period end'}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {canUpdate && overview.subscription && (
            <Card>
              <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Change plan (prorated)</h2>
              <label style={{ fontSize: '0.85rem' }}>
                Target plan
                <select
                  value={selectedPlan}
                  onChange={(e) => setSelectedPlan(e.target.value)}
                  style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem' }}
                >
                  <option value="">Select a plan…</option>
                  {overview.plans.map((plan) => (
                    <option key={plan.id} value={plan.code}>
                      {plan.name} — {formatCents(plan.priceCents ?? 0)}
                    </option>
                  ))}
                </select>
              </label>

              {preview && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <p>
                    {preview.direction} from <strong>{preview.currentPlan.name}</strong> to{' '}
                    <strong>{preview.targetPlan.name}</strong>
                  </p>
                  {preview.prorationEnabled ? (
                    <>
                      <p>Unused credit for current period: {formatCents(preview.remainingCreditCents)}</p>
                      <p>Prorated charge for current period: {formatCents(preview.proratedChargeCents)}</p>
                      <p>
                        Tax ({((overview.config.taxRateBps / 100)).toFixed(2)}%): {formatCents(preview.taxCents)}
                      </p>
                      <p style={{ fontWeight: 700 }}>Net due now: {formatCents(preview.totalCents)}</p>
                    </>
                  ) : (
                    <p>Proration is disabled — the new plan price applies at the next renewal.</p>
                  )}
                  <div style={{ marginTop: 8 }}>
                    <Button onClick={changePlan} disabled={busy}>
                      Confirm plan change
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          )}

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Invoices</h2>
            {overview.invoices.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No invoices yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                    <th>Number</th>
                    <th>Status</th>
                    <th>Period</th>
                    <th>Due</th>
                    <th align="right">Total</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overview.invoices.map((invoice) => (
                    <tr key={invoice.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td>{invoice.invoiceNumber}</td>
                      <td>
                        <StatusBadge status={invoice.status} />
                      </td>
                      <td>
                        {formatDate(invoice.periodStart)} → {formatDate(invoice.periodEnd)}
                      </td>
                      <td>{formatDate(invoice.dueAt)}</td>
                      <td align="right">{formatCents(invoice.totalCents, invoice.currency)}</td>
                      <td>
                        <Button variant="secondary" onClick={() => void downloadPdf(invoice.id)} disabled={busy}>
                          PDF
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Payment history</h2>
            {overview.payments.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No payments recorded yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#6b7280' }}>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Status</th>
                    <th>Reference</th>
                    <th align="right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.payments.map((payment) => (
                    <tr key={payment.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                      <td>{formatDate(payment.createdAt)}</td>
                      <td>{payment.method}</td>
                      <td>
                        <StatusBadge status={payment.status} />
                      </td>
                      <td>{payment.gatewayReference ?? '—'}</td>
                      <td align="right">{formatCents(payment.amountCents, payment.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      )}
    </div>
  );
}