import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import { UserIdField, useUsers } from './academics-shared';
import {
  ConflictRow,
  DAY_LABELS,
  ENTRY_TYPES,
  EntryRow,
  HolidayRow,
  HistoryRow,
  Lookups,
  PeriodRow,
  TimetableDetail,
  TimetableRow,
  TIMETABLE_STATUSES,
  WEEK_DAYS,
  entryLabel,
  fmtDate,
  selectStyle,
  useLookups,
} from './timetable-shared';

export interface StructureTabProps {
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  canPublish: boolean;
  activeId: string | null;
  onSelectActive: (id: string) => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}

export function StructureTab({
  canCreate,
  canUpdate,
  canManage,
  canPublish,
  activeId,
  onSelectActive,
  onError,
  onNotice,
}: StructureTabProps) {
  const [rows, setRows] = useState<TimetableRow[]>([]);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [detail, setDetail] = useState<TimetableDetail | null>(null);
  const lookups = useLookups();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [termId, setTermId] = useState('');
  const [campusId, setCampusId] = useState('');
  const [workingDays, setWorkingDays] = useState<string>('1,2,3,4,5');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (q) p.set('search', q);
    if (statusFilter) p.set('status', statusFilter);
    return p.toString();
  }, [q, statusFilter]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: TimetableRow[]; total: number }>(`/timetable?${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load timetables.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadDetail = useCallback(
    async (id: string) => {
      try {
        setDetail(await apiFetch<TimetableDetail>(`/timetable/${id}`));
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load timetable detail.');
      }
    },
    [onError],
  );

  useEffect(() => {
    if (activeId) void loadDetail(activeId);
  }, [activeId, loadDetail]);

  const refresh = useCallback(async () => {
    void load();
    if (activeId) await loadDetail(activeId);
  }, [load, loadDetail, activeId]);

  const create = async () => {
    if (!name.trim() || !termId || !campusId) {
      onError('Name, term, and campus are required.');
      return;
    }
    try {
      const created = await apiFetch<TimetableDetail>('/timetable', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim() || undefined,
          termId,
          campusId,
          workingDays: workingDays
            .split(',')
            .map((s) => Number(s.trim()))
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
        }),
      });
      setShowForm(false);
      setName('');
      setCode('');
      setTermId('');
      setCampusId('');
      onNotice('Timetable created.');
      onError(null);
      onSelectActive(created.id);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create timetable.');
    }
  };

  const pickTerm = (termId: string | undefined): string => {
    const term = lookups?.terms.find((t) => t.id === termId);
    return term?.code ?? term?.name ?? '—';
  };
  const pickCampus = (campusId: string | undefined): string => {
    const campus = lookups?.campuses.find((c) => c.id === campusId);
    return campus?.code ?? campus?.name ?? '—';
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Weekly timetables</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name/code" style={{ minWidth: 200 }} />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
              <option value="">All statuses</option>
              {TIMETABLE_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New timetable</Button>}
          </div>
        </div>

        {showForm && canCreate && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ flex: 1, minWidth: 180 }} />
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code (optional)" style={{ width: 150 }} />
            <select value={termId} onChange={(e) => setTermId(e.target.value)} style={selectStyle}>
              <option value="">Term…</option>
              {lookups?.terms.map((t) => (
                <option key={t.id} value={t.id}>{t.code ?? t.name}{t.isCurrent ? ' (current)' : ''}</option>
              ))}
            </select>
            <select value={campusId} onChange={(e) => setCampusId(e.target.value)} style={selectStyle}>
              <option value="">Campus…</option>
              {lookups?.campuses.map((c) => (
                <option key={c.id} value={c.id}>{c.code ?? c.name}</option>
              ))}
            </select>
            <Input value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} placeholder="Days, e.g. 1,2,3,4,5" style={{ width: 170 }} />
            <Button onClick={() => void create()}>Save</Button>
          </div>
        )}

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No timetables yet.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Term / campus</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Sessions</th>
                <th style={{ padding: 8 }}>Periods</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb', background: activeId === t.id ? '#eff6ff' : undefined }}>
                  <td style={{ padding: 8 }}>{t.name} {t.code ? <span style={{ color: '#6b7280' }}>({t.code})</span> : null}</td>
                  <td style={{ padding: 8 }}>
                    {pickTerm(t.termId)} / {pickCampus(t.campusId)}
                  </td>
                  <td style={{ padding: 8 }}>{t.status}</td>
                  <td style={{ padding: 8 }}>{t._count?.entries ?? 0}</td>
                  <td style={{ padding: 8 }}>{t._count?.periods ?? 0}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => { onSelectActive(t.id); setQ(''); }}>
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {activeId && (
        <DetailWorkspace
          detail={detail}
          lookups={lookups}
          activeId={activeId}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canManage={canManage}
          canPublish={canPublish}
          pickCampus={pickCampus}
          pickTerm={pickTerm}
          onChangeName={async (nameValue) => {
            try {
              await apiFetch(`/timetable/${activeId}`, { method: 'PATCH', body: JSON.stringify({ name: nameValue }) });
              onNotice('Timetable updated.');
              onError(null);
              await refresh();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to update timetable.');
            }
          }}
          onChangeWorkingDays={async (days) => {
            try {
              await apiFetch(`/timetable/${activeId}`, { method: 'PATCH', body: JSON.stringify({ workingDays: days }) });
              onNotice('Working days updated.');
              onError(null);
              await refresh();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to update working days.');
            }
          }}
          onGenerate={async (offeringIds) => {
            try {
              const res = await apiFetch<{ placed: number; generated: number; failed: number; total: number }>(
                `/timetable/${activeId}/generate`,
                { method: 'POST', body: JSON.stringify(offeringIds?.length ? { offeringIds } : {}) },
              );
              onNotice(`Generated: ${res.placed} placed, ${res.failed} unplaced.`);
              onError(null);
              await refresh();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to generate timetable.');
            }
          }}
          onPublish={async () => {
            try {
              await apiFetch(`/timetable/${activeId}/publish`, { method: 'POST' });
              onNotice('Timetable published.');
              onError(null);
              await refresh();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to publish timetable.');
            }
          }}
          onArchive={async () => {
            try {
              await apiFetch(`/timetable/${activeId}/archive`, { method: 'POST' });
              onNotice('Timetable archived.');
              onError(null);
              await refresh();
            } catch (err) {
              onError(err instanceof Error ? err.message : 'Failed to archive timetable.');
            }
          }}
        />
      )}
    </>
  );
}

interface DetailWorkspaceProps {
  detail: TimetableDetail | null;
  lookups: Lookups | null;
  activeId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  canPublish: boolean;
  pickTerm: (id: string | undefined) => string;
  pickCampus: (id: string | undefined) => string;
  onChangeName: (name: string) => Promise<void>;
  onChangeWorkingDays: (days: number[]) => Promise<void>;
  onGenerate: (offeringIds?: string[]) => Promise<void>;
  onPublish: () => Promise<void>;
  onArchive: () => Promise<void>;
}

function DetailWorkspace({
  detail,
  lookups,
  activeId,
  canCreate,
  canUpdate,
  canManage,
  canPublish,
  pickTerm,
  pickCampus,
  onChangeName,
  onChangeWorkingDays,
  onGenerate,
  onPublish,
  onArchive,
}: DetailWorkspaceProps) {
  const [tab, setTab] = useState<'grid' | 'periods' | 'holidays' | 'conflicts' | 'history'>('grid');
  const [workingDaysText, setWorkingDaysText] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (detail) setWorkingDaysText(detail.workingDays.join(','));
  }, [detail]);

  if (!detail) return <Card><p style={{ color: '#9ca3af' }}>Loading timetable…</p></Card>;

  const editable = detail.status === 'DRAFT' || detail.status === 'GENERATED';
  const submittable = detail.status === 'GENERATED' || detail.status === 'PUBLISHED';

  const showError = (msg: string | null) => setError(msg);
  const showNotice = (msg: string | null) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(null), 3500);
  };

  const saveDays = async () => {
    const days = workingDaysText
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
    if (days.length === 0) {
      showError('Enter at least one working day (0–6).');
      return;
    }
    await onChangeWorkingDays(days);
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <h2 style={{ fontSize: '1rem' }}>{detail.name} {detail.code ? <span style={{ color: '#6b7280' }}>({detail.code})</span> : null}</h2>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
              {pickTerm(detail.termId)} · {pickCampus(detail.campusId)} · status {detail.status}
              {detail.publishedBy ? ` · published by ${detail.publishedBy.fullName}` : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              {detail.entryCount} sessions · {detail.periods.length} periods · {detail.substitutionCount} substitutions ·{' '}
              <span style={{ color: detail.unresolvedConflictCount > 0 ? '#b91c1c' : '#15803d' }}>
                {detail.unresolvedConflictCount} open conflicts
              </span>
            </span>
          </div>
        </div>

        {editable && canUpdate && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center', padding: 12, background: '#f9fafb', borderRadius: 8 }}>
            <Input
              defaultValue={detail.name}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) void onChangeName(e.currentTarget.value.trim());
              }}
              placeholder="Rename"
              style={{ minWidth: 180 }}
            />
            <Input value={workingDaysText} onChange={(e) => setWorkingDaysText(e.target.value)} placeholder="Working days, e.g. 1,2,3,4,5" style={{ width: 200 }} />
            <Button variant="secondary" onClick={() => void saveDays()}>Save working days</Button>
            {canManage && (
              <Button variant="secondary" onClick={() => void onGenerate()}>Generate</Button>
            )}
            {canPublish && (
              <Button onClick={() => void onPublish()}>Publish</Button>
            )}
            {canPublish && (
              <Button variant="secondary" onClick={() => void onArchive()}>Archive</Button>
            )}
          </div>
        )}
      </Card>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={() => setTab('grid')}>Session grid</Button>
        <Button variant="secondary" onClick={() => setTab('periods')}>Periods</Button>
        <Button variant="secondary" onClick={() => setTab('holidays')}>Holidays</Button>
        <Button variant="secondary" onClick={() => setTab('conflicts')}>Conflicts</Button>
        <Button variant="secondary" onClick={() => setTab('history')}>History</Button>
      </div>

      {tab === 'grid' && (
        <GridTab
          activeId={activeId}
          detail={detail}
          lookups={lookups}
          canCreate={canCreate && editable}
          canUpdate={canUpdate && editable}
          onError={showError}
          onNotice={showNotice}
        />
      )}
      {tab === 'periods' && (
        <PeriodsTab
          activeId={activeId}
          periods={detail.periods}
          canUpdate={canUpdate && editable}
          onError={showError}
          onNotice={showNotice}
        />
      )}
      {tab === 'holidays' && (
        <HolidaysTab
          activeId={activeId}
          canCreate={canCreate && editable}
          canUpdate={canUpdate && editable}
          onError={showError}
          onNotice={showNotice}
        />
      )}
      {tab === 'conflicts' && (
        <ConflictsTab
          activeId={activeId}
          canManage={canManage}
          onError={showError}
          onNotice={showNotice}
        />
      )}
      {tab === 'history' && (
        <HistoryTab activeId={activeId} onError={showError} />
      )}

      {submittable && (
        <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>
          {detail.status === 'GENERATED' ? 'Generate updates will replace all sessions.' : ''}{' '}
          {finalNote(detail.status)}
        </p>
      )}
    </>
  );
}

function finalNote(status: string): string {
  if (status === 'PUBLISHED') return 'Published timetables are read-only — request substitutions instead of editing sessions.';
  if (status === 'ARCHIVED') return 'This timetable is archived.';
  return '';
}

// ── Session grid ─────────────────────────────────────────────────────────────

function GridTab({
  activeId,
  detail,
  lookups,
  canCreate,
  canUpdate,
  onError,
  onNotice,
}: {
  activeId: string;
  detail: TimetableDetail;
  lookups: Lookups | null;
  canCreate: boolean;
  canUpdate: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const users = useUsers();

  const [periodId, setPeriodId] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState<number>(1);
  const [courseOfferingId, setCourseOfferingId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [assignedUserId, setAssignedUserId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [entryType, setEntryType] = useState('');
  const [title, setTitle] = useState('');

  const offeringOptions = useMemo(
    () =>
      lookups?.offerings.filter(
        (o) => o.termId === detail.termId && (!o.campusId || o.campusId === detail.campusId),
      ) ?? [],
    [lookups, detail.termId, detail.campusId],
  );

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: EntryRow[]; total: number }>(`/timetable/${activeId}/entries?skip=0&take=500`);
      setEntries(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load sessions.');
    }
  }, [activeId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!offeringOptions.length) return;
    const first = offeringOptions[0]!;
    setCourseOfferingId(first.id);
    setSectionId(first.section?.id ?? '');
    const sameCampusRooms = lookups?.rooms.filter((r) => r.campusId === detail.campusId);
    if (sameCampusRooms && sameCampusRooms.length > 0) setRoomId(sameCampusRooms[0]!.id);
  }, [offeringOptions, lookups, detail.campusId]);

  const create = async () => {
    if (!periodId) {
      onError('Pick a period.');
      return;
    }
    try {
      await apiFetch(`/timetable/${activeId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          periodId,
          dayOfWeek,
          courseOfferingId: courseOfferingId || undefined,
          sectionId: sectionId || undefined,
          assignedUserId: assignedUserId || undefined,
          roomId: roomId || undefined,
          entryType: entryType || undefined,
          title: title.trim() || undefined,
        }),
      });
      setShowForm(false);
      setTitle('');
      onNotice('Session added.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add session.');
    }
  };

  const updateEntry = async (entryId: string, patch: Record<string, unknown>) => {
    try {
      await apiFetch(`/timetable/${activeId}/entries/${entryId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      onNotice('Session updated.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update session.');
    }
  };

  const removeEntry = async (entryId: string) => {
    try {
      await apiFetch(`/timetable/${activeId}/entries/${entryId}`, { method: 'DELETE' });
      onNotice('Session deleted.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete session.');
    }
  };

  const working = detail.workingDays;
  const showDay = (d: number): boolean => working.includes(d);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Session grid</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {canCreate && <Button onClick={() => setShowForm((s) => !s)}>Add session</Button>}
        </div>
      </div>

      {showForm && canCreate && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <select value={dayOfWeek} onChange={(e) => setDayOfWeek(Number(e.target.value))} style={selectStyle}>
            {WEEK_DAYS.filter(showDay).map((d) => (
              <option key={d} value={d}>{DAY_LABELS[d]}</option>
            ))}
          </select>
          <select value={periodId} onChange={(e) => setPeriodId(e.target.value)} style={selectStyle}>
            <option value="">Period…</option>
            {detail.periods.filter((p) => p.isActive).map((p) => (
              <option key={p.id} value={p.id}>
                {p.sequence}. {p.startTime}–{p.endTime}{p.isBreak ? ' (break)' : ''}
              </option>
            ))}
          </select>
          <select value={courseOfferingId} onChange={(e) => setCourseOfferingId(e.target.value)} style={{ ...selectStyle, minWidth: 220 }}>
            <option value="">No offering</option>
            {offeringOptions.map((o) => (
              <option key={o.id} value={o.id}>{o.code} — {o.course.name}</option>
            ))}
          </select>
          <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={selectStyle}>
            <option value="">No section</option>
            {lookups?.sections.map((s) => (
              <option key={s.id} value={s.id}>{s.code ?? s.name}</option>
            ))}
          </select>
          <UserIdField value={assignedUserId} users={users} onChange={setAssignedUserId} />
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ ...selectStyle, minWidth: 160 }}>
            <option value="">No room</option>
            {lookups?.rooms.filter((r) => r.campusId === detail.campusId).map((r) => (
              <option key={r.id} value={r.id}>{r.code ?? r.name} ({r.roomType})</option>
            ))}
          </select>
          <select value={entryType} onChange={(e) => setEntryType(e.target.value)} style={selectStyle}>
            <option value="">Auto type</option>
            {ENTRY_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" style={{ width: 170 }} />
          <Button onClick={() => void create()}>Add</Button>
        </div>
      )}

      {entries.length === 0 && <p style={{ color: '#9ca3af' }}>No sessions yet — add one, or press Generate.</p>}
      {entries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Day</th>
              <th style={{ padding: 8 }}>Period</th>
              <th style={{ padding: 8 }}>Session</th>
              <th style={{ padding: 8 }}>Section</th>
              <th style={{ padding: 8 }}>Room</th>
              <th style={{ padding: 8 }}>Faculty</th>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{DAY_LABELS[e.dayOfWeek]}</td>
                <td style={{ padding: 8 }}>{e.period ? `${e.period.sequence}. ${e.period.startTime}–${e.period.endTime}` : '—'}</td>
                <td style={{ padding: 8 }}>{entryLabel(e)}</td>
                <td style={{ padding: 8 }}>{e.section?.code ?? e.section?.name ?? '—'}</td>
                <td style={{ padding: 8 }}>{e.room?.code ?? e.room?.name ?? '—'}</td>
                <td style={{ padding: 8 }}>{e.assignedUser?.fullName ?? '—'}</td>
                <td style={{ padding: 8 }}>{e.entryType}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canUpdate && <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void updateEntry(e.id, { dayOfWeek: e.dayOfWeek === 6 ? 0 : e.dayOfWeek + 1 })}>Shift day</Button>}
                  {canUpdate && <Button variant="secondary" onClick={() => void removeEntry(e.id)}>Remove</Button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Periods ──────────────────────────────────────────────────────────────────

function PeriodsTab({
  activeId,
  periods,
  canUpdate,
  onError,
  onNotice,
}: {
  activeId: string;
  periods: PeriodRow[];
  canUpdate: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [local, setLocal] = useState<PeriodRow[]>([]);

  useEffect(() => {
    setLocal(periods.map((p) => ({ ...p })));
  }, [periods]);

  const mutate = (id: string, patch: Partial<PeriodRow>) => {
    setLocal((rows) => rows.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const addPeriod = () => {
    const next = Math.max(0, ...local.map((p) => p.sequence)) + 1;
    setLocal((rows) => [...rows, { id: `new-${Date.now()}`, sequence: next, startTime: '09:00', endTime: '10:00', isBreak: false, isActive: true }]);
  };

  const removePeriod = (id: string) => {
    setLocal((rows) => rows.filter((p) => p.id !== id));
  };

  const save = async () => {
    const sorted = [...local].sort((a, b) => a.sequence - b.sequence);
    const periodsPayload = sorted.map((p) => ({
      sequence: p.sequence,
      startTime: p.startTime,
      endTime: p.endTime,
      isBreak: p.isBreak,
      isActive: p.isActive,
    }));
    try {
      await apiFetch(`/timetable/${activeId}/periods`, { method: 'PUT', body: JSON.stringify({ periods: periodsPayload }) });
      onNotice('Period grid saved.');
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save period grid.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Period grid (weekday × period)</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <Button variant="secondary" onClick={addPeriod}>Add period</Button>
          {canUpdate && <Button onClick={() => void save()}>Save grid</Button>}
        </div>
      </div>
      <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>The grid is shared across all working days. Saving replaces every period and clears all sessions.</p>
      {local.length === 0 && <p style={{ color: '#9ca3af' }}>No periods defined.</p>}
      {local.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>#</th>
              <th style={{ padding: 8 }}>Start</th>
              <th style={{ padding: 8 }}>End</th>
              <th style={{ padding: 8 }}>Break</th>
              <th style={{ padding: 8 }}>Active</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {local.map((p) => (
              <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{p.sequence}</td>
                <td style={{ padding: 8 }}>
                  <Input value={p.startTime} onChange={(e) => mutate(p.id, { startTime: e.target.value })} style={{ width: 90 }} />
                </td>
                <td style={{ padding: 8 }}>
                  <Input value={p.endTime} onChange={(e) => mutate(p.id, { endTime: e.target.value })} style={{ width: 90 }} />
                </td>
                <td style={{ padding: 8 }}>
                  <input type="checkbox" checked={p.isBreak} onChange={(e) => mutate(p.id, { isBreak: e.target.checked })} />
                </td>
                <td style={{ padding: 8 }}>
                  <input type="checkbox" checked={p.isActive} onChange={(e) => mutate(p.id, { isActive: e.target.checked })} />
                </td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  <Button variant="secondary" onClick={() => void removePeriod(p.id)}>Remove</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Holidays ─────────────────────────────────────────────────────────────────

function HolidaysTab({
  activeId,
  canCreate,
  canUpdate,
  onError,
  onNotice,
}: {
  activeId: string;
  canCreate: boolean;
  canUpdate: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    onError(null);
    try {
      setRows(await apiFetch<HolidayRow[]>(`/timetable/${activeId}/holidays`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load holidays.');
    }
  }, [activeId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!date || !name.trim()) {
      onError('Date and name are required.');
      return;
    }
    try {
      await apiFetch(`/timetable/${activeId}/holidays`, { method: 'POST', body: JSON.stringify({ date, name: name.trim() }) });
      setDate('');
      setName('');
      onNotice('Holiday added.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add holiday.');
    }
  };

  const remove = async (holidayId: string) => {
    try {
      await apiFetch(`/timetable/${activeId}/holidays/${holidayId}`, { method: 'DELETE' });
      onNotice('Holiday removed.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to remove holiday.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Holidays (non-teaching days)</h2>
        {canCreate && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ width: 160 }} />
            <Button onClick={() => void create()}>Add holiday</Button>
          </div>
        )}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No holidays.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Date</th>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Description</th>
              {canUpdate && <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{fmtDate(h.date)}</td>
                <td style={{ padding: 8 }}>{h.name}</td>
                <td style={{ padding: 8 }}>{h.description ?? '—'}</td>
                {canUpdate && (
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" onClick={() => void remove(h.id)}>Remove</Button>
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

// ── Conflicts ────────────────────────────────────────────────────────────────

function ConflictsTab({
  activeId,
  canManage,
  onError,
  onNotice,
}: {
  activeId: string;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<ConflictRow[]>([]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: ConflictRow[]; total: number }>(`/timetable/${activeId}/conflicts?skip=0&take=100`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load conflicts.');
    }
  }, [activeId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const recheck = async () => {
    try {
      const res = await apiFetch<{ detected: number; conflicts: unknown[] }>(`/timetable/${activeId}/conflicts/recheck`, { method: 'POST' });
      onNotice(`Recheck complete: ${res.detected} conflict(s) found.`);
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to recheck conflicts.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Scheduling conflicts</h2>
        {canManage && <Button variant="secondary" onClick={() => void recheck()}>Recheck sweep</Button>}
      </div>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No conflicts recorded.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Type</th>
              <th style={{ padding: 8 }}>Day</th>
              <th style={{ padding: 8 }}>Description</th>
              <th style={{ padding: 8 }}>Source</th>
              <th style={{ padding: 8 }}>Detected</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{c.conflictType}</td>
                <td style={{ padding: 8 }}>{DAY_LABELS[c.dayOfWeek]}</td>
                <td style={{ padding: 8 }}>{c.description}</td>
                <td style={{ padding: 8 }}>{c.source}</td>
                <td style={{ padding: 8 }}>{fmtDate(c.detectedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── History ──────────────────────────────────────────────────────────────────

function HistoryTab({ activeId, onError }: { activeId: string; onError: (msg: string | null) => void }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);

  useEffect(() => {
    onError(null);
    apiFetch<{ data: HistoryRow[]; total: number }>(`/timetable/${activeId}/history?skip=0&take=100`)
      .then((res) => setRows(res.data))
      .catch((err) => onError(err instanceof Error ? err.message : 'Failed to load history.'));
  }, [activeId, onError]);

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Change history</h2>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No history yet.</p>}
      {rows.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>When</th>
              <th style={{ padding: 8 }}>Action</th>
              <th style={{ padding: 8 }}>Description</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((h) => (
              <tr key={h.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{fmtDate(h.createdAt)}</td>
                <td style={{ padding: 8 }}>{h.action}</td>
                <td style={{ padding: 8 }}>{h.description ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}