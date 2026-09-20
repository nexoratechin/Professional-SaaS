/**
 * Attendance page — full attendance management for a tenant. Five tabs:
 *  * Sessions — create/open/close attendance sessions and bulk mark the roster.
 *  * Corrections — student/staff correction requests with an approve/reject workflow.
 *  * Devices — device registry (QR/biometric/RFID/mobile), device↔person mappings, the normalized
 *    device-event log, manual ingest, pull sync and reconciliation.
 *  * Faculty — daily staff/faculty attendance logs (own or up-scope).
 *  * Reports — per-student percentage, shortage list, and subject-wise summary.
 * Row-level scope is enforced by the API (attendance.view/create/update/manage), so the UI only
 * renders actions it has permission for via useAuth().permissions.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import type { StudentSummaryDto } from '@college-erp/types';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import {
  ATTENDANCE_MARK_METHODS,
  ATTENDANCE_STATUSES,
  ATTENDANCE_TYPES,
  CORRECTION_STATUSES,
  AttendanceDeviceRow,
  CorrectionRow,
  DEVICE_LOG_STATUSES,
  DEVICE_PROTOCOLS,
  DEVICE_STATUSES,
  DEVICE_TYPES,
  DeviceCounts,
  DeviceLogRow,
  DeviceMappingRow,
  FacultyRow,
  PercentageResp,
  RosterRow,
  SESSION_STATUSES,
  SessionDetail,
  SessionRow,
  ShortageRow,
  SummaryRow,
  fmtDate,
  loadError,
  selectStyle,
  useAttendanceLookups,
} from './attendance-shared';

export const VIEW_PERMISSION = 'attendance.view';
export const CREATE_PERMISSION = 'attendance.create';
export const UPDATE_PERMISSION = 'attendance.update';
export const MANAGE_PERMISSION = 'attendance.manage';

const TAKE = 50;

const thStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  textAlign: 'left',
  borderBottom: '1px solid #e5e7eb',
  fontSize: '0.8rem',
  color: '#6b7280',
};

const tdStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  borderBottom: '1px solid #f3f4f6',
  fontSize: '0.875rem',
};

const statusBadge: Record<string, React.CSSProperties> = {
  OPEN: { color: '#1d4ed8', background: '#eff6ff' },
  CLOSED: { color: '#374151', background: '#f3f4f6' },
  PENDING: { color: '#b45309', background: '#fef3c7' },
  APPROVED: { color: '#15803d', background: '#f0fdf4' },
  REJECTED: { color: '#b91c1c', background: '#fef2f2' },
  PRESENT: { color: '#15803d', background: '#f0fdf4' },
  ABSENT: { color: '#b91c1c', background: '#fef2f2' },
  LATE: { color: '#b45309', background: '#fef3c7' },
  LEAVE: { color: '#7c3aed', background: '#f5f3ff' },
  ACTIVE: { color: '#15803d', background: '#f0fdf4' },
  INACTIVE: { color: '#6b7280', background: '#f3f4f6' },
  SUSPENDED: { color: '#b91c1c', background: '#fef2f2' },
  APPLIED: { color: '#15803d', background: '#f0fdf4' },
  DUPLICATE: { color: '#6b7280', background: '#f3f4f6' },
  UNMAPPED: { color: '#b45309', background: '#fef3c7' },
  QUEUED: { color: '#1d4ed8', background: '#eff6ff' },
  ERROR: { color: '#b91c1c', background: '#fef2f2' },
};

export function AttendancePage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<'sessions' | 'corrections' | 'devices' | 'faculty' | 'reports'>('sessions');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const canCreate = permissions.includes(CREATE_PERMISSION);
  const canUpdate = permissions.includes(UPDATE_PERMISSION);
  const canManage = permissions.includes(MANAGE_PERMISSION);

  return (
    <div style={{ maxWidth: 1150, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Attendance</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('sessions')}>Sessions</Button>
          <Button variant="secondary" onClick={() => setTab('corrections')}>Corrections</Button>
          <Button variant="secondary" onClick={() => setTab('devices')}>Devices</Button>
          <Button variant="secondary" onClick={() => setTab('faculty')}>Faculty</Button>
          <Button variant="secondary" onClick={() => setTab('reports')}>Reports</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'sessions' && (
        <SessionsTab
          canCreate={canCreate}
          canUpdate={canUpdate}
          canManage={canManage}
          reload={reload}
          onReload={() => setReload((r) => r + 1)}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'corrections' && (
        <CorrectionsTab canUpdate={canUpdate} reload={reload} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'devices' && (
        <DevicesTab
          canUpdate={canUpdate}
          canManage={canManage}
          reload={reload}
          onReload={() => setReload((r) => r + 1)}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'faculty' && (
        <FacultyTab canCreate={canCreate} canUpdate={canUpdate} reload={reload} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'reports' && <ReportsTab reload={reload} onError={setError} />}
    </div>
  );
}

// ── Sessions ────────────────────────────────────────────────────────────────

function SessionsTab({
  canCreate,
  canUpdate,
  canManage,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const lookups = useAttendanceLookups();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [termId, setTermId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<SessionDetail | null>(null);

  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [newOfferingId, setNewOfferingId] = useState('');
  const [newSectionId, setNewSectionId] = useState('');
  const [newTermId, setNewTermId] = useState('');
  const [attendanceType, setAttendanceType] = useState('CLASS');
  const [title, setTitle] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [saving, setSaving] = useState(false);

  const [markSaving, setMarkSaving] = useState(false);
  const [markMethod, setMarkMethod] = useState('MANUAL');

  const params = useMemo(() => {
    const p = new URLSearchParams({ skip: '0', take: String(TAKE) });
    if (status) p.set('status', status);
    if (termId) p.set('termId', termId);
    if (sectionId) p.set('sectionId', sectionId);
    if (offeringId) p.set('courseOfferingId', offeringId);
    return p;
  }, [status, termId, sectionId, offeringId]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: SessionRow[]; total: number }>(`/attendance/sessions?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (err) {
      onError(loadError(err, 'Failed to load attendance sessions.'));
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const openSession = useCallback(async (id: string) => {
    try {
      setSelected(await apiFetch<SessionDetail>(`/attendance/sessions/${id}`));
    } catch (err) {
      onError(loadError(err, 'Failed to load session.'));
    }
  }, [onError]);

  const createSession = async () => {
    if (!newOfferingId && !newSectionId) {
      onError('Choose a course offering or a section.');
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, string> = {
        date,
        attendanceType,
        termId: newTermId,
        courseOfferingId: newOfferingId,
        sectionId: newSectionId,
        title,
        startTime,
        endTime,
      };
      const created = await apiFetch<SessionRow>('/attendance/sessions', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      await openSession(created.id);
      setShowForm(false);
      onNotice('Attendance session created.');
      onReload();
    } catch (err) {
      onError(loadError(err, 'Failed to create session.'));
    } finally {
      setSaving(false);
    }
  };

  const closeSession = async (id: string) => {
    try {
      await apiFetch(`/attendance/sessions/${id}/close`, { method: 'POST' });
      onNotice('Session closed.');
      await openSession(id);
      onReload();
    } catch (err) {
      onError(loadError(err, 'Failed to close session.'));
    }
  };

  const removeSession = async (id: string) => {
    if (!window.confirm('Delete this session and its attendance records?')) return;
    try {
      await apiFetch(`/attendance/sessions/${id}`, { method: 'DELETE' });
      setSelected(null);
      onNotice('Session deleted.');
      onReload();
    } catch (err) {
      onError(loadError(err, 'Failed to delete session.'));
    }
  };

  const saveMarks = async () => {
    if (!selected) return;
    const entries = selected.roster
      .filter((r) => r.status !== null)
      .map((r) => ({ studentId: r.id, status: r.status as string, remarks: r.remarks ?? null }));
    if (entries.length === 0) {
      onError('Select a status for at least one student before saving.');
      return;
    }
    setMarkSaving(true);
    try {
      await apiFetch(`/attendance/sessions/${selected.session.id}/mark`, {
        method: 'POST',
        body: JSON.stringify({ entries, markMethod }),
      });
      onNotice(`Marked ${entries.length} student(s).`);
      await openSession(selected.session.id);
      onReload();
    } catch (err) {
      onError(loadError(err, 'Failed to mark attendance.'));
    } finally {
      setMarkSaving(false);
    }
  };

  const setRosterStatus = (studentId: string, value: string) => {
    if (!selected) return;
    setSelected({
      ...selected,
      roster: selected.roster.map((r) => (r.id === studentId ? { ...r, status: value } : r)),
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            {SESSION_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={termId} onChange={(e) => setTermId(e.target.value)} style={selectStyle}>
            <option value="">All terms</option>
            {(lookups?.terms ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.code ?? t.name ?? t.id}</option>
            ))}
          </select>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={selectStyle}>
            <option value="">All sections</option>
            {(lookups?.sections ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.code ?? s.name ?? s.id}</option>
            ))}
          </select>
          <select value={offeringId} onChange={(e) => setOfferingId(e.target.value)} style={selectStyle}>
            <option value="">All offerings</option>
            {(lookups?.offerings ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.course?.code ?? o.code} {o.section ? `· ${o.section.code}` : ''}
              </option>
            ))}
          </select>
          {canCreate && <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : 'New session'}</Button>}
        </div>

        {showForm && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12, background: '#f9fafb', padding: 16, borderRadius: 8 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 150 }} />
              <select value={attendanceType} onChange={(e) => setAttendanceType(e.target.value)} style={selectStyle}>
                {ATTENDANCE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <Input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: 200 }} />
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} style={{ width: 120 }} />
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} style={{ width: 120 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={newOfferingId} onChange={(e) => setNewOfferingId(e.target.value)} style={selectStyle}>
                <option value="">Course offering…</option>
                {(lookups?.offerings ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.course?.code ?? o.code} {o.section ? `· ${o.section.code}` : ''}
                  </option>
                ))}
              </select>
              <select value={newSectionId} onChange={(e) => setNewSectionId(e.target.value)} style={selectStyle}>
                <option value="">Section…</option>
                {(lookups?.sections ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.code ?? s.name ?? s.id}</option>
                ))}
              </select>
              <select value={newTermId} onChange={(e) => setNewTermId(e.target.value)} style={selectStyle}>
                <option value="">Term…</option>
                {(lookups?.terms ?? []).map((t) => (
                  <option key={t.id} value={t.id}>{t.code ?? t.name ?? t.id}</option>
                ))}
              </select>
              <Button onClick={() => void createSession()} disabled={saving}>{saving ? 'Creating…' : 'Create session'}</Button>
            </div>
          </div>
        )}

        <div style={{ marginTop: 12, fontSize: '0.85rem', color: '#6b7280' }}>
          {total} session{total === 1 ? '' : 's'}
        </div>

        {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 12 }}>No sessions match the filters.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Subject</th>
                <th style={thStyle}>Section</th>
                <th style={thStyle}>Term</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Marked</th>
                <th style={thStyle}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td style={tdStyle}>{fmtDate(s.date)}</td>
                  <td style={tdStyle}>{s.subjectCode ?? s.subjectName ?? s.courseOffering?.course?.code ?? '—'}</td>
                  <td style={tdStyle}>{s.section?.code ?? s.courseOffering?.code ?? '—'}</td>
                  <td style={tdStyle}>{s.term?.code ?? '—'}</td>
                  <td style={tdStyle}>{s.attendanceType}</td>
                  <td style={tdStyle}>
                    <span style={{ borderRadius: 999, padding: '0.1rem 0.5rem', ...statusBadge[s.status] }}>{s.status}</span>
                  </td>
                  <td style={tdStyle}>{s._count?.records ?? 0}</td>
                  <td style={tdStyle}>
                    <Button variant="secondary" onClick={() => void openSession(s.id)}>Mark / view</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>
              {selected.session.subjectCode ?? selected.session.subjectName ?? 'Attendance session'} · {fmtDate(selected.session.date)}
            </h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {canUpdate && selected.session.status === 'OPEN' && (
                <Button onClick={() => void closeSession(selected.session.id)}>Close session</Button>
              )}
              {canManage && (
                <Button variant="secondary" onClick={() => void removeSession(selected.session.id)}>Delete</Button>
              )}
              <Button variant="secondary" onClick={() => setSelected(null)}>Close panel</Button>
            </div>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '8px 0 0' }}>
            {selected.session.section?.code ?? '—'} · {selected.session.term?.code ?? '—'} ·{' '}
            Present {selected.counts.present} · Absent {selected.counts.absent} · Late {selected.counts.late} · Leave {selected.counts.leave} ·{' '}
            Required {selected.requiredPercent}%
          </p>

          {selected.session.status === 'OPEN' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12 }}>
              <select value={markMethod} onChange={(e) => setMarkMethod(e.target.value)} style={selectStyle}>
                {ATTENDANCE_MARK_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <Button onClick={() => void saveMarks()} disabled={markSaving}>
                {markSaving ? 'Saving…' : 'Save marks'}
              </Button>
            </div>
          )}

          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Roll</th>
                  <th style={thStyle}>Student</th>
                  <th style={thStyle}>Attendance</th>
                  <th style={thStyle}>Remarks</th>
                </tr>
              </thead>
              <tbody>
                {selected.roster.map((r: RosterRow) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>{r.rollNumber ?? r.admissionNumber}</td>
                    <td style={tdStyle}>{r.fullName}</td>
                    <td style={tdStyle}>
                      {selected.session.status === 'OPEN' ? (
                        <select value={r.status ?? ''} onChange={(e) => setRosterStatus(r.id, e.target.value)} style={selectStyle}>
                          <option value="">Not marked</option>
                          {ATTENDANCE_STATUSES.map((st) => (
                            <option key={st} value={st}>{st}</option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ borderRadius: 999, padding: '0.1rem 0.5rem', ...statusBadge[r.status ?? ''] }}>
                          {r.status ?? 'Not marked'}
                        </span>
                      )}
                    </td>
                    <td style={tdStyle}>{r.remarks ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {selected.roster.length === 0 && <p style={{ color: '#9ca3af' }}>No students in this session's roster.</p>}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Corrections ─────────────────────────────────────────────────────────────

function CorrectionsTab({
  canUpdate,
  reload,
  onError,
  onNotice,
}: {
  canUpdate: boolean;
  reload: number;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<CorrectionRow[]>([]);
  const [status, setStatus] = useState('');
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [students, setStudents] = useState<StudentSummaryDto[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [toStatus, setToStatus] = useState('PRESENT');
  const [reason, setReason] = useState('');
  const [decisionRemarks, setDecisionRemarks] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
      if (status) params.set('status', status);
      const res = await apiFetch<{ data: CorrectionRow[]; total: number }>(`/attendance/corrections?${params.toString()}`);
      setRows(res.data);
    } catch (err) {
      onError(loadError(err, 'Failed to load corrections.'));
    }
  }, [status, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  useEffect(() => {
    apiFetch<{ data: SessionRow[]; total: number }>('/attendance/sessions?skip=0&take=500')
      .then((res) => setSessions(res.data))
      .catch(() => setSessions([]));
    apiFetch<{ data: StudentSummaryDto[]; total: number }>('/students?skip=0&take=500')
      .then((res) => setStudents(res.data))
      .catch(() => setStudents([]));
  }, []);

  const request = async () => {
    if (!sessionId || !studentId) {
      onError('Choose a session and a student.');
      return;
    }
    try {
      await apiFetch('/attendance/corrections', {
        method: 'POST',
        body: JSON.stringify({ sessionId, studentId, toStatus, reason }),
      });
      setShowForm(false);
      onNotice('Correction request submitted.');
      await load();
    } catch (err) {
      onError(loadError(err, 'Failed to submit correction request.'));
    }
  };

  const decide = async (row: CorrectionRow, decision: 'APPROVE' | 'REJECT') => {
    try {
      await apiFetch(`/attendance/corrections/${row.id}/${decision.toLowerCase()}`, {
        method: 'POST',
        body: JSON.stringify({ remarks: decisionRemarks[row.id] ?? '' }),
      });
      onNotice(`Correction ${decision.toLowerCase()}d.`);
      await load();
    } catch (err) {
      onError(loadError(err, 'Failed to decide correction.'));
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
          <option value="">All statuses</option>
          {CORRECTION_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : 'Request correction'}</Button>
      </div>

      {showForm && (
        <div style={{ marginTop: 16, background: '#f9fafb', padding: 16, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={selectStyle}>
              <option value="">Session…</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.subjectCode ?? s.subjectName ?? 'Session'} · {fmtDate(s.date)}
                </option>
              ))}
            </select>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={selectStyle}>
              <option value="">Student…</option>
              {students.map((st) => (
                <option key={st.id} value={st.id}>
                  {st.fullName} ({st.rollNumber ?? st.admissionNumber})
                </option>
              ))}
            </select>
            <select value={toStatus} onChange={(e) => setToStatus(e.target.value)} style={selectStyle}>
              {ATTENDANCE_STATUSES.filter((s) => s !== 'ABSENT').map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Input
              placeholder="Reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              style={{ width: 260 }}
            />
            <Button onClick={() => void request()}>Submit</Button>
          </div>
        </div>
      )}

      {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 12 }}>No correction requests.</p>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Student</th>
                <th style={thStyle}>Session</th>
                <th style={thStyle}>Change</th>
                <th style={thStyle}>Reason</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Requested by</th>
                <th style={thStyle}>Decision</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>
                    {row.student?.fullName ?? '—'}
                    {row.student?.section?.code ? ` (${row.student.section.code})` : ''}
                  </td>
                  <td style={tdStyle}>
                    {row.session ? `${row.session.subjectCode ?? row.session.subjectName ?? 'Session'} · ${fmtDate(row.session.date)}` : '—'}
                  </td>
                  <td style={tdStyle}>{row.fromStatus} → {row.toStatus}</td>
                  <td style={tdStyle}>{row.reason ?? '—'}</td>
                  <td style={tdStyle}>
                    <span style={{ borderRadius: 999, padding: '0.1rem 0.5rem', ...statusBadge[row.status] }}>{row.status}</span>
                  </td>
                  <td style={tdStyle}>{row.requestedBy?.fullName ?? '—'}</td>
                  <td style={tdStyle}>
                    {row.status === 'PENDING' && canUpdate ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        <Input
                          placeholder="Comment"
                          value={decisionRemarks[row.id] ?? ''}
                          onChange={(e) => setDecisionRemarks((m) => ({ ...m, [row.id]: e.target.value }))}
                          style={{ width: 130 }}
                        />
                        <Button variant="secondary" onClick={() => void decide(row, 'REJECT')}>Reject</Button>
                        <Button onClick={() => void decide(row, 'APPROVE')}>Approve</Button>
                      </div>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                        {row.decidedBy?.fullName ?? ''}
                        {row.decidedAt ? ` · ${fmtDate(row.decidedAt)}` : ''}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ── Devices ─────────────────────────────────────────────────────────────────

/** Manages the tenant device registry (QR/biometric/RFID/mobile readers), per-device person
 * mappings, the normalized device-event log, manual ingest, pull sync and reconciliation. */
