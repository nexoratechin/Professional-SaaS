import React from 'react';
import { Card } from '@college-erp/ui';
import { Column, DataTable, PageShell, StatusBadge, fmtDate, money, usePortalData } from './portal-shared';

interface Payment {
  id: string;
  receiptNumber: string;
  amountCents: number;
  currency: string;
  paymentDate: string;
  method: string;
  status: string;
  referenceNumber: string | null;
  remarks: string | null;
  studentFee: { id: string; headName: string; headCode: string } | null;
  allocations: Array<{ id: string; amountCents: number; line: { id: string; headName: string; headCode: string } }>;
}

interface PaymentsResponse {
  payments: Payment[];
}

export function PortalPaymentsPage() {
  const { data, error, loading } = usePortalData<PaymentsResponse>('/student-portal/payments');

  const columns: Column<Payment>[] = [
    { label: 'Receipt', render: (row) => row.receiptNumber },
    { label: 'Date', render: (row) => fmtDate(row.paymentDate) },
    { label: 'Amount', render: (row) => money(row.amountCents) },
    { label: 'Method', render: (row) => row.method.replace(/_/g, ' ') },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    {
      label: 'Applied to',
      render: (row) =>
        row.allocations.length
          ? row.allocations.map((allocation) => `${allocation.line.headName} (${money(allocation.amountCents)})`).join(', ')
          : row.studentFee?.headName ?? 'General',
    },
    { label: 'Reference', render: (row) => row.referenceNumber ?? '—' },
  ];

  return (
    <PageShell title="Payments" subtitle="Receipts and how they were applied to your fees." error={error} loading={loading}>
      {data && (
        <Card>
          <DataTable columns={columns} rows={data.payments} rowKey={(row) => row.id} empty="No payments recorded yet." />
        </Card>
      )}
    </PageShell>
  );
}
