import React from 'react';
import { Card } from '@college-erp/ui';
import { Column, DataTable, PageShell, Stat, StatusBadge, fmtDate, money } from '../portal/portal-shared';
import { useParentData } from './parent-context';

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

export function ParentFeesPage() {
  const { data, error, loading } = useParentData<FeesResponse>('/parent-portal/fees');

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
    <PageShell title="Fees" subtitle="Your child's demands, dues and outstanding balances." error={error} loading={loading}>
      {data && (
        <>
          <div className="sp-grid">
            <Stat label="Outstanding" value={money(data.summary.outstandingCents)} />
            <Stat label="Overdue items" value={data.summary.overdueCount} />
            <Stat label="Fee lines" value={data.summary.totalLines} />
          </div>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Fee ledger</h2>
            <DataTable columns={columns} rows={data.lines} rowKey={(row) => row.id} empty="No fee demands yet." />
          </Card>
        </>
      )}
    </PageShell>
  );
}
