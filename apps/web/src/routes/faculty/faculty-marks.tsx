import React, { useEffect, useState } from 'react';
import { Button, Card } from '@college-erp/ui';
import { DataTable, PageShell, StatusBadge, apiFetch, fmtDate, usePortalData, type Column } from './faculty-shared';

interface MarksSubject {
  id: string;
  maxMarks: number;
  passMarks: number;
  examDate: string | null;
  status: string;
  course: { id: string; code: string; name: string };
  session: { id: string; name: string; code: string; examType: string; status: string };
  _count: { marksEntries: number };
}

interface MarksRow {
  registrationId: string;
  studentId: string;
  student: { id: string; fullName: string; admissionNumber: string; rollNumber: string | null };
  marks: { id: string; marksObtained: number | null; graceMarks: number; attendanceStatus: string; status: string } | null;
}

interface SubjectMarks {
  subject: { id: string; maxMarks: number; passMarks: number };
  rows: MarksRow[];
  total: number;
  counts: Record<string, number>;
}

function MarksPanel({ subject, onClose }: { subject: MarksSubject; onClose: () => void }) {
  const { data, error, loading, reload } = usePortalData<SubjectMarks>(
    `/faculty-portal/marks/subjects/${subject.id}?take=200`,
  );
  const [marks, setMarks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const row of data.rows) {
      next[row.studentId] = row.marks?.marksObtained === null || row.marks?.marksObtained === undefined ? '' : String(row.marks.marksObtained);
    }
    setMarks(next);
  }, [data]);

  const locked = (row: MarksRow) => row.marks !== null && row.marks.status !== 'DRAFT';

  const save = async () => {
    if (!data) return;
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      const entries = data.rows
        .filter((row) => !locked(row))
        .map((row) => {
          const value = marks[row.studentId];
          return {
            studentId: row.studentId,
            ...(value !== undefined && value !== '' ? { marksObtained: Number(value) } : {}),
            ...(row.marks ? { attendanceStatus: row.marks.attendanceStatus } : {}),
          };
        });
      await apiFetch(`/faculty-portal/marks/subjects/${subject.id}/bulk`, {
        method: 'POST',
        body: JSON.stringify({ entries }),
      });
      setNotice('Marks saved as draft.');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save marks.');
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch(`/faculty-portal/marks/subjects/${subject.id}/submit`, { method: 'POST' });
      setNotice('Marks submitted for moderation.');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to submit marks.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '1rem', marginTop: 0 }}>
          {subject.course.code} — {subject.course.name} <span className="sp-muted">(max {subject.maxMarks})</span>
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      </div>
      {loading && <p className="sp-muted">Loading…</p>}
      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {actionError && <p style={{ color: '#b91c1c' }}>{actionError}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="sp-table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Roll</th>
                  <th style={{ padding: 8 }}>Student</th>
                  <th style={{ padding: 8 }}>Marks</th>
                  <th style={{ padding: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.studentId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>{row.student.rollNumber ?? row.student.admissionNumber}</td>
                    <td style={{ padding: 8 }}>{row.student.fullName}</td>
                    <td style={{ padding: 8 }}>
                      <input
                        type="number"
                        min={0}
                        max={subject.maxMarks}
                        value={marks[row.studentId] ?? ''}
                        disabled={locked(row)}
                        onChange={(event) => setMarks((prev) => ({ ...prev, [row.studentId]: event.target.value }))}
                        style={{ width: 80, padding: 6, borderRadius: 6, border: '1px solid #cbd5e1' }}
                      />
                    </td>
                    <td style={{ padding: 8 }}>{row.marks ? <StatusBadge value={row.marks.status} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="sp-actions">
            <Button onClick={save} disabled={saving || data.rows.length === 0}>
              {saving ? 'Saving…' : 'Save drafts'}
            </Button>
            <Button variant="secondary" onClick={submit} disabled={data.rows.length === 0}>
              Submit for moderation
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

export function FacultyMarksPage() {
  const { data, error, loading } = usePortalData<{ subjects: MarksSubject[]; total: number }>('/faculty-portal/marks/subjects');
  const [selected, setSelected] = useState<MarksSubject | null>(null);

  const columns: Column<MarksSubject>[] = [
    { label: 'Course', render: (row) => `${row.course.code} — ${row.course.name}` },
    { label: 'Session', render: (row) => `${row.session.name} (${row.session.examType})` },
    { label: 'Date', render: (row) => fmtDate(row.examDate) },
    { label: 'Max', render: (row) => row.maxMarks },
    { label: 'Entered', render: (row) => row._count.marksEntries },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    {
      label: '',
      render: (row) => (
        <Button variant="secondary" onClick={() => setSelected(row)}>
          Enter marks
        </Button>
      ),
    },
  ];

  return (
    <PageShell
      title="Marks Entry"
      subtitle="Papers you teach or invigilate. Enter drafts, then submit the paper for moderation."
      error={error}
      loading={loading}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Card>
          <DataTable columns={columns} rows={data?.subjects ?? []} rowKey={(row) => row.id} empty="No exam papers are assigned to you." />
        </Card>
        {selected && <MarksPanel subject={selected} onClose={() => setSelected(null)} />}
      </div>
    </PageShell>
  );
}
