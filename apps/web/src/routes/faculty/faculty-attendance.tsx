import React, { useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import {
  DataTable,
  PageShell,
  Stat,
  StatusBadge,
  apiFetch,
  fmtDate,
  usePortalData,
  type Column,
} from './faculty-shared';

const STATUSES = ['PRESENT', 'ABSENT', 'LATE', 'LEAVE'] as const;
type AttendanceStatus = (typeof STATUSES)[number];

interface SessionRow {
  id: string;
  date: string;
  status: string;
  subjectCode: string | null;
  subjectName: string | null;
  title: string | null;
  startTime: string | null;
  endTime: string | null;
  courseOffering: { id: string; code: string; course: { code: string; name: string } } | null;
  section: { id: string; code: string; name: string } | null;
  _count: { records: number };
}

interface RosterRow {
  id: string;
  fullName: string;
  rollNumber: string | null;
  admissionNumber: string;
  status: AttendanceStatus | null;
  remarks: string | null;
}

interface SessionDetail {
  session: SessionRow & { notes: string | null };
  roster: RosterRow[];
  counts: { present: number; absent: number; late: number; leave: number };
  requiredPercent: number;
}

function SessionPanel({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const { data, error, loading, reload } = usePortalData<SessionDetail>(`/faculty-portal/attendance/sessions/${id}`);
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, AttendanceStatus> = {};
    for (const row of data.roster) next[row.id] = row.status ?? 'PRESENT';
    setStatuses(next);
  }, [data]);

  const mark = async () => {
    if (!data) return;
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch(`/faculty-portal/attendance/sessions/${id}/mark`, {
        method: 'POST',
        body: JSON.stringify({
          entries: data.roster.map((row) => ({ studentId: row.id, status: statuses[row.id] ?? 'PRESENT' })),
        }),
      });
      setNotice('Attendance saved.');
      await reload();
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save attendance.');
    } finally {
      setSaving(false);
    }
  };

  const closeSession = async () => {
    setActionError(null);
    try {
      await apiFetch(`/faculty-portal/attendance/sessions/${id}/close`, { method: 'POST' });
      setNotice('Session closed.');
      await reload();
      onChanged();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to close session.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>
          Mark attendance{data?.session.subjectCode ? ` · ${data.session.subjectCode}` : ''}
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Close panel
        </Button>
      </div>
      {loading && <p className="sp-muted">Loading…</p>}
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {actionError && <p style={{ color: '#b91c1c' }}>{actionError}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="sp-muted">
            {fmtDate(data.session.date)} · {data.session.courseOffering?.course.name ?? '—'} · required {data.requiredPercent}%
          </div>
          <div className="sp-table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Roll</th>
                  <th style={{ padding: 8 }}>Student</th>
                  <th style={{ padding: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.roster.map((row) => (
                  <tr key={row.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>{row.rollNumber ?? row.admissionNumber}</td>
                    <td style={{ padding: 8 }}>{row.fullName}</td>
                    <td style={{ padding: 8 }}>
                      <select
                        value={statuses[row.id] ?? 'PRESENT'}
                        disabled={data.session.status === 'CLOSED'}
                        onChange={(event) =>
                          setStatuses((prev) => ({ ...prev, [row.id]: event.target.value as AttendanceStatus }))
                        }
                        style={{ padding: 6, borderRadius: 6, border: '1px solid #cbd5e1' }}
                      >
                        {STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sp-actions">
            <Button onClick={mark} disabled={saving || data.roster.length === 0}>
              {saving ? 'Saving…' : 'Save attendance'}
            </Button>
            {data.session.status === 'OPEN' && (
              <Button variant="secondary" onClick={closeSession}>
                Close session
              </Button>
            )}
            <span className="sp-muted">
              {data.counts.present} present · {data.counts.absent} absent · {data.counts.late} late · {data.counts.leave} leave
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}

export function FacultyAttendancePage() {
  const { data: sessions, error, loading, reload } = usePortalData<{ data: SessionRow[]; total: number }>(
    '/faculty-portal/attendance/sessions?take=100',
  );
  const { data: courses } = usePortalData<{ courses: Array<{ offering: { id: string; code: string; course: { code: string; name: string } } }> }>(
    '/faculty-portal/courses',
  );
  const { data: report } = usePortalData<{
    rows: Array<{ student: { id: string; fullName: string; rollNumber: string | null }; present: number; total: number; percentage: number }>;
    summary: { sessions: number; students: number; percentage: number | null } | null;
  }>('/faculty-portal/attendance/report');

  const [selected, setSelected] = useState<string | null>(null);
  const [offeringId, setOfferingId] = useState('');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const offerings = useMemo(
    () => (courses?.courses ?? []).map((course) => course.offering),
    [courses],
  );

  const create = async () => {
    setActionError(null);
    setNotice(null);
    if (!offeringId) {
      setActionError('Select a course offering.');
      return;
    }
    setCreating(true);
    try {
      const result = await apiFetch<{ session: { id: string } }>('/faculty-portal/attendance/sessions', {
        method: 'POST',
        body: JSON.stringify({
          date,
          courseOfferingId: offeringId,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
          title: title || undefined,
        }),
      });
      setNotice('Attendance session opened.');
      setSelected(result.session.id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to open session.');
    } finally {
      setCreating(false);
    }
  };

  const columns: Column<SessionRow>[] = [
    { label: 'Date', render: (row) => fmtDate(row.date) },
    { label: 'Course', render: (row) => (row.courseOffering ? `${row.courseOffering.course.code} (${row.courseOffering.code})` : '—') },
    { label: 'Section', render: (row) => row.section?.name ?? '—' },
    { label: 'Time', render: (row) => (row.startTime ? `${row.startTime}–${row.endTime ?? ''}` : '—') },
    { label: 'Marked', render: (row) => row._count.records },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    {
      label: '',
      render: (row) => (
        <Button variant="secondary" onClick={() => setSelected(row.id)}>
          {row.status === 'OPEN' ? 'Mark' : 'View'}
        </Button>
      ),
    },
  ];

  const shortage = (report?.rows ?? []).filter((row) => row.percentage < 75).slice(0, 10);

  return (
    <PageShell
      title="Attendance"
      subtitle="Open a class session, mark your roster, close it, and review attendance percentages."
      error={error ?? actionError}
      notice={notice}
      loading={loading}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Open a session</h2>
          <div className="sp-cards" style={{ alignItems: 'end' }}>
            <label className="sp-row">
              <span className="sp-muted">Course offering</span>
              <select
                value={offeringId}
                onChange={(event) => setOfferingId(event.target.value)}
                style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
              >
                <option value="">Select offering</option>
                {offerings.map((offering) => (
                  <option key={offering.id} value={offering.id}>
                    {offering.course.code} · {offering.code}
                  </option>
                ))}
              </select>
            </label>
            <Input label="Date" name="date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            <Input label="Start" name="startTime" value={startTime} onChange={(event) => setStartTime(event.target.value)} placeholder="09:00" />
            <Input label="End" name="endTime" value={endTime} onChange={(event) => setEndTime(event.target.value)} placeholder="10:00" />
            <Input label="Title (optional)" name="title" value={title} onChange={(event) => setTitle(event.target.value)} />
            <Button onClick={create} disabled={creating || offerings.length === 0}>
              {creating ? 'Opening…' : 'Open session'}
            </Button>
          </div>
          {offerings.length === 0 && <p className="sp-muted">You have no assigned course offerings yet.</p>}
        </Card>

        {selected && <SessionPanel id={selected} onChanged={reload} onClose={() => setSelected(null)} />}

        <Card>
          <h2 style={{ fontSize: '1rem', marginTop: 0 }}>My sessions</h2>
          <DataTable columns={columns} rows={sessions?.data ?? []} rowKey={(row) => row.id} empty="No attendance sessions yet." />
        </Card>

        {report?.summary && (
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Attendance snapshot</h2>
            <div className="sp-grid">
              <Stat label="Sessions held" value={report.summary.sessions} />
              <Stat label="Students" value={report.summary.students} />
              <Stat label="Overall" value={report.summary.percentage === null ? '—' : `${report.summary.percentage}%`} />
            </div>
          </Card>
        )}

        {shortage.length > 0 && (
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Below 75% attendance</h2>
            <div className="sp-table-wrap">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                    <th style={{ padding: 8 }}>Student</th>
                    <th style={{ padding: 8 }}>Present</th>
                    <th style={{ padding: 8 }}>Total</th>
                    <th style={{ padding: 8 }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {shortage.map((row) => (
                    <tr key={row.student.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: 8 }}>
                        {row.student.fullName} {row.student.rollNumber ? `(${row.student.rollNumber})` : ''}
                      </td>
                      <td style={{ padding: 8 }}>{row.present}</td>
                      <td style={{ padding: 8 }}>{row.total}</td>
                      <td style={{ padding: 8, color: '#b91c1c', fontWeight: 600 }}>{row.percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
