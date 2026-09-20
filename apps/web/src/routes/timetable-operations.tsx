import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import { UserIdField, useUsers } from './academics-shared';
import {
  AvailabilityRow,
  DAY_LABELS,
  SubstitutionRow,
  SUBSTITUTION_STATUSES,
  TimetableDetail,
  WEEK_DAYS,
  entryLabel,
  fmtDate,
  selectStyle,
} from './timetable-shared';

export interface OperationsTabProps {
  timetableId: string | null;
  canCreate: boolean;
  canUpdate: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}

export function OperationsTab({ timetableId, canCreate, canUpdate, onError, onNotice }: OperationsTabProps) {
  const [tab, setTab] = useState<'substitutions' | 'availability'>('substitutions');
  const [detail, setDetail] = useState<TimetableDetail | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!timetableId) {
      setDetail(null);
      return;
    }
    apiFetch<TimetableDetail>(`/timetable/${timetableId}`)
      .then((d) => {
        if (mounted) setDetail(d);
      })
      .catch((err) => {
        if (mounted) onError(err instanceof Error ? err.message : 'Failed to load timetable.');
      });
    return () => {
      mounted = false;
    };
  }, [timetableId, onError]);

  if (!timetableId) {
    return (
      <Card>
        <p style={{ color: '#9ca3af' }}>Open a timetable in the Structure tab to manage its substitutions and faculty availability.</p>
      </Card>
    );
  }

  const submittable = detail ? detail.status === 'GENERATED' || detail.status === 'PUBLISHED' : false;

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Button variant="secondary" onClick={() => setTab('substitutions')}>Substitutions</Button>
        <Button variant="secondary" onClick={() => setTab('availability')}>Faculty availability</Button>
        {detail && (
          <span style={{ alignSelf: 'center', fontSize: '0.85rem', color: '#6b7280' }}>
            {detail.status === 'PUBLISHED' ? 'Published — substitutions are the live channel for changes.' : `Status: ${detail.status}`}
          </span>
        )}
      </div>

      {tab === 'substitutions' && (
        <SubstitutionsTab
          timetableId={timetableId}
          submittable={submittable}
          canCreate={canCreate}
          canUpdate={canUpdate}
          onError={onError}
          onNotice={onNotice}
        />
      )}
      {tab === 'availability' && (
        <AvailabilityTab
          termId={detail?.termId}
          campusId={detail?.campusId}
          canCreate={canCreate}
          canUpdate={canUpdate}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

// ── Substitutions ────────────────────────────────────────────────────────────

function SubstitutionsTab({
  timetableId,
  submittable,
  canCreate,
  canUpdate,
  onError,
  onNotice,
}: {
  timetableId: string;
  submittable: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<SubstitutionRow[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [entries, setEntries] = useState<SubstitutionRow['entry'][]>([]);
  const users = useUsers();

  const [entryId, setEntryId] = useState('');
  const [substituteUserId, setSubstituteUserId] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    onError(null);
    try {
      const params = statusFilter ? `?status=${statusFilter}` : '?skip=0&take=200';
      const res = await apiFetch<{ data: SubstitutionRow[]; total: number }>(`/timetable/${timetableId}/substitutions${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load substitutions.');
    }
  }, [timetableId, statusFilter, onError]);

  const loadEntries = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: SubstitutionRow['entry'][]; total: number }>(`/timetable/${timetableId}/entries?skip=0&take=500`);
      setEntries(res.data);
    } catch {
      setEntries([]);
    }
  }, [timetableId]);

  useEffect(() => {
    void load();
    void loadEntries();
  }, [load, loadEntries]);

  const request = async () => {
    if (!entryId || !substituteUserId || !effectiveDate) {
      onError('Entry, substitute, and effective date are required.');
      return;
    }
    try {
      await apiFetch(`/timetable/${timetableId}/substitutions`, {
        method: 'POST',
        body: JSON.stringify({
          entryId,
          substituteUserId,
          effectiveDate,
          reason: reason.trim() || undefined,
        }),
      });
      setEntryId('');
      setSubstituteUserId('');
      setEffectiveDate('');
      setReason('');
      onNotice('Substitution requested.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to request substitution.');
    }
  };

  const decide = async (subId: string, status: 'APPROVED' | 'DECLINED' | 'CANCELLED') => {
    try {
      await apiFetch(`/timetable/${timetableId}/substitutions/${subId}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      onNotice(`Substitution ${status.toLowerCase()}.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update substitution.');
    }
  };

  const canDecide = canUpdate;
  const pending = rows.filter((r) => r.status === 'REQUESTED').length;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Substitutions{pending > 0 ? ` (${pending} pending)` : ''}</h2>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
          <option value="">All statuses</option>
          {SUBSTITUTION_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {submittable && canCreate && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <select value={entryId} onChange={(e) => setEntryId(e.target.value)} style={{ ...selectStyle, minWidth: 260 }}>
            <option value="">Session to cover…</option>
            {entries.map((e) => (
              <option key={e.id} value={e.id}>
                {DAY_LABELS[e.dayOfWeek]} · {e.period ? `${e.period.startTime}–${e.period.endTime}` : ''} · {entryLabel(e)}
              </option>
            ))}
          </select>
          <UserIdField value={substituteUserId} users={users} onChange={setSubstituteUserId} />
          <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} style={{ width: 160 }} />
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" style={{ flex: 1, minWidth: 160 }} />
          <Button onClick={() => void request()}>Request</Button>
        </div>
      )}

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No substitutions.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Effective</th>
              <th style={{ padding: 8 }}>Session</th>
              <th style={{ padding: 8 }}>Substitute</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Reason</th>
              {canDecide && <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{fmtDate(s.effectiveDate)}</td>
                <td style={{ padding: 8 }}>{entryLabel(s.entry)}</td>
                <td style={{ padding: 8 }}>{s.substituteUser.fullName ?? s.substituteUser.email}</td>
                <td style={{ padding: 8 }}>{s.status}</td>
                <td style={{ padding: 8 }}>{s.reason ?? '—'}</td>
                {canDecide && (
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {s.status === 'REQUESTED' && (
                      <>
                        <Button style={{ marginRight: 8 }} onClick={() => void decide(s.id, 'APPROVED')}>Approve</Button>
                        <Button variant="secondary" onClick={() => void decide(s.id, 'DECLINED')}>Decline</Button>
                      </>
                    )}
                    {s.status === 'APPROVED' && (
                      <Button variant="secondary" onClick={() => void decide(s.id, 'CANCELLED')}>Cancel</Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Faculty availability ─────────────────────────────────────────────────────

function AvailabilityTab({
  termId,
  campusId,
  canCreate,
  canUpdate,
  onError,
  onNotice,
}: {
  termId?: string;
  campusId?: string;
  canCreate: boolean;
  canUpdate: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<AvailabilityRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const users = useUsers();

  const [userId, setUserId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [isBlocked, setIsBlocked] = useState(true);
  const [note, setNote] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (termId) p.set('termId', termId);
    if (campusId) p.set('campusId', campusId);
    return p.toString();
  }, [termId, campusId]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: AvailabilityRow[]; total: number }>(`/timetable/availability?${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load availability.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!startTime || !endTime) {
      onError('Start and end times are required.');
      return;
    }
    try {
      await apiFetch('/timetable/availability', {
        method: 'POST',
        body: JSON.stringify({
          userId: userId || undefined,
          termId: termId || undefined,
          campusId: campusId || undefined,
          dayOfWeek,
          startTime,
          endTime,
          isBlocked,
          note: note.trim() || undefined,
        }),
      });
      setShowForm(false);
      setNote('');
      onNotice('Availability block saved.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save availability block.');
    }
  };

  const toggleActive = async (id: string, current: boolean) => {
    try {
      await apiFetch(`/timetable/availability/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !current }),
      });
      onNotice('Availability block toggled.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update availability block.');
    }
  };

  const remove = async (id: string) => {
    try {
      await apiFetch(`/timetable/availability/${id}`, { method: 'DELETE' });
      onNotice('Availability block deleted.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete availability block.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Faculty availability blocks</h2>
        {canCreate && <Button onClick={() => setShowForm((s) => !s)}>Add block</Button>}
      </div>

      {showForm && canCreate && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <UserIdField value={userId} users={users} onChange={setUserId} />
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} style={selectStyle}>
            {WEEK_DAYS.map((d) => (
              <option key={d} value={d}>{DAY_LABELS[d]}</option>
            ))}
          </select>
          <Input value={startTime} onChange={(e) => setStartTime(e.target.value)} placeholder="Start HH:MM" style={{ width: 120 }} />
          <Input value={endTime} onChange={(e) => setEndTime(e.target.value)} placeholder="End HH:MM" style={{ width: 120 }} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
            <input type="checkbox" checked={isBlocked} onChange={(e) => setIsBlocked(e.target.checked)} />
            Blocked (unavailable)
          </label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" style={{ flex: 1, minWidth: 160 }} />
          <Button onClick={() => void create()}>Save</Button>
        </div>
      )}

      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No availability blocks.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Faculty</th>
              <th style={{ padding: 8 }}>Day</th>
              <th style={{ padding: 8 }}>Window</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Note</th>
              <th style={{ padding: 8 }}>Active</th>
              {canUpdate && <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{a.user?.fullName ?? a.user?.email ?? a.userId}</td>
                <td style={{ padding: 8 }}>{DAY_LABELS[a.dayOfWeek]}</td>
                <td style={{ padding: 8 }}>{a.startTime}–{a.endTime}</td>
                <td style={{ padding: 8 }}>{a.isBlocked ? 'Blocked' : 'Available'}</td>
                <td style={{ padding: 8 }}>{a.note ?? '—'}</td>
                <td style={{ padding: 8, color: a.isActive ? '#15803d' : '#9ca3af' }}>{a.isActive ? 'Active' : 'Inactive'}</td>
                {canUpdate && (
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void toggleActive(a.id, a.isActive)}>
                      {a.isActive ? 'Deactivate' : 'Activate'}
                    </Button>
                    <Button variant="secondary" onClick={() => void remove(a.id)}>Delete</Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}