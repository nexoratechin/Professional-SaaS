import React, { useState } from 'react';
import { Button, Card } from '@college-erp/ui';
import { Column, DataTable, PageShell, Stat, StatusBadge, fmtDate } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface AttendanceRow {
  id: string;
  date: string;
  attendanceType: string;
  subjectCode: string | null;
  subjectName: string | null;
  status: string;
  markMethod: string;
  remarks: string | null;
  session: { id: string; title: string | null; subjectName: string | null } | null;
}

interface AttendanceResponse {
  rows: AttendanceRow[];
  total: number;
  summary: { total: number; present: number; absent: number; late: number; leave: number; percentage: number | null };
}

const STATUS_OPTIONS = ['', 'PRESENT', 'ABSENT', 'LATE', 'LEAVE'];

export function ParentAttendancePage() {
  const [status, setStatus] = useState('');
  const [skip, setSkip] = useState(0);
  const take = 50;

  const { data, error, loading } = useParentData<AttendanceResponse>('/parent-portal/attendance', {
    status: status || undefined,
    skip,
    take,
  });

  const columns: Column<AttendanceRow>[] = [
    { label: 'Date', render: (row) => fmtDate(row.date) },
    { label: 'Type', render: (row) => row.attendanceType },
    { label: 'Subject', render: (row) => row.subjectName ?? row.session?.subjectName ?? row.subjectCode ?? '—' },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Captured via', render: (row) => row.markMethod },
    { label: 'Remarks', render: (row) => row.remarks ?? '—' },
  ];

  return (
    <PageShell
      title="Attendance"
      subtitle="Your child's session-by-session attendance record."
      error={error}
      loading={loading}
      actions={
        <select
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setSkip(0);
          }}
          style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option || 'all'} value={option}>
              {option ? option.replace(/_/g, ' ') : 'All statuses'}
            </option>
          ))}
        </select>
      }
    >
      {data && (
        <>
          <div className="sp-grid">
            <Stat label="Overall" value={data.summary.percentage === null ? '—' : `${data.summary.percentage}%`} hint={`${data.summary.total} records`} />
            <Stat label="Present" value={data.summary.present} />
            <Stat label="Absent" value={data.summary.absent} />
            <Stat label="Late" value={data.summary.late} />
            <Stat label="Leave" value={data.summary.leave} />
          </div>
          <Card>
            <DataTable columns={columns} rows={data.rows} rowKey={(row) => row.id} empty="No attendance records yet." />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip(Math.max(0, skip - take))}>
                Previous
              </Button>
              <span className="sp-muted">
                {skip + 1}–{Math.min(skip + take, data.total)} of {data.total}
              </span>
              <Button variant="secondary" disabled={skip + take >= data.total} onClick={() => setSkip(skip + take)}>
                Next
              </Button>
            </div>
          </Card>
        </>
      )}
    </PageShell>
  );
}
