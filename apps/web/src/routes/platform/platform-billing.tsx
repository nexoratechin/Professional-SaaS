import React, { useCallback, useEffect, useState } from 'react';
import type { BillingConfigDto, BillingSummaryDto, InvoiceDto, PaymentDto } from '@college-erp/types';
import { Button, Card, Input } from '@college-erp/ui';
import { platformApiFetch, platformApiFetchPaged } from '../../lib/platform-http';

function formatCents(cents: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(cents / 100);
}

function shortDate(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '—';
}

function Badge({ status }: { status: string }) {
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

/** Platform billing console: headline revenue/outstanding numbers, SaaS-wide tax/invoice
 *  configuration, the cross-tenant invoice ledger (mark-paid / void / PDF / record a payment),
 *  and the payment journal. Same PLATFORM_ADMIN-gated API surface as the rest of the platform
 *  area — no tenant context is ever attached to these requests. */
export function PlatformBillingPage() {
  const [summary, setSummary] = useState<BillingSummaryDto | null>(null);
  const [config, setConfig] = useState<BillingConfigDto | null>(null);
  const [invoices, setInvoices] = useState<InvoiceDto[]>([]);
  const [payments, setPayments] = useState<PaymentDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [configForm, setConfigForm] = useState<BillingConfigDto | null>(null);
  const [paymentForm, setPaymentForm] = useState<Record<string, { method: string; status: string }>>({});

  const load = useCallback(async () => {
    try {
      const [summaryRes, configRes, invoicesRes, paymentsRes] = await Promise.all([
        platformApiFetch<BillingSummaryDto>('/billing/summary'),
        platformApiFetch<BillingConfigDto>('/billing/config'),
        platformApiFetchPaged<InvoiceDto[]>('/invoices?take=50'),
        platformApiFetchPaged<PaymentDto[]>('/payments?take=50'),
      ]);
      setSummary(summaryRes);
      setConfig(configRes);
      setConfigForm(configRes);
      setInvoices(invoicesRes.data);
      setPayments(paymentsRes.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing data.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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

  const saveConfig = () =>
    run(
      () =>
        platformApiFetch('/billing/config', {
          method: 'PUT',
          body: JSON.stringify({
            taxName: configForm?.taxName,
            taxRateBps: Number(configForm?.taxRateBps),
            invoicePrefix: configForm?.invoicePrefix,
            gracePeriodDays: Number(configForm?.gracePeriodDays),
            renewalDueDays: Number(configForm?.renewalDueDays),
            retryIntervalDays: Number(configForm?.retryIntervalDays),
            prorationEnabled: configForm?.prorationEnabled,
          }),
        }),
      'Billing configuration saved.',
    );

  const markPaid = (id: string) => run(() => platformApiFetch(`/invoices/${id}/mark-paid`, { method: 'POST' }));
  const voidInvoice = (id: string) => run(() => platformApiFetch(`/invoices/${id}/void`, { method: 'POST' }));
  const downloadPdf = async (id: string) => {
    try {
      const { url } = await platformApiFetch<{ url: string }>(`/invoices/${id}/pdf`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PDF generation failed.');
    }
  };

  const recordPayment = (invoiceId: string) => {
    const form = paymentForm[invoiceId] ?? { method: 'OFFLINE', status: 'SUCCEEDED' };
    return run(
      () =>
        platformApiFetch(`/invoices/${invoiceId}/payments`, {
          method: 'POST',
          body: JSON.stringify(form),
        }),
      'Payment recorded.',
    );
  };

  if (error) {
    return <p style={{ color: '#b91c1c' }}>{error}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Billing</h1>
        {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
      </div>

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
          <Card>
            <strong>Billed</strong>
            <p>{formatCents(summary.totalBilledCents)}</p>
          </Card>
          <Card>
            <strong>Collected</strong>
            <p>{formatCents(summary.totalCollectedCents)}</p>
          </Card>
          <Card>
            <strong>Outstanding</strong>
            <p style={{ color: summary.totalOutstandingCents > 0 ? '#b91c1c' : '#15803d' }}>
              {formatCents(summary.totalOutstandingCents)}
            </p>
          </Card>
          <Card>
            <strong>Invoices</strong>
            <p>{Object.entries(summary.invoiceCounts).map(([s, n]) => `${s}: ${n}`).join(', ')}</p>
          </Card>
          <Card>
            <strong>Subscriptions</strong>
            <p>
              {summary.activeSubscriptions} active · {summary.trials} trial · {summary.pastDueSubscriptions} past due
            </p>
          </Card>
        </div>
      )}

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Billing configuration</h2>
        {configForm && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Input
              label="Tax name"
              value={configForm.taxName}
              onChange={(e) => setConfigForm({ ...configForm, taxName: e.target.value })}
            />
            <Input
              label="Tax rate (bps)"
              type="number"
              value={String(configForm.taxRateBps)}
              onChange={(e) => setConfigForm({ ...configForm, taxRateBps: Number(e.target.value) })}
            />
            <Input
              label="Invoice prefix"
              value={configForm.invoicePrefix}
              onChange={(e) => setConfigForm({ ...configForm, invoicePrefix: e.target.value })}
            />
            <Input
              label="Grace period (days)"
              type="number"
              value={String(configForm.gracePeriodDays)}
              onChange={(e) => setConfigForm({ ...configForm, gracePeriodDays: Number(e.target.value) })}
            />
            <Input
              label="Renewal due in (days)"
              type="number"
              value={String(configForm.renewalDueDays)}
              onChange={(e) => setConfigForm({ ...configForm, renewalDueDays: Number(e.target.value) })}
            />
            <Input
              label="Retry interval (days)"
              type="number"
              value={String(configForm.retryIntervalDays)}
              onChange={(e) => setConfigForm({ ...configForm, retryIntervalDays: Number(e.target.value) })}
            />
          </div>
        )}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 12 }}>
          <label style={{ fontSize: '0.85rem' }}>
            Proration enabled
            <input
              type="checkbox"
              checked={configForm?.prorationEnabled ?? true}
              onChange={(e) => setConfigForm((prev) => (prev ? { ...prev, prorationEnabled: e.target.checked } : prev))}
              style={{ marginLeft: 6 }}
            />
          </label>
          <Button onClick={saveConfig} disabled={busy}>
            Save configuration
          </Button>
          {config && <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>Next invoice no: {config.nextInvoiceSequence}</span>}
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Invoices</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#6b7280' }}>
              <th>Number</th>
              <th>Tenant</th>
              <th>Status</th>
              <th>Issued</th>
              <th>Due</th>
              <th align="right">Total</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td>{invoice.invoiceNumber}</td>
                <td>{invoice.tenantId.slice(0, 8)}…</td>
                <td>
                  <Badge status={invoice.status} />
                </td>
                <td>{shortDate(invoice.issuedAt)}</td>
                <td>{shortDate(invoice.dueAt)}</td>
                <td align="right">{formatCents(invoice.totalCents, invoice.currency)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {invoice.status === 'ISSUED' || invoice.status === 'OVERDUE' ? (
                      <>
                        <Button variant="secondary" onClick={() => void markPaid(invoice.id)} disabled={busy}>
                          Mark paid
                        </Button>
                        <select
                          value={paymentForm[invoice.id]?.status ?? 'SUCCEEDED'}
                          onChange={(e) =>
                            setPaymentForm((prev) => ({ ...prev, [invoice.id]: { ...(prev[invoice.id] ?? { method: 'OFFLINE' }), status: e.target.value } }))
                          }
                          style={{ fontSize: '0.8rem' }}
                        >
                          <option value="PENDING">PENDING</option>
                          <option value="SUCCEEDED">SUCCEEDED</option>
                          <option value="FAILED">FAILED</option>
                        </select>
                        <Button variant="secondary" onClick={() => void recordPayment(invoice.id)} disabled={busy}>
                          Record
                        </Button>
                      </>
                    ) : null}
                    {(invoice.status === 'ISSUED' || invoice.status === 'OVERDUE' || invoice.status === 'DRAFT') && (
                      <Button variant="secondary" onClick={() => void voidInvoice(invoice.id)} disabled={busy}>
                        Void
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => void downloadPdf(invoice.id)} disabled={busy}>
                      PDF
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {invoices.length === 0 && <p style={{ color: '#9ca3af' }}>No invoices yet.</p>}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Payments</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', color: '#6b7280' }}>
              <th>Date</th>
              <th>Invoice</th>
              <th>Tenant</th>
              <th>Method</th>
              <th>Status</th>
              <th>Reference</th>
              <th align="right">Amount</th>
            </tr>
          </thead>
          <tbody>
            {payments.map((payment) => (
              <tr key={payment.id} style={{ borderTop: '1px solid #e5e7eb' }}>
                <td>{shortDate(payment.createdAt)}</td>
                <td>{payment.invoiceId.slice(0, 8)}…</td>
                <td>{payment.tenantId.slice(0, 8)}…</td>
                <td>{payment.method}</td>
                <td>
                  <Badge status={payment.status} />
                </td>
                <td>{payment.gatewayReference ?? '—'}</td>
                <td align="right">{formatCents(payment.amountCents, payment.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {payments.length === 0 && <p style={{ color: '#9ca3af' }}>No payments recorded yet.</p>}
      </Card>
    </div>
  );
}