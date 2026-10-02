import React, { useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { DataTable, PageShell, Stat, StatusBadge, apiFetch, fmtDate, usePortalData, type Column } from './faculty-shared';

interface LeaveType {
  id: string;
  code: string;
  name: string;
  category: string;
}

interface LeaveBalance {
  id: string;
  year: number;
  openingBalance: number;
  creditedDays: number;
  availedDays: number;
  adjustedDays: number;
  closingBalance: number | null;
  leaveType?: { id: string; code: string; name: string } | null;
}

interface LeaveApplication {
  id: string;
  fromDate: string;
  toDate: string;
  durationDays: number;
  halfDayOption: string | null;
  reason: string | null;
  status: string;
  decisionRemarks: string | null;
  leaveType: { id: string; code: string; name: string };
}

interface LeaveResponse {
  types: LeaveType[];
  balances: LeaveBalance[];
  applications: LeaveApplication[];
  total: number;
  pending: number;
  approved: number;
  year: number;
}

export function FacultyLeavePage() {
  const { data, error, loading, reload } = usePortalData<LeaveResponse>('/faculty-portal/leave?take=100');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [toDate, setToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [halfDayOption, setHalfDayOption] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = async () => {
    setActionError(null);
    setNotice(null);
    if (!leaveTypeId) {
      setActionError('Select a leave type.');
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch('/faculty-portal/leave', {
        method: 'POST',
        body: JSON.stringify({
          leaveTypeId,
          fromDate,
          toDate,
          halfDayOption: halfDayOption || undefined,
          reason: reason || undefined,
        }),
      });
      setNotice('Leave application submitted.');
      setReason('');
      setHalfDayOption('');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to submit leave application.');
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async (id: string) => {
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch(`/faculty-portal/leave/${id}/cancel`, { method: 'POST' });
      setNotice('Leave application cancelled.');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to cancel leave application.');
    }
  };

  const columns: Column<LeaveApplication>[] = [
    { label: 'Type', render: (row) => row.leaveType.name },
    { label: 'From', render: (row) => fmtDate(row.fromDate) },
    { label: 'To', render: (row) => fmtDate(row.toDate) },
    { label: 'Days', render: (row) => row.durationDays },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Remarks', render: (row) => row.decisionRemarks ?? row.reason ?? '—' },
    {
      label: '',
      render: (row) =>
        row.status === 'PENDING' ? (
          <Button variant="secondary" onClick={() => cancel(row.id)}>
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <PageShell
      title="Leave"
      subtitle="Your balances, applications and self-service leave requests."
      error={error ?? actionError}
      notice={notice}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Pending" value={data.pending} />
            <Stat label="Approved" value={data.approved} />
            <Stat label="Applications" value={data.total} />
            <Stat label="Year" value={data.year} />
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Balances</h2>
            {data.balances.length === 0 ? (
              <p className="sp-muted">No leave balances on record for {data.year}.</p>
            ) : (
              <DataTable
                columns={[
                  { label: 'Type', render: (row: LeaveBalance) => row.leaveType?.name ?? '—' },
                  { label: 'Opening', render: (row: LeaveBalance) => row.openingBalance },
                  { label: 'Credited', render: (row: LeaveBalance) => row.creditedDays },
                  { label: 'Availed', render: (row: LeaveBalance) => row.availedDays },
                  { label: 'Adjusted', render: (row: LeaveBalance) => row.adjustedDays },
                  { label: 'Closing', render: (row: LeaveBalance) => row.closingBalance ?? '—' },
                ]}
                rows={data.balances}
                rowKey={(row) => row.id}
                empty="No leave balances."
              />
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Apply for leave</h2>
            <div className="sp-cards" style={{ alignItems: 'end' }}>
              <label className="sp-row">
                <span className="sp-muted">Leave type</span>
                <select
                  value={leaveTypeId}
                  onChange={(event) => setLeaveTypeId(event.target.value)}
                  style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
                >
                  <option value="">Select type</option>
                  {data.types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.code} — {type.name}
                    </option>
                  ))}
                </select>
              </label>
              <Input label="From" name="fromDate" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
              <Input label="To" name="toDate" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
              <label className="sp-row">
                <span className="sp-muted">Half day (optional)</span>
                <select
                  value={halfDayOption}
                  onChange={(event) => setHalfDayOption(event.target.value)}
                  style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
                >
                  <option value="">Full day</option>
                  <option value="FIRST_HALF">First half</option>
                  <option value="SECOND_HALF">Second half</option>
                </select>
              </label>
              <Input label="Reason" name="reason" value={reason} onChange={(event) => setReason(event.target.value)} />
              <Button onClick={apply} disabled={submitting || data.types.length === 0}>
                {submitting ? 'Submitting…' : 'Apply'}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>My applications</h2>
            <DataTable columns={columns} rows={data.applications} rowKey={(row) => row.id} empty="No leave applications yet." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