function DevicesTab({
  canUpdate,
  canManage,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  canUpdate: boolean;
  canManage: boolean;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const lookups = useAttendanceLookups();
  const [devices, setDevices] = useState<AttendanceDeviceRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  // Create-device form
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [deviceType, setDeviceType] = useState('QR');
  const [vendor, setVendor] = useState('');
  const [model, setModel] = useState('');
  const [protocol, setProtocol] = useState('HTTP_PUSH');
  const [ipAddress, setIpAddress] = useState('');
  const [port, setPort] = useState('');
  const [endpointUrl, setEndpointUrl] = useState('');
  const [location, setLocation] = useState('');
  const [authToken, setAuthToken] = useState('');
  const [commKey, setCommKey] = useState('');

  // Selected device → mappings + manual ingest
  const [selected, setSelected] = useState<AttendanceDeviceRow | null>(null);
  const [mappings, setMappings] = useState<DeviceMappingRow[]>([]);
  const [mapStudentId, setMapStudentId] = useState('');
  const [mapUserId, setMapUserId] = useState('');
  const [mapPersonId, setMapPersonId] = useState('');
  const [mapLabel, setMapLabel] = useState('');
  const [students, setStudents] = useState<StudentSummaryDto[]>([]);

  // Device-event log
  const [logs, setLogs] = useState<DeviceLogRow[]>([]);
  const [logDeviceId, setLogDeviceId] = useState('');
  const [logStatus, setLogStatus] = useState('');

  const allDevices = useMemo(
    () => devices.filter((d) => (statusFilter ? d.status === statusFilter : true) && (typeFilter ? d.deviceType === typeFilter : true)),
    [devices, statusFilter, typeFilter],
  );

  const loadDevices = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: AttendanceDeviceRow[]; total: number }>('/attendance/devices?skip=0&take=100');
      setDevices(res.data);
    } catch (err) {
      onError(loadError(err, 'Failed to load attendance devices.'));
    }
  }, [onError]);

  const loadLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: '0', take: '100' });
      if (logDeviceId) params.set('deviceId', logDeviceId);
      if (logStatus) params.set('status', logStatus);
      const res = await apiFetch<{ data: DeviceLogRow[]; total: number }>(`/attendance/device-logs?${params.toString()}`);
      setLogs(res.data);
    } catch (err) {
      onError(loadError(err, 'Failed to load device event logs.'));
    }
  }, [logDeviceId, logStatus, onError]);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices, reload]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs, reload]);

  useEffect(() => {
    if (!selected) return;
    apiFetch<{ data: DeviceMappingRow[] }>(`/attendance/devices/${selected.id}/mappings`)
      .then((res) => setMappings(res.data))
      .catch(() => setMappings([]));
  }, [selected]);

  useEffect(() => {
    apiFetch<{ data: StudentSummaryDto[]; total: number }>('/students?skip=0&take=500')
      .then((res) => setStudents(res.data))
      .catch(() => setStudents([]));
  }, []);

  const createDevice = async () => {
    setSaving(true);
    try {
      const created = await apiFetch<{ device: AttendanceDeviceRow; authTokenOnce?: string; commKeyOnce?: string }>('/attendance/devices', {
        method: 'POST',
        body: JSON.stringify({
          code,
          name,
          deviceType,
          vendor: vendor || null,
          model: model || null,
          protocol,
          ipAddress: ipAddress || null,
          port: port ? Number(port) : null,
          endpointUrl: endpointUrl || null,
          location: location || null,
          authToken: authToken || undefined,
          commKey: commKey || undefined,
        }),
      });
      setShowForm(false);
      onNotice(
        `Device "${created.device.code}" created.` +
          (created.authTokenOnce ? ` Keep the push token: ${created.authTokenOnce}` : ''),
      );
      onReload();
      setCode('');
      setName('');
      setVendor('');
      setModel('');
      setIpAddress('');
      setPort('');
      setEndpointUrl('');
      setLocation('');
      setAuthToken('');
      setCommKey('');
    } catch (err) {
      onError(loadError(err, 'Failed to create device.'));
    } finally {
      setSaving(false);
    }
  };

  const removeDevice = async (id: string) => {
    if (!window.confirm('Deactivate this device? Its event history is kept.')) return;
    try {
      await apiFetch(`/attendance/devices/${id}`, { method: 'DELETE' });
      onNotice('Device deactivated.');
      if (selected?.id === id) setSelected(null);
      onReload();
    } catch (err) {
      onError(loadError(err, 'Failed to deactivate device.'));
    }
  };

  const syncDevice = async (id: string) => {
    try {
      const res = await apiFetch<{ counts: DeviceCounts }>(`/attendance/devices/${id}/sync`, { method: 'POST', body: '{}' });
      onNotice(`Synced: ${res.counts.received} received, ${res.counts.applied} applied, ${res.counts.duplicate} duplicates.`);
      onReload();
    } catch (err) {
      onError(loadError(err, 'Failed to sync device.'));
    }
  };

  const reconcile = async () => {
    try {
      const res = await apiFetch<{ counts: DeviceCounts }>('/attendance/reconcile', { method: 'POST', body: '{}' });
      onNotice(
        `Reconciled: ${res.counts.received} logs, ${res.counts.applied} applied, ${res.counts.unmapped} unmapped, ${res.counts.error} errors.`,
      );
      onReload();
    } catch (err) {
      onError(loadError(err, 'Failed to reconcile.'));
    }
  };

  const ingestRow = async () => {
    if (!selected || !mapPersonId) {
      onError('Choose a device (panel) and an event person id.');
      return;
    }
    try {
      const res = await apiFetch<{ counts: DeviceCounts }>(`/attendance/devices/${selected.id}/ingest`, {
        method: 'POST',
        body: JSON.stringify({
          events: [
            {
              externalPersonId: mapPersonId,
              capturedAt: new Date().toISOString(),
              eventType: 'IN',
            },
          ],
        }),
      });
      onNotice(`Ingested: ${res.counts.applied} applied, ${res.counts.duplicate} duplicate.`);
      await loadLogs();
      onReload();
    } catch (err) {
      onError(loadError(err, 'Failed to ingest device event.'));
    }
  };

  const upsertMapping = async () => {
    if (!selected) return;
    if (!mapPersonId || (!mapStudentId && !mapUserId)) {
      onError('Provide a person id and pick a student or user.');
      return;
    }
    try {
      await apiFetch(`/attendance/devices/${selected.id}/mappings`, {
        method: 'POST',
        body: JSON.stringify({
          externalPersonId: mapPersonId,
          mappedType: mapStudentId ? 'STUDENT' : 'USER',
          studentId: mapStudentId || undefined,
          userId: mapUserId || undefined,
          label: mapLabel || null,
        }),
      });
      onNotice('Mapping saved.');
      if (selected) {
        const res = await apiFetch<{ data: DeviceMappingRow[] }>(`/attendance/devices/${selected.id}/mappings`);
        setMappings(res.data);
      }
    } catch (err) {
      onError(loadError(err, 'Failed to save mapping.'));
    }
  };

  const removeMapping = async (id: string) => {
    try {
      await apiFetch(`/attendance/devices/mappings/${id}`, { method: 'DELETE' });
      if (selected) {
        const res = await apiFetch<{ data: DeviceMappingRow[] }>(`/attendance/devices/${selected.id}/mappings`);
        setMappings(res.data);
      }
    } catch (err) {
      onError(loadError(err, 'Failed to remove mapping.'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            {DEVICE_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={selectStyle}>
            <option value="">All types</option>
            {DEVICE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          {canManage && <Button onClick={() => setShowForm((s) => !s)}>{showForm ? 'Cancel' : 'Register device'}</Button>}
          {canManage && <Button variant="secondary" onClick={() => void reconcile()}>Reconcile logs</Button>}
        </div>
        <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 8 }}>
          Back-up a device returns one-time provisioning secrets only on create.
        </p>

        {showForm && (
          <div style={{ marginTop: 16, background: '#f9fafb', padding: 16, borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Input placeholder="Device code (unique)" value={code} onChange={(e) => setCode(e.target.value)} style={{ width: 170 }} />
              <Input placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} style={{ width: 200 }} />
              <select value={deviceType} onChange={(e) => setDeviceType(e.target.value)} style={selectStyle}>
                {DEVICE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select value={protocol} onChange={(e) => setProtocol(e.target.value)} style={selectStyle}>
                {DEVICE_PROTOCOLS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Input placeholder="Vendor" value={vendor} onChange={(e) => setVendor(e.target.value)} style={{ width: 150 }} />
              <Input placeholder="Model" value={model} onChange={(e) => setModel(e.target.value)} style={{ width: 150 }} />
              <Input placeholder="IP" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} style={{ width: 130 }} />
              <Input placeholder="Port" type="number" value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 80 }} />
              <Input placeholder="Endpoint URL" value={endpointUrl} onChange={(e) => setEndpointUrl(e.target.value)} style={{ width: 220 }} />
              <Input placeholder="Location" value={location} onChange={(e) => setLocation(e.target.value)} style={{ width: 150 }} />
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Input placeholder="Push token (optional)" value={authToken} onChange={(e) => setAuthToken(e.target.value)} style={{ width: 240 }} />
              <Input placeholder="Vendor comm key (optional)" value={commKey} onChange={(e) => setCommKey(e.target.value)} style={{ width: 240 }} />
              <Button onClick={() => void createDevice()} disabled={saving || !code.trim()}>
                {saving ? 'Registering…' : 'Register device'}
              </Button>
            </div>
          </div>
        )}

        {allDevices.length === 0 && <p style={{ color: '#9ca3af', marginTop: 12 }}>No devices registered.</p>}
        {allDevices.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Code</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Protocol</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Last seen</th>
                  <th style={thStyle}>Maps / logs</th>
                  <th style={thStyle}></th>
                </tr>
              </thead>
              <tbody>
                {allDevices.map((d) => (
                  <tr key={d.id}>
                    <td style={tdStyle}>
                      <button
                        onClick={() => setSelected((s) => (s?.id === d.id ? null : d))}
                        style={{ background: 'none', border: 'none', color: '#1d4ed8', cursor: 'pointer', fontSize: '0.875rem', padding: 0 }}
                      >
                        {d.code}
                      </button>
                    </td>
                    <td style={tdStyle}>{d.name}</td>
                    <td style={tdStyle}>{d.deviceType}{d.vendor ? ` · ${d.vendor}` : ''}</td>
                    <td style={tdStyle}>{d.protocol}</td>
                    <td style={tdStyle}>
                      <span style={{ borderRadius: 999, padding: '0.1rem 0.5rem', ...statusBadge[d.status] }}>{d.status}</span>
                    </td>
                    <td style={tdStyle}>{d.lastSeenAt ? fmtDate(d.lastSeenAt) : '—'}</td>
                    <td style={tdStyle}>{d._count?.mappings ?? 0} / {d._count?.logs ?? 0}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {canManage && (
                          <Button variant="secondary" onClick={() => setLogDeviceId(d.id)}>Logs</Button>
                        )}
                        {canManage && (
                          <Button variant="secondary" onClick={() => void syncDevice(d.id)}>Sync</Button>
                        )}
                        {canManage && (
                          <Button variant="secondary" onClick={() => void removeDevice(d.id)}>Retire</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {selected && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>
              {selected.code} — {selected.name} ({
                selected.location ?? selected.room?.code ?? 'no location'
              })
            </h2>
            <Button variant="secondary" onClick={() => setSelected(null)}>Close panel</Button>
          </div>

          {canUpdate && (
            <div style={{ marginTop: 12, background: '#f9fafb', padding: 12, borderRadius: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Input placeholder="External person id (e.g. FP-0001)" value={mapPersonId} onChange={(e) => setMapPersonId(e.target.value)} style={{ width: 180 }} />
              <select value={mapStudentId ? 's' : mapUserId ? 'u' : ''} onChange={(e) => {
                setMapStudentId('');
                setMapUserId('');
                if (e.target.value === 's' && students[0]) setMapStudentId(students[0].id);
                if (e.target.value === 'u' && (lookups?.faculty[0]?.id)) setMapUserId(lookups.faculty[0].id);
              }} style={selectStyle}>
                <option value="">Map to…</option>
                <option value="s">Student</option>
                <option value="u">User / staff</option>
              </select>
              {mapStudentId && (
                <select value={mapStudentId} onChange={(e) => setMapStudentId(e.target.value)} style={selectStyle}>
                  {students.map((st) => (
                    <option key={st.id} value={st.id}>{st.fullName} ({st.rollNumber ?? st.admissionNumber})</option>
                  ))}
                </select>
              )}
              {mapUserId && (
                <select value={mapUserId} onChange={(e) => setMapUserId(e.target.value)} style={selectStyle}>
                  {(lookups?.faculty ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>
                  ))}
                </select>
              )}
              <Input placeholder="Label (optional)" value={mapLabel} onChange={(e) => setMapLabel(e.target.value)} style={{ width: 150 }} />
              <Button onClick={() => void upsertMapping()}>Add mapping</Button>
              <Button variant="secondary" onClick={() => void ingestRow()}>Quick ingest IN</Button>
            </div>
          )}

          {mappings.length === 0 && <p style={{ color: '#9ca3af', marginTop: 12 }}>No person mappings. Device events for unmapped ids stay UNMAPPED.</p>}
          {mappings.length > 0 && (
            <div style={{ overflowX: 'auto', marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>External id</th>
                    <th style={thStyle}>Maps to</th>
                    <th style={thStyle}>Label</th>
                    <th style={thStyle}>Active</th>
                    <th style={thStyle}></th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id}>
                      <td style={tdStyle}>{m.externalPersonId}</td>
                      <td style={tdStyle}>
                        {m.mappedType === 'STUDENT'
                          ? `${m.student?.fullName ?? 'Student'} (${m.student?.rollNumber ?? m.student?.admissionNumber ?? '—'})`
                          : `${m.user?.fullName ?? 'User'} (${m.user?.email ?? '—'})`}
                      </td>
                      <td style={tdStyle}>{m.label ?? '—'}</td>
                      <td style={tdStyle}>{m.isActive ? 'Yes' : 'No'}</td>
                      <td style={tdStyle}>
                        {canUpdate && (
                          <Button variant="secondary" onClick={() => void removeMapping(m.id)}>Remove</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: 8 }}>
            Push endpoint: POST /attendance/devices/ingest/{selected.code}/events with Authorization: Bearer &lt;push token&gt;
          </p>
        </Card>
      )}

      <Card>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>Device event log</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <select value={logDeviceId} onChange={(e) => setLogDeviceId(e.target.value)} style={selectStyle}>
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.id} value={d.id}>{d.code} — {d.name}</option>
            ))}
          </select>
          <select value={logStatus} onChange={(e) => setLogStatus(e.target.value)} style={selectStyle}>
            <option value="">All statuses</option>
            {DEVICE_LOG_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        {logs.length === 0 && <p style={{ color: '#9ca3af', marginTop: 12 }}>No device events recorded.</p>}
        {logs.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Device</th>
                  <th style={thStyle}>Person</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Captured</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Session</th>
                  <th style={thStyle}>Note</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td style={tdStyle}>{log.device.code}</td>
                    <td style={tdStyle}>
                      {log.student
                        ? `${log.student.fullName} (${log.student.rollNumber ?? '—'})`
                        : log.user
                          ? log.user.fullName
                          : log.externalPersonId ?? '—'}
                    </td>
                    <td style={tdStyle}>{log.eventType}</td>
                    <td style={tdStyle}>{fmtDate(log.capturedAt)} {new Date(log.capturedAt).toISOString().slice(11, 16)}</td>
                    <td style={tdStyle}>
                      <span style={{ borderRadius: 999, padding: '0.1rem 0.5rem', ...statusBadge[log.status] }}>{log.status}</span>
                    </td>
                    <td style={tdStyle}>{log.session ? `${log.session.subjectCode ?? 'Session'} · ${fmtDate(log.session.date)}` : '—'}</td>
                    <td style={tdStyle}>{log.processingNote ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Faculty / staff attendance ──────────────────────────────────────────────

function FacultyTab({
  canCreate,
  canUpdate,
  reload,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  reload: number;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const lookups = useAttendanceLookups();
  const { user } = useAuth();
  const [rows, setRows] = useState<FacultyRow[]>([]);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [fuserId, setFuserId] = useState('');
  const [fdate, setFdate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [checkInAt, setCheckInAt] = useState('');
  const [checkOutAt, setCheckOutAt] = useState('');
  const [fstatus, setFstatus] = useState('PRESENT');
  const [fremarks, setFremarks] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ skip: '0', take: String(TAKE) });
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    return p;
  }, [dateFrom, dateTo]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: FacultyRow[]; total: number }>(`/attendance/faculty?${params.toString()}`);
      setRows(res.data);
    } catch (err) {
      onError(loadError(err, 'Failed to load faculty attendance.'));
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const save = async () => {
    if (!fuserId) {
      onError('Choose a user.');
      return;
    }
    try {
      await apiFetch('/attendance/faculty', {
        method: 'POST',
        body: JSON.stringify({
          userId: fuserId,
          date: fdate,
          checkInAt,
          checkOutAt,
          status: fstatus,
          remarks: fremarks,
        }),
      });
      setShowForm(false);
      onNotice('Faculty attendance saved.');
      await load();
    } catch (err) {
      onError(loadError(err, 'Failed to save faculty attendance.'));
    }
  };

  const selfDefault = user?.id ?? '';

  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ width: 150 }} />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ width: 150 }} />
        {canCreate && (
          <Button onClick={() => { setFuserId(selfDefault); setShowForm((s) => !s); }}>
            {showForm ? 'Cancel' : 'Mark today'}
          </Button>
        )}
      </div>

      {showForm && (
        <div style={{ marginTop: 16, background: '#f9fafb', padding: 16, borderRadius: 8, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={fuserId} onChange={(e) => setFuserId(e.target.value)} style={selectStyle}>
            <option value="">User…</option>
            {(lookups?.faculty ?? []).map((u) => (
              <option key={u.id} value={u.id}>{u.fullName} ({u.email})</option>
            ))}
          </select>
          <Input type="date" value={fdate} onChange={(e) => setFdate(e.target.value)} style={{ width: 150 }} />
          <Input type="time" value={checkInAt} onChange={(e) => setCheckInAt(e.target.value)} style={{ width: 115 }} />
          <Input type="time" value={checkOutAt} onChange={(e) => setCheckOutAt(e.target.value)} style={{ width: 115 }} />
          <select value={fstatus} onChange={(e) => setFstatus(e.target.value)} style={selectStyle}>
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <Input placeholder="Remarks" value={fremarks} onChange={(e) => setFremarks(e.target.value)} style={{ width: 200 }} />
          <Button onClick={() => void save()}>Save</Button>
        </div>
      )}

      {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 12 }}>No faculty attendance records.</p>}
      {rows.length > 0 && (
        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>User</th>
                <th style={thStyle}>Check-in</th>
                <th style={thStyle}>Check-out</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={tdStyle}>{fmtDate(row.date)}</td>
                  <td style={tdStyle}>{row.user?.fullName ?? '—'}</td>
                  <td style={tdStyle}>{row.checkInAt ? new Date(row.checkInAt).toISOString().slice(11, 16) : '—'}</td>
                  <td style={tdStyle}>{row.checkOutAt ? new Date(row.checkOutAt).toISOString().slice(11, 16) : '—'}</td>
                  <td style={tdStyle}>
                    <span style={{ borderRadius: 999, padding: '0.1rem 0.5rem', ...statusBadge[row.status ?? ''] }}>
                      {row.status ?? '—'}
                    </span>
                  </td>
                  <td style={tdStyle}>{row.remarks ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!canUpdate && <p style={{ fontSize: '0.8rem', color: '#9ca3af', marginTop: 8 }}>Requires attendance.update to edit records.</p>}
    </Card>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────

function ReportsTab({ reload, onError }: { reload: number; onError: (msg: string) => void }) {
  const lookups = useAttendanceLookups();
  const [students, setStudents] = useState<StudentSummaryDto[]>([]);
  const [studentId, setStudentId] = useState('');
  const [termId, setTermId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [offeringId, setOfferingId] = useState('');
  const [percentage, setPercentage] = useState<PercentageResp | null>(null);
  const [shortages, setShortages] = useState<ShortageRow[]>([]);
  const [shortageTerms, setShortageTerms] = useState<{ requiredPercent: number; requiredPerSubject: boolean } | null>(null);
  const [summary, setSummary] = useState<SummaryRow[]>([]);

  useEffect(() => {
    apiFetch<{ data: StudentSummaryDto[]; total: number }>('/students?skip=0&take=500')
      .then((res) => setStudents(res.data))
      .catch(() => setStudents([]));
  }, []);

  const loadPercentage = useCallback(async () => {
    if (!studentId) {
      onError('Choose a student first.');
      return;
    }
    try {
      const p = new URLSearchParams({ studentId });
      if (termId) p.set('termId', termId);
      setPercentage(await apiFetch<PercentageResp>(`/attendance/percentage?${p.toString()}`));
    } catch (err) {
      onError(loadError(err, 'Failed to load attendance percentage.'));
    }
  }, [studentId, termId, onError]);

  const loadShortages = useCallback(async () => {
    if (!sectionId && !offeringId) {
      onError('Choose a section or an offering.');
      return;
    }
    try {
      const p = new URLSearchParams();
      if (sectionId) p.set('sectionId', sectionId);
      if (offeringId) p.set('courseOfferingId', offeringId);
      if (termId) p.set('termId', termId);
      const res = await apiFetch<{ data: ShortageRow[]; total: number; requiredPercent: number; requiredPerSubject: boolean }>(
        `/attendance/shortages?${p.toString()}`,
      );
      setShortages(res.data);
      setShortageTerms({ requiredPercent: res.requiredPercent, requiredPerSubject: res.requiredPerSubject });
    } catch (err) {
      onError(loadError(err, 'Failed to load shortage report.'));
    }
  }, [sectionId, offeringId, termId, onError]);

  const loadSummary = useCallback(async () => {
    try {
      const p = new URLSearchParams();
      if (termId) p.set('termId', termId);
      if (sectionId) p.set('sectionId', sectionId);
      if (offeringId) p.set('courseOfferingId', offeringId);
      const res = await apiFetch<{ data: SummaryRow[]; total: number }>(`/attendance/summary?${p.toString()}`);
      setSummary(res.data);
    } catch (err) {
      onError(loadError(err, 'Failed to load attendance summary.'));
    }
  }, [termId, sectionId, offeringId, onError]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, reload]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>Student percentage</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={selectStyle}>
            <option value="">Student…</option>
            {students.map((st) => (
              <option key={st.id} value={st.id}>
                {st.fullName} ({st.rollNumber ?? st.admissionNumber})
              </option>
            ))}
          </select>
          <select value={termId} onChange={(e) => setTermId(e.target.value)} style={selectStyle}>
            <option value="">All terms</option>
            {(lookups?.terms ?? []).map((t) => (
              <option key={t.id} value={t.id}>{t.code ?? t.name ?? t.id}</option>
            ))}
          </select>
          <Button onClick={() => void loadPercentage()}>Load percentage</Button>
        </div>
        {percentage && (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
            {['present', 'late', 'absent', 'leave'].map((key) => (
              <span key={key} style={{ fontSize: '0.9rem' }}>
                <strong>{percentage[key as 'present']}</strong> {key}
              </span>
            ))}
            <span style={{ fontSize: '0.9rem' }}>
              <strong>{percentage.percentage}%</strong> of {percentage.totalSessions} sessions
            </span>
            <span style={{ fontSize: '0.9rem', color: '#6b7280' }}>
              Required {percentage.requiredPercent}% →{' '}
              <span style={{ borderRadius: 999, padding: '0.1rem 0.5rem', ...statusBadge[percentage.status] }}>{percentage.status}</span>
            </span>
          </div>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>Shortage report</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={selectStyle}>
            <option value="">Section…</option>
            {(lookups?.sections ?? []).map((s) => (
              <option key={s.id} value={s.id}>{s.code ?? s.name ?? s.id}</option>
            ))}
          </select>
          <select value={offeringId} onChange={(e) => setOfferingId(e.target.value)} style={selectStyle}>
            <option value="">Offering…</option>
            {(lookups?.offerings ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.course?.code ?? o.code} {o.section ? `· ${o.section.code}` : ''}
              </option>
            ))}
          </select>
          <Button onClick={() => void loadShortages()}>Load shortages</Button>
        </div>
        {shortageTerms && (
          <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 8 }}>
            Required {shortageTerms.requiredPercent}% · Per-subject requirement {shortageTerms.requiredPerSubject ? 'on' : 'off'}
          </p>
        )}
        {shortages.length === 0 && <p style={{ color: '#9ca3af', marginTop: 12 }}>No students below threshold.</p>}
        {shortages.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Student</th>
                  <th style={thStyle}>Section</th>
                  <th style={thStyle}>Present</th>
                  <th style={thStyle}>Total</th>
                  <th style={thStyle}>Percentage</th>
                  <th style={thStyle}>Required</th>
                </tr>
              </thead>
              <tbody>
                {shortages.map((r) => (
                  <tr key={r.studentId}>
                    <td style={tdStyle}>{r.fullName} ({r.rollNumber ?? r.admissionNumber})</td>
                    <td style={tdStyle}>{r.sectionCode ?? '—'}</td>
                    <td style={tdStyle}>{r.present}</td>
                    <td style={tdStyle}>{r.totalSessions}</td>
                    <td style={tdStyle}>{r.percentage}%</td>
                    <td style={tdStyle}>{r.requiredPercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', margin: 0 }}>Subject summary</h2>
        {summary.length === 0 && <p style={{ color: '#9ca3af', marginTop: 12 }}>No closed sessions with records in scope.</p>}
        {summary.length > 0 && (
          <div style={{ overflowX: 'auto', marginTop: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Subject</th>
                  <th style={thStyle}>Sessions</th>
                  <th style={thStyle}>Present</th>
                  <th style={thStyle}>Absent</th>
                  <th style={thStyle}>Late</th>
                  <th style={thStyle}>Leave</th>
                  <th style={thStyle}>Attendance %</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {summary.map((r, i) => (
                  <tr key={i}>
                    <td style={tdStyle}>{r.subjectCode || r.subjectName || 'General'}</td>
                    <td style={tdStyle}>{r.sessions}</td>
                    <td style={tdStyle}>{r.present}</td>
                    <td style={tdStyle}>{r.absent}</td>
                    <td style={tdStyle}>{r.late}</td>
                    <td style={tdStyle}>{r.leave}</td>
                    <td style={tdStyle}>{r.percentage}%</td>
                    <td style={tdStyle}>
                      <span style={{ borderRadius: 999, padding: '0.1rem 0.5rem', ...statusBadge[r.status] }}>{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}