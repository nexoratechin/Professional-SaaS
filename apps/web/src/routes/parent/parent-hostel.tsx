import React from 'react';
import { Card } from '@college-erp/ui';
import { Column, DataTable, PageShell, Stat, StatusBadge, fmtDate, money } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface HostelBooking {
  id: string;
  hostelName: string;
  roomNumber: string;
  bedNumber: string | null;
  allocationDate: string | null;
  checkInDate: string | null;
  checkOutDate: string | null;
  status: string;
  monthlyRentCents: number | null;
  hostel: { name: string; code: string } | null;
  room: { code: string; name: string | null; sharing: string } | null;
  bed: { code: string } | null;
  feeCharges: Array<{ id: string; headName: string; amountCents: number; paidCents: number; status: string }>;
}

interface HostelComplaint {
  id: string;
  category: string;
  priority: string;
  status: string;
  subject: string;
  description: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface HostelResponse {
  bookings: HostelBooking[];
  complaints: HostelComplaint[];
  summary: { activeBookings: number; openComplaints: number };
}

export function ParentHostelPage() {
  const { data, error, loading } = useParentData<HostelResponse>('/parent-portal/hostel');

  const bookingColumns: Column<HostelBooking>[] = [
    { label: 'Hostel', render: (row) => row.hostel?.name ?? row.hostelName },
    { label: 'Room / Bed', render: (row) => `${row.room?.code ?? row.roomNumber} / ${row.bed?.code ?? row.bedNumber ?? '—'}` },
    { label: 'Allocated', render: (row) => fmtDate(row.allocationDate) },
    { label: 'Checked in', render: (row) => fmtDate(row.checkInDate) },
    { label: 'Checked out', render: (row) => fmtDate(row.checkOutDate) },
    { label: 'Monthly rent', render: (row) => money(row.monthlyRentCents) },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
  ];

  const complaintColumns: Column<HostelComplaint>[] = [
    { label: 'Subject', render: (row) => row.subject },
    { label: 'Category', render: (row) => row.category.replace(/_/g, ' ') },
    { label: 'Priority', render: (row) => <StatusBadge value={row.priority} /> },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Raised', render: (row) => fmtDate(row.createdAt) },
    { label: 'Resolved', render: (row) => fmtDate(row.resolvedAt) },
  ];

  return (
    <PageShell title="Hostel" subtitle="Allocation, rent charges and complaints." error={error} loading={loading}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Active bookings" value={data.summary.activeBookings} />
            <Stat label="Open complaints" value={data.summary.openComplaints} />
          </div>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Bookings</h2>
            <DataTable columns={bookingColumns} rows={data.bookings} rowKey={(row) => row.id} empty="No hostel booking on record." />
          </Card>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Rent charges</h2>
            {data.bookings.flatMap((booking) => booking.feeCharges).length === 0 ? (
              <p className="sp-muted">No hostel charges raised.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {data.bookings.flatMap((booking) =>
                  booking.feeCharges.map((charge) => (
                    <li key={charge.id}>
                      {charge.headName}: {money(charge.amountCents)} ({charge.status}, paid {money(charge.paidCents)})
                    </li>
                  )),
                )}
              </ul>
            )}
          </Card>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Complaints</h2>
            <DataTable columns={complaintColumns} rows={data.complaints} rowKey={(row) => row.id} empty="No complaints filed." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
