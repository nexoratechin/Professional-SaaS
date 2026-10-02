import React, { useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import {
  Column,
  DataTable,
  PageShell,
  Stat,
  StatusBadge,
  apiFetch,
  fmtDate,
  money,
  usePortalData,
} from './portal-shared';

interface FeeLine {
  id: string;
  headCode: string;
  headName: string;
  amountCents: number;
  paidCents: number;
  waivedCents: number;
  lateFeeCents: number;
  outstandingCents: number;
  status: string;
  dueDate: string | null;
  isOverdue: boolean;
  term: { name: string } | null;
  demand: { id: string; demandNumber: string; status: string } | null;
}

interface FeesResponse {
  lines: FeeLine[];
  summary: { totalLines: number; outstandingCents: number; overdueCount: number };
}

const METHODS = ['UPI', 'CARD', 'BANK_TRANSFER', 'CASH', 'OFFLINE'];

function newIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto as Crypto | undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  return `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function PortalFeesPage() {
  const { data, error, loading, reload } = usePortalData<FeesResponse>('/student-portal/fees');
  const [targetLineId, setTargetLineId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('UPI');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const openLines = (data?.lines ?? []).filter((line) => line.outstandingCents > 0);

  const pay = async () => {
    const rupees = Number(amount);
    if (!Number.isFinite(rupees) || rupees <= 0) {
      setActionError('Enter a valid amount.');
      return;
    }
    setSubmitting(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch('/student-portal/payments', {
        method: 'POST',
        body: JSON.stringify({
          amountCents: Math.round(rupees * 100),
          method,
          studentFeeId: targetLineId || undefined,
          idempotencyKey: newIdempotencyKey(),
        }),
      });
      setNotice('Payment recorded successfully. A receipt has been added to your payments list.');
      setAmount('');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const columns: Column<FeeLine>[] = [
    { label: 'Head', render: (row) => `${row.headName} (${row.headCode})` },
    { label: 'Term', render: (row) => row.term?.name ?? '—' },
    { label: 'Demand', render: (row) => row.demand?.demandNumber ?? '—' },
    { label: 'Amount', render: (row) => money(row.amountCents) },
    { label: 'Paid', render: (row) => money(row.paidCents) },
    { label: 'Late fee', render: (row) => money(row.lateFeeCents) },
    { label: 'Outstanding', render: (row) => <strong>{money(row.outstandingCents)}</strong> },
    { label: 'Due', render: (row) => (row.isOverdue ? <span style={{ color: '#b91c1c' }}>{fmtDate(row.dueDate)}</span> : fmtDate(row.dueDate)) },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
  ];

  return (
    <PageShell title="Fees" subtitle="Demands, dues and outstanding balances." error={error ?? actionError} notice={notice} loading={loading}>
      {data && (
        <>
          <div className="sp-grid">
            <Stat label="Outstanding" value={money(data.summary.outstandingCents)} />
            <Stat label="Overdue items" value={data.summary.overdueCount} />
            <Stat label="Fee lines" value={data.summary.totalLines} />
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Make a payment</h2>
            {openLines.length === 0 ? (
              <p className="sp-muted">You have no outstanding fee lines.</p>
            ) : (
              <div className="sp-cards" style={{ alignItems: 'end' }}>
                <label className="sp-row">
                  <span className="sp-muted">Apply to</span>
                  <select
                    value={targetLineId}
                    onChange={(event) => setTargetLineId(event.target.value)}
                    style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
                  >
                    <option value="">All open fees (oldest due first)</option>
                    {openLines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {line.headName} — {money(line.outstandingCents)}
                      </option>
                    ))}
                  </select>
                </label>
                <Input label="Amount (₹)" name="amount" type="number" min="1" value={amount} onChange={(event) => setAmount(event.target.value)} />
                <label className="sp-row">
                  <span className="sp-muted">Method</span>
                  <select value={method} onChange={(event) => setMethod(event.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}>
                    {METHODS.map((value) => (
                      <option key={value} value={value}>
                        {value.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                <Button onClick={pay} disabled={submitting}>
                  {submitting ? 'Processing…' : 'Pay now'}
                </Button>
              </div>
            )}
            <p className="sp-muted" style={{ marginTop: 8 }}>
              This records the payment against your fee ledger immediately. Online gateway capture is
              provisioned at the institution level; until then payments reconcile as recorded.
            </p>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Fee ledger</h2>
            <DataTable columns={columns} rows={data.lines} rowKey={(row) => row.id} empty="No fee demands yet." />
          </Card>
        </>
      )}
    </PageShell>
  );
}
