import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle, useEntityList } from './academics-shared';
import {
  EXAM_ELIGIBILITY_RULE_TYPES,
  EXAM_MARKS_STATUSES,
  EXAM_REGISTRATION_STATUSES,
  EXAM_SESSION_STATUSES,
  EXAM_TYPES,
  EligibilityOutcomeRow,
  ExamSubjectRow,
  HallTicketRow,
  MarksRow,
  Paged,
  RegistrationRow,
  RevaluationRow,
  SeatAllocationRow,
  SeatingPlanRow,
  SessionRow,
  useCourses,
  useSessions,
  useStudents,
} from './exams-shared';

export const VIEW_PERMISSION = 'exams.view';
export const CREATE_PERMISSION = 'exams.create';
export const UPDATE_PERMISSION = 'exams.update';
export const APPROVE_PERMISSION = 'exams.approve';
export const PUBLISH_PERMISSION = 'exams.publish';
export const MANAGE_PERMISSION = 'exams.manage';

type Tab = 'sessions' | 'registrations' | 'hall-tickets' | 'seating' | 'marks' | 'revaluations';

export function ExamsPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<Tab>('sessions');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canCreate = permissions.includes(CREATE_PERMISSION);
  const canUpdate = permissions.includes(UPDATE_PERMISSION);
  const canApprove = permissions.includes(APPROVE_PERMISSION);
  const canPublish = permissions.includes(PUBLISH_PERMISSION);
  const canManage = permissions.includes(MANAGE_PERMISSION);

  return (
    <div style={{ maxWidth: 1150, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Examinations</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('sessions')}>Sessions</Button>
          <Button variant="secondary" onClick={() => setTab('registrations')}>Registrations</Button>
          <Button variant="secondary" onClick={() => setTab('hall-tickets')}>Hall tickets</Button>
          <Button variant="secondary" onClick={() => setTab('seating')}>Seating</Button>
          <Button variant="secondary" onClick={() => setTab('marks')}>Marks</Button>
          <Button variant="secondary" onClick={() => setTab('revaluations')}>Revaluation</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'sessions' && (
        <SessionsTab
          canCreate={canCreate}
          canUpdate={canUpdate}
          canApprove={canApprove}
          canPublish={canPublish}
          canManage={canManage}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'registrations' && (
        <RegistrationsTab canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'hall-tickets' && (
        <HallTicketsTab canPublish={canPublish} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'seating' && (
        <SeatingTab canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'marks' && (
        <MarksTab canCreate={canCreate} canUpdate={canUpdate} canApprove={canApprove} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'revaluations' && (
        <RevaluationsTab canCreate={canCreate} canApprove={canApprove} onError={setError} onNotice={setNotice} />
      )}
    </div>
  );
}

// ── Shared small pieces ──────────────────────────────────────────────────────

function SessionSelect({
  sessions,
  value,
  onChange,
}: {
  sessions: SessionRow[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ ...selectStyle, minWidth: 260 }}>
      <option value="">All sessions</option>
      {sessions.map((s) => (
        <option key={s.id} value={s.id}>
          {s.code} — {s.name} ({s.status})
        </option>
      ))}
    </select>
  );
}

// ── Sessions ─────────────────────────────────────────────────────────────────

function SessionsTab({
  canCreate,
  canUpdate,
  canApprove,
  canPublish,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
  canPublish: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<SessionRow | null>(null);

  const programs = useEntityList('programs');
  const academicYears = useEntityList('academic-years');
  const terms = useEntityList('terms');

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [programId, setProgramId] = useState('');
  const [academicYearId, setAcademicYearId] = useState('');
  const [termId, setTermId] = useState('');
  const [examType, setExamType] = useState<string>(EXAM_TYPES[0]);
  const [isSupplementary, setIsSupplementary] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [resultDate, setResultDate] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (q) p.set('search', q);
    if (status) p.set('status', status);
    return p.toString();
  }, [q, status]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<SessionRow>>(`/exams/sessions?${params}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load sessions.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshSelected = useCallback(async (id: string) => {
    try {
      const detail = await apiFetch<SessionRow>(`/exams/sessions/${id}`);
      setSelected((cur) => ({ ...detail, _count: detail._count ?? cur?._count }));
    } catch {
      // best-effort reload
    }
  }, []);

  const create = async () => {
    if (!name.trim() || !code.trim() || !programId || !academicYearId) {
      onError('Name, code, program and academic year are required.');
      return;
    }
    try {
      await apiFetch('/exams/sessions', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim(),
          programId,
          academicYearId,
          termId: termId || undefined,
          examType,
          isSupplementary,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          resultDeclarationDate: resultDate || undefined,
        }),
      });
      setShowForm(false);
      setName('');
      setCode('');
      setProgramId('');
      setAcademicYearId('');
      setTermId('');
      setStartDate('');
      setEndDate('');
      setResultDate('');
      onNotice('Exam session created.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create session.');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this exam session and everything under it?')) return;
    try {
      await apiFetch(`/exams/sessions/${id}`, { method: 'DELETE' });
      onNotice('Session deleted.');
      onError(null);
      if (selected?.id === id) setSelected(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete session.');
    }
  };

  const openDetail = async (id: string) => {
    try {
      const detail = await apiFetch<SessionRow>(`/exams/sessions/${id}`);
      setSelected(detail);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load session.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Exam sessions</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code/name" style={{ minWidth: 200 }} />
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
              <option value="">All statuses</option>
              {EXAM_SESSION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New session</Button>}
          </div>
        </div>

        {showForm && canCreate && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" style={{ width: 120 }} />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ flex: 1, minWidth: 180 }} />
            <select value={examType} onChange={(e) => setExamType(e.target.value)} style={selectStyle}>
              {EXAM_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={programId} onChange={(e) => setProgramId(e.target.value)} style={selectStyle}>
              <option value="">Program…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
              ))}
            </select>
            <select value={academicYearId} onChange={(e) => setAcademicYearId(e.target.value)} style={selectStyle}>
              <option value="">Academic year…</option>
              {academicYears.map((a) => (
                <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
              ))}
            </select>
            <select value={termId} onChange={(e) => setTermId(e.target.value)} style={selectStyle}>
              <option value="">No term</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
              <input type="checkbox" checked={isSupplementary} onChange={(e) => setIsSupplementary(e.target.checked)} />
              Supplementary
            </label>
            <Input value={startDate} onChange={(e) => setStartDate(e.target.value)} placeholder="Start date" type="date" style={{ width: 150 }} />
            <Input value={endDate} onChange={(e) => setEndDate(e.target.value)} placeholder="End date" type="date" style={{ width: 150 }} />
            <Input value={resultDate} onChange={(e) => setResultDate(e.target.value)} placeholder="Result date" type="date" style={{ width: 150 }} />
            <Button onClick={() => void create()}>Save</Button>
          </div>
        )}

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No exam sessions yet.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Program</th>
                <th style={{ padding: 8 }}>Dates</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{s.code}</td>
                  <td style={{ padding: 8 }}>{s.name}</td>
                  <td style={{ padding: 8 }}>{s.examType}</td>
                  <td style={{ padding: 8 }}>{s.program?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>{fmtDate(s.startDate)} → {fmtDate(s.endDate)}</td>
                  <td style={{ padding: 8 }}>{s.status}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void openDetail(s.id)}>Open</Button>
                    {canManage && (
                      <Button variant="secondary" onClick={() => void remove(s.id)}>Delete</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <SessionDetailCard
          session={selected}
          canUpdate={canUpdate}
          canApprove={canApprove}
          canPublish={canPublish}
          canManage={canManage}
          onClose={() => setSelected(null)}
          onChanged={() => {
            void load();
            void refreshSelected(selected.id);
          }}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

function SessionDetailCard({
  session,
  canUpdate,
  canApprove,
  canPublish,
  canManage,
  onClose,
  onChanged,
  onError,
  onNotice,
}: {
  session: SessionRow;
  canUpdate: boolean;
  canApprove: boolean;
  canPublish: boolean;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [nextStatus, setNextStatus] = useState<string>('');

  const applyStatus = async () => {
    if (!nextStatus) return;
    try {
      await apiFetch(`/exams/sessions/${session.id}/status`, { method: 'POST', body: JSON.stringify({ status: nextStatus }) });
      setNextStatus('');
      onNotice(`Session status set to ${nextStatus}.`);
      onError(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update session status.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>
          {session.code} — {session.name}
          <span style={{ marginLeft: 12, fontWeight: 400, fontSize: '0.85rem', color: '#6b7280' }}>
            {session.examType}{session.isSupplementary ? ' · supplementary' : ''}{session.resultPublishedAt ? ' · results published' : ''}
          </span>
        </h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {canUpdate && session.status !== 'CANCELLED' && (
            <>
              <select value={nextStatus} onChange={(e) => setNextStatus(e.target.value)} style={selectStyle}>
                <option value="">Set status…</option>
                {EXAM_SESSION_STATUSES.filter((s) => s !== session.status && s !== 'DRAFT').map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => void applyStatus()}>Apply</Button>
            </>
          )}
          {canPublish && !session.resultPublishedAt && (
            <Button onClick={() => void publish(session.id)}>Publish results</Button>
          )}
          {canPublish && session.resultPublishedAt && (
            <Button variant="secondary" onClick={() => void unpublish(session.id)}>Unpublish results</Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <p style={{ fontSize: '0.9rem', color: '#4b5563', marginBottom: 12 }}>
        Program: {session.program?.name ?? '—'} · Year: {session.academicYear?.code ?? '—'} · Term: {session.term?.name ?? '—'}
        {' '}· Status: {session.status}
        {' '}· Counts: {session._count?.subjects ?? 0} subjects / {session._count?.registrations ?? 0} registrations /{' '}
        {session._count?.hallTickets ?? 0} hall tickets / {session._count?.seatingPlans ?? 0} seating plans
      </p>

      <SubjectSubBlock sessionId={session.id} canUpdate={canUpdate} canManage={canManage} onError={onError} onNotice={onNotice} onChanged={onChanged} />
      <EligibilitySubBlock session={session} canApprove={canApprove} canManage={canManage} onError={onError} onNotice={onNotice} />
    </Card>
  );

  async function publish(id: string) {
    try {
      await apiFetch(`/exams/sessions/${id}/publish-results`, { method: 'POST', body: JSON.stringify({}) });
      onNotice('Results published.');
      onError(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to publish results.');
    }
  }

  async function unpublish(id: string) {
    try {
      await apiFetch(`/exams/sessions/${id}/unpublish-results`, { method: 'POST', body: JSON.stringify({}) });
      onNotice('Results unpublished.');
      onError(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to unpublish results.');
    }
  }
}

function SubjectSubBlock({
  sessionId,
  canUpdate,
  canManage,
  onError,
  onNotice,
  onChanged,
}: {
  sessionId: string;
  canUpdate: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
  onChanged: () => void;
}) {
  const [subjects, setSubjects] = useState<ExamSubjectRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const courses = useCourses();
  const rooms = useEntityList('rooms');

  const [courseId, setCourseId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [maxMarks, setMaxMarks] = useState('');
  const [passMarks, setPassMarks] = useState('');
  const [duration, setDuration] = useState('');
  const [examDate, setExamDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<Paged<ExamSubjectRow>>(`/exams/sessions/${sessionId}/subjects?take=200`);
      setSubjects(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load subjects.');
    }
  }, [sessionId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!courseId || !maxMarks) {
      onError('Course and max marks are required.');
      return;
    }
    try {
      await apiFetch(`/exams/sessions/${sessionId}/subjects`, {
        method: 'POST',
        body: JSON.stringify({
          courseId,
          roomId: roomId || undefined,
          maxMarks: Number(maxMarks),
          passMarks: passMarks ? Number(passMarks) : 0,
          durationMinutes: duration ? Number(duration) : undefined,
          examDate: examDate || undefined,
          startTime: startTime || undefined,
          endTime: endTime || undefined,
        }),
      });
      setShowForm(false);
      setCourseId('');
      setRoomId('');
      setMaxMarks('');
      setPassMarks('');
      setDuration('');
      setExamDate('');
      setStartTime('');
      setEndTime('');
      onNotice('Subject added.');
      onError(null);
      void load();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add subject.');
    }
  };

  const setStatus = async (id: string, status: string) => {
    try {
      await apiFetch(`/exams/subjects/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
      onNotice(`Subject status set to ${status}.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update subject status.');
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: '0.95rem' }}>Subjects (papers)</h3>
        {canManage && <Button variant="secondary" onClick={() => setShowForm((s) => !s)}>Add subject</Button>}
      </div>

      {showForm && canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
            <option value="">Course…</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
            ))}
          </select>
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={selectStyle}>
            <option value="">No room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>{r.name ?? r.code}</option>
            ))}
          </select>
          <Input value={maxMarks} onChange={(e) => setMaxMarks(e.target.value)} placeholder="Max marks" type="number" style={{ width: 110 }} />
          <Input value={passMarks} onChange={(e) => setPassMarks(e.target.value)} placeholder="Pass marks" type="number" style={{ width: 110 }} />
          <Input value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="Minutes" type="number" style={{ width: 90 }} />
          <Input value={examDate} onChange={(e) => setExamDate(e.target.value)} placeholder="Date" type="date" style={{ width: 150 }} />
          <Input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="Start" style={{ width: 90 }} />
          <Input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="End" style={{ width: 90 }} />
          <Button onClick={() => void create()}>Save</Button>
        </div>
      )}

      {subjects.length === 0 && <p style={{ color: '#9ca3af' }}>No subjects yet.</p>}
      {subjects.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Course</th>
              <th style={{ padding: 8 }}>Room</th>
              <th style={{ padding: 8 }}>Marks</th>
              <th style={{ padding: 8 }}>Date / time</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {subjects.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{s.course?.code} — {s.course?.name}</td>
                <td style={{ padding: 8 }}>{s.room?.name ?? s.room?.code ?? '—'}</td>
                <td style={{ padding: 8 }}>{s.passMarks}/{s.maxMarks}</td>
                <td style={{ padding: 8 }}>{fmtDate(s.examDate)} {s.startTime ?? ''}</td>
                <td style={{ padding: 8 }}>{s.status}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canUpdate && s.status === 'DRAFT' && (
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void setStatus(s.id, 'PUBLISHED')}>Publish</Button>
                  )}
                  {canUpdate && s.status === 'PUBLISHED' && (
                    <Button variant="secondary" onClick={() => void setStatus(s.id, 'COMPLETED')}>Complete</Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function EligibilitySubBlock({
  session,
  canApprove,
  canManage,
  onError,
  onNotice,
}: {
  session: SessionRow;
  canApprove: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rules, setRules] = useState<Record<string, { enabled: boolean; minAttendancePercent: number | null }>>({});
  const [outcomes, setOutcomes] = useState<EligibilityOutcomeRow[] | null>(null);
  const editable = session.status === 'DRAFT' || session.status === 'SCHEDULED';

  const load = useCallback(async () => {
    try {
      const rows = await apiFetch<Array<{ ruleType: string; enabled: boolean; minAttendancePercent: number | null }>>(
        `/exams/sessions/${session.id}/eligibility-rules`,
      );
      const next: Record<string, { enabled: boolean; minAttendancePercent: number | null }> = {};
      for (const ruleType of EXAM_ELIGIBILITY_RULE_TYPES) {
        next[ruleType] = { enabled: false, minAttendancePercent: null };
      }
      for (const r of rows) {
        next[r.ruleType] = { enabled: r.enabled, minAttendancePercent: r.minAttendancePercent };
      }
      setRules(next);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load eligibility rules.');
    }
  }, [session.id, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    try {
      const payload = EXAM_ELIGIBILITY_RULE_TYPES.filter((t) => rules[t]?.enabled).map((t) => ({
        ruleType: t,
        enabled: true,
        ...(rules[t]!.minAttendancePercent !== null
          ? { minAttendancePercent: rules[t]!.minAttendancePercent }
          : {}),
      }));
      await apiFetch(`/exams/sessions/${session.id}/eligibility-rules`, {
        method: 'PUT',
        body: JSON.stringify({ rules: payload }),
      });
      onNotice('Eligibility rules saved.');
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save eligibility rules.');
    }
  };

  const check = async () => {
    try {
      const res = await apiFetch<Paged<EligibilityOutcomeRow>>(`/exams/sessions/${session.id}/eligibility/check`, {
        method: 'POST',
        body: JSON.stringify({}),
      });
      setOutcomes(res.items);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to check eligibility.');
    }
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: '0.95rem' }}>Eligibility rules</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          {canManage && editable && <Button onClick={() => void save()}>Save rules</Button>}
          {canApprove && <Button variant="secondary" onClick={() => void check()}>Check eligibility</Button>}
        </div>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: 8 }}>Rule</th>
            <th style={{ padding: 8 }}>Enabled</th>
            <th style={{ padding: 8 }}>Min attendance %</th>
          </tr>
        </thead>
        <tbody>
          {EXAM_ELIGIBILITY_RULE_TYPES.map((t) => {
            const r = rules[t];
            if (!r) return null;
            return (
              <tr key={t} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{t}</td>
                <td style={{ padding: 8 }}>
                  <input
                    type="checkbox"
                    checked={r.enabled}
                    disabled={!editable}
                    onChange={(e) => setRules((cur) => ({ ...cur, [t]: { ...cur[t]!, enabled: e.target.checked } }))}
                  />
                </td>
                <td style={{ padding: 8 }}>
                  {t === 'MINIMUM_ATTENDANCE' ? (
                    <Input
                      value={r.minAttendancePercent === null ? '' : String(r.minAttendancePercent)}
                      disabled={!editable}
                      onChange={(e) =>
                        setRules((cur) => ({
                          ...cur,
                          [t]: { ...cur[t]!, minAttendancePercent: e.target.value === '' ? null : Number(e.target.value) },
                        }))
                      }
                      type="number"
                      style={{ width: 90 }}
                    />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {outcomes && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Eligibility check — {outcomes.length} students</h4>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 6 }}>Student</th>
                <th style={{ padding: 6 }}>Attendance</th>
                <th style={{ padding: 6 }}>Eligible</th>
                <th style={{ padding: 6 }}>Reasons</th>
              </tr>
            </thead>
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.studentId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 6 }}>{o.fullName} ({o.admissionNumber ?? '—'})</td>
                  <td style={{ padding: 6 }}>{o.attendancePercent === null ? '—' : `${o.attendancePercent}%`}</td>
                  <td style={{ padding: 6, color: o.eligible ? '#15803d' : '#b91c1c' }}>{o.eligible ? 'Yes' : 'No'}</td>
                  <td style={{ padding: 6, color: '#6b7280' }}>
                    {o.reasons.map((r) => `${r.label}: ${r.satisfied ? '✓' : r.detail ?? '✗'}`).join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Registrations ────────────────────────────────────────────────────────────

function RegistrationsTab({
  canCreate,
  canUpdate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const sessions = useSessions();
  const students = useStudents();
  const sections = useEntityList('sections');
  const batches = useEntityList('batches');

  const [sessionId, setSessionId] = useState('');
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  const [studentId, setStudentId] = useState('');
  const [remarks, setRemarks] = useState('');
  const [bStudentId, setBStudentId] = useState('');
  const [eligibleOnly, setEligibleOnly] = useState(true);
  const [bSectionId, setBSectionId] = useState('');
  const [bBatchId, setBBatchId] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (sessionId) p.set('sessionId', sessionId);
    if (q) p.set('search', q);
    if (status) p.set('status', status);
    return p.toString();
  }, [sessionId, q, status]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<RegistrationRow>>(`/exams/registrations?${params}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load registrations.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const registerOne = async () => {
    if (!sessionId || !studentId) {
      onError('Pick a session and a student.');
      return;
    }
    try {
      await apiFetch('/exams/registrations', {
        method: 'POST',
        body: JSON.stringify({ sessionId, studentId, remarks: remarks || undefined }),
      });
      setStudentId('');
      setRemarks('');
      onNotice('Student registered.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to register student.');
    }
  };

  const bulkRegister = async () => {
    if (!sessionId) {
      onError('Pick a session.');
      return;
    }
    try {
      const body: Record<string, unknown> = { sessionId, eligibleOnly };
      if (bStudentId) body.studentIds = [bStudentId];
      if (bSectionId) body.sectionId = bSectionId;
      if (bBatchId) body.batchId = bBatchId;
      const res = await apiFetch<{ registered: number; alreadyRegistered: number; skipped: unknown[] }>(
        '/exams/registrations/bulk',
        { method: 'POST', body: JSON.stringify(body) },
      );
      setBStudentId('');
      onNotice(`Registered ${res.registered}, already ${res.alreadyRegistered}, skipped ${res.skipped.length}.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to bulk register.');
    }
  };

  const setRegistrationStatus = async (id: string, next: string) => {
    try {
      await apiFetch(`/exams/registrations/${id}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: next }),
      });
      onNotice(`Registration set to ${next}.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update registration.');
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Registrations</h2>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <SessionSelect sessions={sessions} value={sessionId} onChange={setSessionId} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student" style={{ minWidth: 180 }} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          <option value="">All statuses</option>
          {EXAM_REGISTRATION_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {canCreate && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
            <option value="">Student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber})</option>
            ))}
          </select>
          <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks" style={{ minWidth: 160 }} />
          <Button onClick={() => void registerOne()}>Register</Button>
        </div>
      )}

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <select value={bStudentId} onChange={(e) => setBStudentId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
            <option value="">Program/section/batch (all eligible)</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>One: {s.fullName} ({s.admissionNumber})</option>
            ))}
          </select>
          <select value={bSectionId} onChange={(e) => setBSectionId(e.target.value)} style={selectStyle}>
            <option value="">Any section</option>
            {sections.map((s) => (
              <option key={s.id} value={s.id}>{s.name ?? s.code}</option>
            ))}
          </select>
          <select value={bBatchId} onChange={(e) => setBBatchId(e.target.value)} style={selectStyle}>
            <option value="">Any batch</option>
            {batches.map((b) => (
              <option key={b.id} value={b.id}>{b.name ?? b.code}</option>
            ))}
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
            <input type="checkbox" checked={eligibleOnly} onChange={(e) => setEligibleOnly(e.target.checked)} />
            Eligible only
          </label>
          <Button onClick={() => void bulkRegister()}>Bulk register</Button>
        </div>
      )}

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No registrations.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Student</th>
              <th style={{ padding: 8 }}>Session</th>
              <th style={{ padding: 8 }}>Hall ticket</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{r.student?.fullName} ({r.student?.admissionNumber ?? '—'})</td>
                <td style={{ padding: 8 }}>{r.session?.code}</td>
                <td style={{ padding: 8 }}>{r.hallTicket?.ticketNumber ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.status}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canUpdate && r.status === 'REGISTERED' && (
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void setRegistrationStatus(r.id, 'CONFIRMED')}>Confirm</Button>
                  )}
                  {canUpdate && r.status !== 'CANCELLED' && !r.hallTicket && (
                    <Button variant="secondary" onClick={() => void setRegistrationStatus(r.id, 'CANCELLED')}>Cancel</Button>
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

// ── Hall tickets ─────────────────────────────────────────────────────────────

function HallTicketsTab({
  canPublish,
  onError,
  onNotice,
}: {
  canPublish: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const sessions = useSessions();
  const [sessionId, setSessionId] = useState('');
  const [rows, setRows] = useState<HallTicketRow[]>([]);
  const [q, setQ] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (sessionId) p.set('sessionId', sessionId);
    if (q) p.set('search', q);
    return p.toString();
  }, [sessionId, q]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<HallTicketRow>>(`/exams/hall-tickets?${params}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load hall tickets.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    if (!sessionId) {
      onError('Pick a session.');
      return;
    }
    try {
      const res = await apiFetch<{ generated: number }>('/exams/hall-tickets/generate', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
      });
      onNotice(`Generated ${res.generated} hall ticket(s).`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to generate hall tickets.');
    }
  };

  const recall = async (id: string) => {
    if (!window.confirm('Recall this hall ticket?')) return;
    try {
      await apiFetch(`/exams/hall-tickets/${id}/recall`, { method: 'POST', body: JSON.stringify({}) });
      onNotice('Hall ticket recalled.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to recall hall ticket.');
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Hall tickets</h2>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <SessionSelect sessions={sessions} value={sessionId} onChange={setSessionId} />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticket number / student" style={{ minWidth: 200 }} />
        {canPublish && sessionId && <Button onClick={() => void generate()}>Generate tickets</Button>}
      </div>

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No hall tickets.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Ticket</th>
              <th style={{ padding: 8 }}>Student</th>
              <th style={{ padding: 8 }}>Session</th>
              <th style={{ padding: 8 }}>Subjects</th>
              <th style={{ padding: 8 }}>Issued</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{t.ticketNumber}</td>
                <td style={{ padding: 8 }}>{t.registration?.student.fullName} ({t.registration?.student.admissionNumber ?? '—'})</td>
                <td style={{ padding: 8 }}>{t.session?.code}</td>
                <td style={{ padding: 8 }}>{t.subjects?.length ?? 0}</td>
                <td style={{ padding: 8 }}>{fmtDate(t.issuedAt)}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canPublish && (
                    <Button variant="secondary" onClick={() => void recall(t.id)}>Recall</Button>
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

// ── Seating ──────────────────────────────────────────────────────────────────

function SeatingTab({
  canCreate,
  canUpdate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const sessions = useSessions();
  const rooms = useEntityList('rooms');
  const [sessionId, setSessionId] = useState('');
  const [rows, setRows] = useState<SeatingPlanRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [openPlan, setOpenPlan] = useState<SeatingPlanRow | null>(null);

  const [subjectId, setSubjectId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [label, setLabel] = useState('');
  const [capacity, setCapacity] = useState('');

  const [subjects, setSubjects] = useState<ExamSubjectRow[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    let mounted = true;
    apiFetch<Paged<ExamSubjectRow>>(`/exams/sessions/${sessionId}/subjects?take=200`)
      .then((res) => {
        if (mounted) setSubjects(res.items);
      })
      .catch(() => {
        if (mounted) setSubjects([]);
      });
    return () => {
      mounted = false;
    };
  }, [sessionId]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (sessionId) p.set('sessionId', sessionId);
    return p.toString();
  }, [sessionId]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<SeatingPlanRow>>(`/exams/seating-plans?${params}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load seating plans.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!sessionId || !roomId) {
      onError('Session and room are required.');
      return;
    }
    try {
      await apiFetch('/exams/seating-plans', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          roomId,
          subjectId: subjectId || undefined,
          label: label || undefined,
          capacity: capacity ? Number(capacity) : undefined,
        }),
      });
      setShowForm(false);
      setSubjectId('');
      setRoomId('');
      setLabel('');
      setCapacity('');
      onNotice('Seating plan created.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create seating plan.');
    }
  };

  const allocate = async (id: string) => {
    try {
      const res = await apiFetch<{ allocated: number }>(`/exams/seating-plans/${id}/allocate`, { method: 'POST', body: '{}' });
      onNotice(`Allocated ${res.allocated} student(s).`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to allocate seating.');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this seating plan?')) return;
    try {
      await apiFetch(`/exams/seating-plans/${id}`, { method: 'DELETE' });
      onNotice('Seating plan deleted.');
      onError(null);
      if (openPlan?.id === id) setOpenPlan(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete seating plan.');
    }
  };

  const openDetail = async (id: string) => {
    try {
      setOpenPlan(await apiFetch<SeatingPlanRow>(`/exams/seating-plans/${id}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load seating plan.');
    }
  };

  const setAllocationStatus = async (allocationId: string, status: string) => {
    try {
      await apiFetch(`/exams/seat-allocations/${allocationId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onNotice(`Seat marked ${status}.`);
      onError(null);
      if (openPlan) void openDetail(openPlan.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update seat allocation.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Seating plans</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <SessionSelect sessions={sessions} value={sessionId} onChange={setSessionId} />
            {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New plan</Button>}
          </div>
        </div>

        {showForm && canCreate && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
            <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={selectStyle}>
              <option value="">Room…</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>{r.name ?? r.code}</option>
              ))}
            </select>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
              <option value="">Subject (optional)…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.course?.code} — {s.course?.name}</option>
              ))}
            </select>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" style={{ width: 140 }} />
            <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity" type="number" style={{ width: 110 }} />
            <Button onClick={() => void create()}>Save</Button>
          </div>
        )}

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No seating plans.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Room</th>
                <th style={{ padding: 8 }}>Subject</th>
                <th style={{ padding: 8 }}>Capacity</th>
                <th style={{ padding: 8 }}>Allocated</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{p.room?.name ?? p.room?.code}</td>
                  <td style={{ padding: 8 }}>{p.subject ? `${p.subject.course.code} — ${p.subject.course.name}` : 'All subjects'}</td>
                  <td style={{ padding: 8 }}>{p.capacity ?? p.room?.capacity ?? '—'}</td>
                  <td style={{ padding: 8 }}>{p._count?.allocations ?? 0}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void openDetail(p.id)}>Allocations</Button>
                    {canManage && <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void allocate(p.id)}>Allocate</Button>}
                    {canManage && <Button variant="secondary" onClick={() => void remove(p.id)}>Delete</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {openPlan && (
        <SeatingDetailCard
          plan={openPlan}
          canUpdate={canUpdate}
          onClose={() => setOpenPlan(null)}
          onSetAllocationStatus={setAllocationStatus}
        />
      )}
    </>
  );
}

function SeatingDetailCard({
  plan,
  canUpdate,
  onClose,
  onSetAllocationStatus,
}: {
  plan: SeatingPlanRow;
  canUpdate: boolean;
  onClose: () => void;
  onSetAllocationStatus: (allocationId: string, status: string) => void;
}) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: '1rem' }}>
          {plan.room?.name ?? plan.room?.code} — allocations
          <span style={{ marginLeft: 12, fontWeight: 400, fontSize: '0.85rem', color: '#6b7280' }}>
            {plan.subject ? `${plan.subject.course.code} — ${plan.subject.course.name}` : 'All subjects'}
          </span>
        </h2>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
      {(plan.allocations?.length ?? 0) === 0 && <p style={{ color: '#9ca3af' }}>No allocations yet.</p>}
      {(plan.allocations?.length ?? 0) > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Seat</th>
              <th style={{ padding: 8 }}>Student</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {plan.allocations?.map((a: SeatAllocationRow) => (
              <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{a.seatNo ?? '—'}</td>
                <td style={{ padding: 8 }}>{a.registration?.student.fullName} ({a.registration?.student.admissionNumber ?? '—'})</td>
                <td style={{ padding: 8 }}>{a.status}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canUpdate && a.status === 'ALLOCATED' && (
                    <>
                      <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void onSetAllocationStatus(a.id, 'PRESENT')}>Present</Button>
                      <Button variant="secondary" onClick={() => void onSetAllocationStatus(a.id, 'ABSENT')}>Absent</Button>
                    </>
                  )}
                  {canUpdate && a.status !== 'ALLOCATED' && (
                    <Button variant="secondary" onClick={() => void onSetAllocationStatus(a.id, 'ALLOCATED')}>Re-open</Button>
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

// ── Marks entry ──────────────────────────────────────────────────────────────

function MarksTab({
  canCreate,
  canUpdate,
  canApprove,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const sessions = useSessions();
  const students = useStudents();
  const [sessionId, setSessionId] = useState('');
  const [subjects, setSubjects] = useState<ExamSubjectRow[]>([]);
  const [subjectId, setSubjectId] = useState('');
  const [rows, setRows] = useState<MarksRow[]>([]);
  const [status, setStatus] = useState('');

  const [studentId, setStudentId] = useState('');
  const [marks, setMarks] = useState('');
  const [grace, setGrace] = useState('');
  const [attendance, setAttendance] = useState('PRESENT');

  const loadSubjects = useCallback(async () => {
    if (!sessionId) {
      setSubjects([]);
      return;
    }
    try {
      const res = await apiFetch<Paged<ExamSubjectRow>>(`/exams/sessions/${sessionId}/subjects?take=200`);
      setSubjects(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load subjects.');
    }
  }, [sessionId, onError]);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (status) p.set('status', status);
    return p.toString();
  }, [status]);

  const load = useCallback(async () => {
    if (!subjectId) {
      setRows([]);
      return;
    }
    onError(null);
    try {
      const res = await apiFetch<Paged<MarksRow>>(`/exams/subjects/${subjectId}/marks?${params}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load marks.');
    }
  }, [subjectId, params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const saveMarks = async () => {
    if (!subjectId || !studentId) {
      onError('Pick a subject and a student.');
      return;
    }
    try {
      await apiFetch(`/exams/subjects/${subjectId}/marks`, {
        method: 'POST',
        body: JSON.stringify({
          studentId,
          marksObtained: marks === '' ? undefined : Number(marks),
          graceMarks: grace === '' ? 0 : Number(grace),
          attendanceStatus: attendance,
        }),
      });
      setMarks('');
      setGrace('');
      onNotice('Marks entry saved.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save marks.');
    }
  };

  const entryAction = async (id: string, action: string) => {
    try {
      await apiFetch(`/exams/marks/${id}/${action}`, { method: 'POST', body: '{}' });
      onNotice(`Marks ${action.replace('-', ' ')}.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : `Failed to ${action} marks.`);
    }
  };

  const bulkAction = async (action: 'submit-all' | 'moderate-all') => {
    if (!subjectId) {
      onError('Pick a subject.');
      return;
    }
    try {
      await apiFetch(`/exams/subjects/${subjectId}/marks/${action}`, { method: 'POST', body: '{}' });
      onNotice(`Bulk ${action} done.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : `Failed to ${action} marks.`);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Marks entry</h2>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <SessionSelect sessions={sessions} value={sessionId} onChange={setSessionId} />
        <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ ...selectStyle, minWidth: 240 }}>
          <option value="">Subject…</option>
          {subjects.map((s) => (
            <option key={s.id} value={s.id}>{s.course?.code} — {s.course?.name} ({s.passMarks}/{s.maxMarks})</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          <option value="">All statuses</option>
          {EXAM_MARKS_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        {canUpdate && subjectId && (
          <Button variant="secondary" onClick={() => void bulkAction('submit-all')}>Submit all drafts</Button>
        )}
        {canApprove && subjectId && (
          <Button variant="secondary" onClick={() => void bulkAction('moderate-all')}>Moderate all submitted</Button>
        )}
      </div>

      {canCreate && subjectId && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
            <option value="">Student…</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber})</option>
            ))}
          </select>
          <Input value={marks} onChange={(e) => setMarks(e.target.value)} placeholder="Marks" type="number" style={{ width: 90 }} />
          <Input value={grace} onChange={(e) => setGrace(e.target.value)} placeholder="Grace" type="number" style={{ width: 90 }} />
          <select value={attendance} onChange={(e) => setAttendance(e.target.value)} style={selectStyle}>
            {['PRESENT', 'ABSENT', 'LATE', 'LEAVE'].map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <Button onClick={() => void saveMarks()}>Save entry</Button>
        </div>
      )}

      {subjectId && rows.length === 0 && <p style={{ color: '#9ca3af' }}>No marks entries.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Student</th>
              <th style={{ padding: 8 }}>Marks</th>
              <th style={{ padding: 8 }}>Grace</th>
              <th style={{ padding: 8 }}>Attendance</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{r.registration?.student.fullName} ({r.registration?.student.admissionNumber ?? '—'})</td>
                <td style={{ padding: 8 }}>{r.marksObtained ?? '—'}</td>
                <td style={{ padding: 8 }}>{r.graceMarks}</td>
                <td style={{ padding: 8 }}>{r.attendanceStatus}</td>
                <td style={{ padding: 8 }}>{r.status}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canUpdate && r.status === 'DRAFT' && (
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void entryAction(r.id, 'submit')}>Submit</Button>
                  )}
                  {canApprove && r.status === 'SUBMITTED' && (
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void entryAction(r.id, 'moderate')}>Moderate</Button>
                  )}
                  {canApprove && r.status === 'MODERATED' && (
                    <>
                      <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void entryAction(r.id, 'approve')}>Approve</Button>
                      <Button variant="secondary" onClick={() => void entryAction(r.id, 'reject')}>Reject</Button>
                    </>
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

// ── Revaluation ──────────────────────────────────────────────────────────────

function RevaluationsTab({
  canCreate,
  canApprove,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canApprove: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const sessions = useSessions();
  const [rows, setRows] = useState<RevaluationRow[]>([]);
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const [requestSessionId, setRequestSessionId] = useState('');
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [subjects, setSubjects] = useState<ExamSubjectRow[]>([]);
  const [registrationId, setRegistrationId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const [reason, setReason] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (status) p.set('status', status);
    if (q) p.set('search', q);
    return p.toString();
  }, [status, q]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<RevaluationRow>>(`/exams/revaluations?${params}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load revaluation requests.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!requestSessionId) {
      setRegistrations([]);
      setSubjects([]);
      return;
    }
    let mounted = true;
    void Promise.all([
      apiFetch<Paged<RegistrationRow>>(`/exams/registrations?sessionId=${requestSessionId}&take=200`),
      apiFetch<Paged<ExamSubjectRow>>(`/exams/sessions/${requestSessionId}/subjects?take=200`),
    ]).then(([regs, subs]) => {
      if (mounted) {
        setRegistrations(regs.items);
        setSubjects(subs.items);
      }
    }).catch(() => {
      if (mounted) {
        setRegistrations([]);
        setSubjects([]);
      }
    });
    return () => {
      mounted = false;
    };
  }, [requestSessionId]);

  const request = async () => {
    if (!registrationId || !subjectId || !reason.trim()) {
      onError('Registration, subject and reason are required.');
      return;
    }
    try {
      await apiFetch('/exams/revaluations', {
        method: 'POST',
        body: JSON.stringify({ registrationId, subjectId, reason: reason.trim() }),
      });
      setReason('');
      setRegistrationId('');
      setSubjectId('');
      onNotice('Revaluation requested.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to request revaluation.');
    }
  };

  const resolve = async (id: string) => {
    const revised = window.prompt('Revised marks (leave blank to reject):');
    const status = revised === null ? null : revised.trim() === '' ? 'REJECTED' : 'RESOLVED';
    if (status === null) return;
    try {
      await apiFetch(`/exams/revaluations/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          status,
          ...(status === 'RESOLVED' ? { revisedMarks: Number(revised) } : {}),
          remark: status === 'RESOLVED' ? `Revised to ${revised}` : 'Rejected after review.',
        }),
      });
      onNotice(`Revaluation marked ${status}.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to resolve revaluation.');
    }
  };

  return (
    <>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Revaluation requests</h2>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student" style={{ minWidth: 180 }} />
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            {['REQUESTED', 'UNDER_REVIEW', 'RESOLVED', 'REJECTED'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No revaluation requests.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Student</th>
                <th style={{ padding: 8 }}>Subject</th>
                <th style={{ padding: 8 }}>Reason</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{r.registration?.student.fullName} ({r.registration?.student.admissionNumber ?? '—'})</td>
                  <td style={{ padding: 8 }}>{r.subject?.course.code} — {r.subject?.course.name}</td>
                  <td style={{ padding: 8, fontSize: '0.85rem', color: '#4b5563' }}>{r.reason}</td>
                  <td style={{ padding: 8 }}>{r.status}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {canApprove && (r.status === 'REQUESTED' || r.status === 'UNDER_REVIEW') && (
                      <Button variant="secondary" onClick={() => void resolve(r.id)}>Resolve / reject</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canCreate && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Request revaluation</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <SessionSelect sessions={sessions} value={requestSessionId} onChange={setRequestSessionId} />
            <select value={registrationId} onChange={(e) => setRegistrationId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
              <option value="">Registration…</option>
              {registrations.map((reg) => (
                <option key={reg.id} value={reg.id}>
                  {reg.student?.fullName} ({reg.student?.admissionNumber ?? '—'})
                </option>
              ))}
            </select>
            <select value={subjectId} onChange={(e) => setSubjectId(e.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
              <option value="">Subject…</option>
              {subjects.map((s) => (
                <option key={s.id} value={s.id}>{s.course?.code} — {s.course?.name}</option>
              ))}
            </select>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" style={{ flex: 1, minWidth: 200 }} />
            <Button onClick={() => void request()}>Request</Button>
          </div>
        </Card>
      )}
    </>
  );
}