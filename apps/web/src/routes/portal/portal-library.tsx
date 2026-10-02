import React from 'react';
import { Card } from '@college-erp/ui';
import { Column, DataTable, PageShell, Stat, StatusBadge, fmtDate, money, usePortalData } from './portal-shared';

interface Loan {
  id: string;
  itemTitle: string;
  itemAuthor: string | null;
  itemCode: string | null;
  borrowedAt: string;
  dueDate: string | null;
  returnedAt: string | null;
  status: string;
  renewalCount: number;
  fineCents: number;
  copy: { book: { title: string; isbn: string | null } } | null;
}

interface Fine {
  id: string;
  type: string;
  amountCents: number;
  paidCents: number;
  status: string;
  reason: string | null;
  createdAt: string;
}

interface Reservation {
  id: string;
  status: string;
  reservedAt: string;
  holdUntil: string | null;
  book: { title: string };
}

interface LibraryResponse {
  member: { id: string; memberNumber: string; status: string; maxLoans: number | null } | null;
  loans: Loan[];
  fines: Fine[];
  reservations: Reservation[];
  summary: { activeLoans: number; pendingFines: number };
}

export function PortalLibraryPage() {
  const { data, error, loading } = usePortalData<LibraryResponse>('/student-portal/library');

  const loanColumns: Column<Loan>[] = [
    { label: 'Title', render: (row) => row.copy?.book.title ?? row.itemTitle },
    { label: 'Author', render: (row) => row.itemAuthor ?? '—' },
    { label: 'Code', render: (row) => row.itemCode ?? '—' },
    { label: 'Borrowed', render: (row) => fmtDate(row.borrowedAt) },
    { label: 'Due', render: (row) => fmtDate(row.dueDate) },
    { label: 'Returned', render: (row) => fmtDate(row.returnedAt) },
    { label: 'Renewals', render: (row) => row.renewalCount },
    { label: 'Fine', render: (row) => money(row.fineCents) },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
  ];

  const fineColumns: Column<Fine>[] = [
    { label: 'Type', render: (row) => row.type.replace(/_/g, ' ') },
    { label: 'Amount', render: (row) => money(row.amountCents) },
    { label: 'Paid', render: (row) => money(row.paidCents) },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Reason', render: (row) => row.reason ?? '—' },
    { label: 'Raised', render: (row) => fmtDate(row.createdAt) },
  ];

  const reservationColumns: Column<Reservation>[] = [
    { label: 'Title', render: (row) => row.book.title },
    { label: 'Reserved', render: (row) => fmtDate(row.reservedAt) },
    { label: 'Hold until', render: (row) => fmtDate(row.holdUntil) },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
  ];

  return (
    <PageShell
      title="Library"
      subtitle={data?.member ? `Member ${data.member.memberNumber}` : 'Your library circulation.'}
      error={error}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Active loans" value={data.summary.activeLoans} />
            <Stat label="Pending fines" value={data.summary.pendingFines} />
            <Stat label="Reservations" value={data.reservations.length} />
          </div>
          {!data.member && <Card>You are not registered as a library member yet.</Card>}
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Loans</h2>
            <DataTable columns={loanColumns} rows={data.loans} rowKey={(row) => row.id} empty="No loans on record." />
          </Card>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Fines</h2>
            <DataTable columns={fineColumns} rows={data.fines} rowKey={(row) => row.id} empty="No fines." />
          </Card>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Reservations</h2>
            <DataTable columns={reservationColumns} rows={data.reservations} rowKey={(row) => row.id} empty="No reservations." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
