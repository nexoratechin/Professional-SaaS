import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import {
  DAY_LABELS,
  EntryRow,
  HolidayRow,
  TimetableDetail,
  TimetableRow,
  WEEK_DAYS,
  entryLabel,
  fmtDate,
  selectStyle,
  useLookups,
} from './timetable-shared';

export interface MyTabProps {
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}

export function MyTab({ onError }: MyTabProps) {
  const [timetables, setTimetables] = useState<TimetableRow[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<TimetableDetail | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [holidays, setHolidays] = useState<HolidayRow[]>([]);
  const lookups = useLookups();

  const loadTimetables = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: TimetableRow[]; total: number }>('/timetable?status=PUBLISHED&skip=0&take=50');
      setTimetables(res.data);
      if (res.data.length > 0 && !selectedId) setSelectedId(res.data[0]!.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load published timetables.');
    }
  }, [onError, selectedId]);

  useEffect(() => {
    void loadTimetables();
  }, [loadTimetables]);

  useEffect(() => {
    if (!selectedId) return;
    let mounted = true;
    onError(null);
    apiFetch<TimetableDetail>(`/timetable/${selectedId}`)
      .then((d) => {
        if (mounted) setDetail(d);
      })
      .catch((err) => {
        if (mounted) onError(err instanceof Error ? err.message : 'Failed to load timetable.');
      });
    apiFetch<{ data: EntryRow[]; total: number }>(`/timetable/${selectedId}/entries?skip=0&take=500`)
      .then((res) => {
        if (mounted) setEntries(res.data);
      })
      .catch(() => undefined);
    apiFetch<HolidayRow[]>(`/timetable/${selectedId}/holidays`)
      .then((rows) => {
        if (mounted) setHolidays(rows);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [selectedId, onError]);

  const pick = (id: string | undefined, list: { id: string; code?: string | null; name?: string | null }[]): string => {
    const row = list.find((x) => x.id === id);
    return row?.code ?? row?.name ?? '—';
  };

  const working = detail?.workingDays ?? [];
  const holidaySet = useMemo(() => new Set(holidays.map((h) => fmtDate(h.date))), [holidays]);

  return (
    <>
      {timetables.length === 0 && (
        <Card>
          <p style={{ color: '#9ca3af' }}>No published timetables are visible for your role yet.</p>
        </Card>
      )}

      {timetables.length > 0 && (
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <h2 style={{ fontSize: '1rem', margin: 0 }}>Published timetables</h2>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)} style={{ ...selectStyle, minWidth: 260 }}>
              {timetables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}{t.code ? ` (${t.code})` : ''}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => { setSelectedId(''); void loadTimetables(); }}>
              Refresh
            </Button>
          </div>
          {timetables.length > 1 && (
            <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>
              Only timetables you can see (assigned sessions or enrolled sections) appear here.
            </p>
          )}

          {detail && (
            <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 12 }}>
              {detail.name} · {pick(detail.termId, lookups?.terms ?? [])} / {pick(detail.campusId, lookups?.campuses ?? [])} ·{' '}
              {holidaySet.size} holiday(s) · working days: {working.map((d) => DAY_LABELS[d]).join(', ')}
            </p>
          )}
        </Card>
      )}

      {detail && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Week at a glance</h2>
          {entries.length === 0 && <p style={{ color: '#9ca3af' }}>No sessions to show for you.</p>}
          {entries.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: 8 }}>Day</th>
                  <th style={{ padding: 8 }}>Time</th>
                  <th style={{ padding: 8 }}>Session</th>
                  <th style={{ padding: 8 }}>Section</th>
                  <th style={{ padding: 8 }}>Room</th>
                  <th style={{ padding: 8 }}>Faculty</th>
                </tr>
              </thead>
              <tbody>
                {WEEK_DAYS.filter((d) => working.includes(d)).flatMap((d) =>
                  entries
                    .filter((e) => e.dayOfWeek === d)
                    .sort((a, b) => (a.period?.sequence ?? 0) - (b.period?.sequence ?? 0))
                    .map((e) => (
                      <tr key={e.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: 8 }}>{DAY_LABELS[d]}</td>
                        <td style={{ padding: 8 }}>{e.period ? `${e.period.startTime}–${e.period.endTime}` : '—'}</td>
                        <td style={{ padding: 8 }}>{entryLabel(e)}</td>
                        <td style={{ padding: 8 }}>{e.section?.code ?? e.section?.name ?? '—'}</td>
                        <td style={{ padding: 8 }}>{e.room?.code ?? e.room?.name ?? '—'}</td>
                        <td style={{ padding: 8 }}>{e.assignedUser?.fullName ?? '—'}</td>
                      </tr>
                    )),
                )}
                {working.filter((d) => entries.every((e) => e.dayOfWeek !== d)).map((d) => (
                  <tr key={`rest-${d}`} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>{DAY_LABELS[d]}</td>
                    <td style={{ padding: 8, color: '#9ca3af' }}>—</td>
                    <td style={{ padding: 8, color: '#9ca3af' }}>No sessions for you</td>
                    <td style={{ padding: 8 }}>—</td>
                    <td style={{ padding: 8 }}>—</td>
                    <td style={{ padding: 8 }}>—</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}