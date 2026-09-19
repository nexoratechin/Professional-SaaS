import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import {
  ADVISING_PRIORITIES,
  ADVISING_STATUSES,
  BACKLOG_STATUSES,
  IdName,
  UserIdField,
  UserRow,
  selectStyle,
  useEntityList,
  useUsers,
} from './academics-shared';

interface StudentRow {
  id: string;
  fullName?: string | null;
  admissionNumber?: string | null;
  rollNumber?: string | null;
}

function useStudents(): StudentRow[] {
  const [students, setStudents] = useState<StudentRow[]>([]);
  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: StudentRow[]; total: number }>('/students?take=200')
      .then((res) => {
        if (mounted) setStudents(res.data);
      })
      .catch(() => {
        if (mounted) setStudents([]);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return students;
}

// ── Academic advising ───────────────────────────────────────────────────

interface AdvisingRow {
  id: string;
  summary: string;
  priority: string;
  status: string;
  student?: { id: string; fullName?: string | null; admissionNumber?: string | null };
  advisor?: UserRow | null;
}

export function AdvisingTab({
  canCreate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const students = useStudents();
  const users = useUsers();
  const terms = useEntityList('terms');
  const [rows, setRows] = useState<AdvisingRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [studentId, setStudentId] = useState('');
  const [advisorUserId, setAdvisorUserId] = useState('');
  const [termId, setTermId] = useState('');
  const [summary, setSummary] = useState('');
  const [details, setDetails] = useState('');
  const [priority, setPriority] = useState('NORMAL');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (statusFilter) p.set('status', statusFilter);
    return p.toString();
  }, [statusFilter]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: AdvisingRow[]; total: number }>(`/academics/advising?${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load advising records.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!studentId || !advisorUserId || !summary.trim()) {
      onError('Student, advisor and summary are required.');
      return;
    }
    try {
      await apiFetch('/academics/advising', {
        method: 'POST',
        body: JSON.stringify({
          studentId,
          advisorUserId,
          termId: termId || undefined,
          summary: summary.trim(),
          details: details || undefined,
          priority,
        }),
      });
      setShowForm(false);
      setStudentId('');
      setAdvisorUserId('');
      setTermId('');
      setSummary('');
      setDetails('');
      onNotice('Advising record created.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create advising record.');
    }
  };

  const resolve = async (id: string, cancelled: boolean) => {
    try {
      await apiFetch(`/academics/advising/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify(cancelled ? { status: 'CANCELLED' } : {}),
      });
      onNotice(cancelled ? 'Record cancelled.' : 'Record resolved.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Academic advising</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            {ADVISING_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New record</Button>}
        </div>
      </div>

      {showForm && canCreate && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8, alignItems: 'center' }}>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ ...selectStyle, minWidth: 240 }}>
            <option value="">Student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber ?? s.rollNumber ?? s.id.slice(0, 8)})</option>
            ))}
          </select>
          <UserIdField value={advisorUserId} users={users} onChange={setAdvisorUserId} />
          <select value={termId} onChange={(e) => setTermId(e.target.value)} style={selectStyle}>
            <option value="">Term (optional)…</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{t.name ?? t.code}</option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
            {ADVISING_PRIORITIES.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <Input value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Summary" style={{ flex: 1, minWidth: 180 }} />
          <Input value={details} onChange={(e) => setDetails(e.target.value)} placeholder="Details" style={{ flex: 1, minWidth: 180 }} />
          <Button onClick={() => void create()}>Save</Button>
        </div>
      )}

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No advising records yet.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Student</th>
              <th style={{ padding: 8 }}>Advisor</th>
              <th style={{ padding: 8 }}>Summary</th>
              <th style={{ padding: 8 }}>Priority</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{r.student?.fullName ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.advisor?.fullName ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.summary}</td>
                <td style={{ padding: 8 }}>{r.priority}</td>
                <td style={{ padding: 8 }}>{r.status}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canManage && r.status === 'OPEN' && (
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void resolve(r.id, false)}>Resolve</Button>
                  )}
                  {canManage && r.status === 'OPEN' && (
                    <Button variant="secondary" onClick={() => void resolve(r.id, true)}>Cancel</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Progression / promotion ─────────────────────────────────────────────

interface ProgressionRow {
  id: string;
  fromSemester: number;
  toSemester: number;
  status: string;
  creditsEarned?: number | null;
  creditsRequired?: number | null;
  backlogOpen?: number | null;
  backlogCleared?: number | null;
  student?: { id: string; fullName?: string | null };
  academicYear?: IdName | null;
}

interface PromoteResult {
  processed: number;
  summary: { promoted: number; continuing: number; reappearing: number; detained: number; graduated: number; skipped: number };
  details: { studentId: string; fullName: string; status: string; skipped: boolean; message: string }[];
}

export function ProgressionTab({
  canManage,
  onError,
  onNotice,
}: {
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const batches = useEntityList('batches');
  const academicYears = useEntityList('academic-years');
  const [rows, setRows] = useState<ProgressionRow[]>([]);
  const [promoteResult, setPromoteResult] = useState<PromoteResult | null>(null);

  const [promoteBatchId, setPromoteBatchId] = useState('');
  const [promoteYearId, setPromoteYearId] = useState('');
  const [toSemester, setToSemester] = useState('3');
  const [backlogThreshold, setBacklogThreshold] = useState('2');

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: ProgressionRow[]; total: number }>('/academics/progression?take=100');
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load progression records.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const promoteBatch = async () => {
    if (!promoteBatchId || !promoteYearId) {
      onError('Pick a batch and academic year to promote.');
      return;
    }
    try {
      const res = await apiFetch<PromoteResult>('/academics/progression/promote-batch', {
        method: 'POST',
        body: JSON.stringify({
          batchId: promoteBatchId,
          academicYearId: promoteYearId,
          toSemester: Number(toSemester) || 3,
          backlogThreshold: backlogThreshold ? Number(backlogThreshold) : undefined,
        }),
      });
      setPromoteResult(res);
      onNotice(`${res.processed} students processed.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Batch promotion failed.');
    }
  };

  return (
    <>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Academic progression</h2>
        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No progression records yet — run a batch promotion.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Student</th>
                <th style={{ padding: 8 }}>Year</th>
                <th style={{ padding: 8 }}>Semester</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Credits</th>
                <th style={{ padding: 8 }}>Backlogs</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{r.student?.fullName ?? '—'}</td>
                  <td style={{ padding: 8 }}>{r.academicYear?.name ?? r.academicYear?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>{r.fromSemester} → {r.toSemester}</td>
                  <td style={{ padding: 8 }}>{r.status}</td>
                  <td style={{ padding: 8 }}>{r.creditsEarned != null ? `${r.creditsEarned}/${r.creditsRequired ?? '—'}` : '—'}</td>
                  <td style={{ padding: 8 }}>{r.backlogOpen != null ? `${r.backlogOpen} open / ${r.backlogCleared ?? 0} cleared` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canManage && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Promote batch</h2>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 12 }}>
            Evaluates one batch for a new academic year: students with more open backlogs than the threshold become
            REAPPEARING, students completing the program duration graduate, everyone else is promoted/continuing.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <select value={promoteBatchId} onChange={(e) => setPromoteBatchId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
              <option value="">Batch…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.name ?? b.code}</option>
              ))}
            </select>
            <select value={promoteYearId} onChange={(e) => setPromoteYearId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
              <option value="">Promote into year…</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>{y.name ?? y.code}</option>
              ))}
            </select>
            <Input type="number" value={toSemester} onChange={(e) => setToSemester(e.target.value)} placeholder="Target semester" style={{ width: 130 }} />
            <Input type="number" value={backlogThreshold} onChange={(e) => setBacklogThreshold(e.target.value)} placeholder="Backlog threshold" style={{ width: 150 }} />
            <Button onClick={() => void promoteBatch()}>Promote batch</Button>
          </div>

          {promoteResult && (
            <div style={{ marginTop: 12, padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: '0.9rem' }}>
              <p>
                <strong>Processed {promoteResult.processed}</strong> · Promoted {promoteResult.summary.promoted} · Continuing{' '}
                {promoteResult.summary.continuing} · Reappearing {promoteResult.summary.reappearing} · Detained{' '}
                {promoteResult.summary.detained} · Graduated {promoteResult.summary.graduated} · Skipped{' '}
                {promoteResult.summary.skipped}
              </p>
              {promoteResult.details.length > 0 && (
                <ul style={{ marginTop: 8 }}>
                  {promoteResult.details.map((d) => (
                    <li key={d.studentId}>
                      {d.fullName} → {d.status}
                      {d.skipped ? ` (skipped: ${d.message})` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}
    </>
  );
}

// ── Backlogs ─────────────────────────────────────────────────────────────

interface BacklogRow {
  id: string;
  status: string;
  remarks?: string | null;
  student?: { id: string; fullName?: string | null; admissionNumber?: string | null };
  course?: IdName;
  term?: IdName | null;
}

export function BacklogsTab({
  canCreate,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const students = useStudents();
  const terms = useEntityList('terms');
  const [rows, setRows] = useState<BacklogRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [courses, setCourses] = useState<IdName[]>([]);

  const [studentId, setStudentId] = useState('');
  const [courseId, setCourseId] = useState('');
  const [termId, setTermId] = useState('');
  const [remarks, setRemarks] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (statusFilter) p.set('status', statusFilter);
    return p.toString();
  }, [statusFilter]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: BacklogRow[]; total: number }>(`/academics/backlogs?${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load backlogs.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: IdName[]; total: number }>('/academics/courses?take=300')
      .then((res) => {
        if (mounted) setCourses(res.data);
      })
      .catch(() => {
        if (mounted) setCourses([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const create = async () => {
    if (!studentId || !courseId || !termId) {
      onError('Student, course and term are required.');
      return;
    }
    try {
      await apiFetch('/academics/backlogs', {
        method: 'POST',
        body: JSON.stringify({ studentId, courseId, termId, remarks: remarks || undefined }),
      });
      setShowForm(false);
      setStudentId('');
      setCourseId('');
      setTermId('');
      setRemarks('');
      onNotice('Backlog recorded.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to record backlog.');
    }
  };

  const clear = async (ids: string[]) => {
    try {
      await apiFetch('/academics/backlogs/clear', { method: 'POST', body: JSON.stringify({ backlogIds: ids }) });
      onNotice(`${ids.length} backlog(s) cleared.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to clear backlogs.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Course backlogs</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            {BACKLOG_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New backlog</Button>}
        </div>
      </div>

      {showForm && canCreate && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8, alignItems: 'center' }}>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ ...selectStyle, minWidth: 240 }}>
            <option value="">Student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber ?? s.rollNumber ?? s.id.slice(0, 8)})</option>
            ))}
          </select>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} style={{ ...selectStyle, minWidth: 240 }}>
            <option value="">Course…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
            ))}
          </select>
          <select value={termId} onChange={(e) => setTermId(e.target.value)} style={selectStyle}>
            <option value="">Term…</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{t.name ?? t.code}</option>
            ))}
          </select>
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks" style={{ flex: 1, minWidth: 160 }} />
          <Button onClick={() => void create()}>Save</Button>
        </div>
      )}

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No backlogs yet.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Student</th>
              <th style={{ padding: 8 }}>Course</th>
              <th style={{ padding: 8 }}>Term</th>
              <th style={{ padding: 8 }}>Remarks</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{r.student?.fullName ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.course?.code} — {r.course?.name}</td>
                <td style={{ padding: 8 }}>{r.term?.name ?? r.term?.code ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.remarks ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.status}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {r.status === 'OPEN' && (
                    <Button variant="secondary" onClick={() => void clear([r.id])}>Clear</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Academic calendar ───────────────────────────────────────────────────

interface CalendarRow {
  id: string;
  eventType?: string | null;
  title: string;
  description?: string | null;
  startAt: string;
  endAt: string;
  appliesTo?: string | null;
  isPublished: boolean;
  academicYear?: IdName | null;
  term?: IdName | null;
}

export function CalendarTab({
  canCreate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const academicYears = useEntityList('academic-years');
  const terms = useEntityList('terms');
  const [rows, setRows] = useState<CalendarRow[]>([]);
  const [yearFilter, setYearFilter] = useState('');
  const [showForm, setShowForm] = useState(false);

  const [yearId, setYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [eventType, setEventType] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [appliesTo, setAppliesTo] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (yearFilter) p.set('academicYearId', yearFilter);
    return p.toString();
  }, [yearFilter]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: CalendarRow[]; total: number }>(`/academics/calendar?${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load calendar events.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!yearId || !title.trim() || !startAt || !endAt) {
      onError('Academic year, title and dates are required.');
      return;
    }
    try {
      await apiFetch('/academics/calendar', {
        method: 'POST',
        body: JSON.stringify({
          academicYearId: yearId,
          termId: termId || undefined,
          eventType: eventType || undefined,
          title: title.trim(),
          description: description || undefined,
          startAt,
          endAt,
          appliesTo: appliesTo || undefined,
        }),
      });
      setShowForm(false);
      setYearId('');
      setTermId('');
      setEventType('');
      setTitle('');
      setDescription('');
      setStartAt('');
      setEndAt('');
      setAppliesTo('');
      onNotice('Calendar event created.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create event.');
    }
  };

  const publish = async () => {
    try {
      await apiFetch('/academics/calendar/publish', { method: 'POST', body: JSON.stringify({}) });
      onNotice('Calendar published.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Publish failed.');
    }
  };

  const remove = async (id: string) => {
    try {
      await apiFetch(`/academics/calendar/${id}`, { method: 'DELETE' });
      onNotice('Event deleted.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Delete failed.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Academic calendar</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={yearFilter} onChange={(e) => setYearFilter(e.target.value)} style={selectStyle}>
            <option value="">All years</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>{y.name ?? y.code}</option>
            ))}
          </select>
          {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New event</Button>}
          {canManage && <Button onClick={() => void publish()}>Publish</Button>}
        </div>
      </div>

      {showForm && canCreate && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8, alignItems: 'center' }}>
          <select value={yearId} onChange={(e) => setYearId(e.target.value)} style={{ ...selectStyle, minWidth: 180 }}>
            <option value="">Academic year…</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>{y.name ?? y.code}</option>
            ))}
          </select>
          <select value={termId} onChange={(e) => setTermId(e.target.value)} style={selectStyle}>
            <option value="">Term (optional)…</option>
            {terms.map((t) => (
              <option key={t.id} value={t.id}>{t.name ?? t.code}</option>
            ))}
          </select>
          <Input value={eventType} onChange={(e) => setEventType(e.target.value)} placeholder="Type (e.g. EXAM)" style={{ width: 140 }} />
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" style={{ flex: 1, minWidth: 160 }} />
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" style={{ flex: 1, minWidth: 160 }} />
          <Input value={startAt} onChange={(e) => setStartAt(e.target.value)} placeholder="Start (ISO date)" style={{ width: 170 }} />
          <Input value={endAt} onChange={(e) => setEndAt(e.target.value)} placeholder="End (ISO date)" style={{ width: 170 }} />
          <Input value={appliesTo} onChange={(e) => setAppliesTo(e.target.value)} placeholder="Applies to" style={{ width: 120 }} />
          <Button onClick={() => void create()}>Save</Button>
        </div>
      )}

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No calendar events yet.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Title</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Year / Term</th>
              <th style={{ padding: 8 }}>Period</th>
              <th style={{ padding: 8 }}>Applies to</th>
              <th style={{ padding: 8 }}>Published</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{e.title}</td>
                <td style={{ padding: 8 }}>{e.eventType ?? '—'}</td>
                <td style={{ padding: 8 }}>{e.academicYear?.name ?? '—'}{e.term ? ` / ${e.term.name ?? e.term.code}` : ''}</td>
                <td style={{ padding: 8 }}>{e.startAt.slice(0, 10)} → {e.endAt.slice(0, 10)}</td>
                <td style={{ padding: 8 }}>{e.appliesTo ?? 'All'}</td>
                <td style={{ padding: 8, color: e.isPublished ? '#15803d' : '#9ca3af' }}>{e.isPublished ? 'Yes' : 'No'}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canManage && (
                    <Button variant="secondary" onClick={() => void remove(e.id)}>Delete</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}