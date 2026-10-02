import React from 'react';
import { Card } from '@college-erp/ui';
import { DAY_NAMES, PageShell, Stat, StatusBadge, fmtDate, usePortalData } from './faculty-shared';

interface TimetableEntry {
  id: string;
  dayOfWeek: number;
  entryType: string;
  title: string | null;
  period: { id: string; sequence: number; startTime: string; endTime: string; isBreak: boolean };
  room: { id: string; code: string; name: string } | null;
  section: { id: string; code: string; name: string } | null;
  timetable: { id: string; name: string; status: string };
  courseOffering: {
    id: string;
    code: string;
    course: { code: string; name: string };
    term: { code: string; name: string } | null;
  } | null;
}

interface Substitution {
  id: string;
  effectiveDate: string;
  status: string;
  reason: string | null;
  timetable: { id: string; name: string };
  entry: {
    period: { sequence: number; startTime: string; endTime: string };
    section: { name: string } | null;
    courseOffering: { course: { code: string; name: string } } | null;
  };
}

export function FacultyTimetablePage() {
  const { data, error, loading } = usePortalData<{ entries: TimetableEntry[]; substitutions: Substitution[]; total: number }>(
    '/faculty-portal/timetable',
  );

  const byDay = new Map<number, TimetableEntry[]>();
  for (const entry of data?.entries ?? []) {
    const list = byDay.get(entry.dayOfWeek) ?? [];
    list.push(entry);
    byDay.set(entry.dayOfWeek, list);
  }
  const teachingDays = [...byDay.keys()].sort((a, b) => a - b);

  return (
    <PageShell
      title="My Timetable"
      subtitle="Published weekly classes assigned to you, plus confirmed substitutions."
      error={error}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Weekly classes" value={data.total} />
            <Stat label="Teaching days" value={teachingDays.length} />
            <Stat label="Upcoming substitutions" value={data.substitutions.length} />
          </div>

          {teachingDays.length === 0 && <Card>No published timetable entries assigned to you.</Card>}

          {teachingDays.map((day) => (
            <Card key={day}>
              <h2 style={{ fontSize: '1rem', marginTop: 0 }}>{DAY_NAMES[day] ?? `Day ${day}`}</h2>
              <div className="sp-table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Period</th>
                      <th style={{ padding: 8 }}>Time</th>
                      <th style={{ padding: 8 }}>Course</th>
                      <th style={{ padding: 8 }}>Section</th>
                      <th style={{ padding: 8 }}>Room</th>
                      <th style={{ padding: 8 }}>Type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(byDay.get(day) ?? []).map((entry) => (
                      <tr key={entry.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: 8 }}>{entry.period.sequence}</td>
                        <td style={{ padding: 8 }}>
                          {entry.period.startTime}–{entry.period.endTime}
                        </td>
                        <td style={{ padding: 8 }}>
                          {entry.courseOffering ? `${entry.courseOffering.course.code} — ${entry.courseOffering.course.name}` : entry.title ?? '—'}
                        </td>
                        <td style={{ padding: 8 }}>{entry.section?.name ?? '—'}</td>
                        <td style={{ padding: 8 }}>{entry.room?.name ?? '—'}</td>
                        <td style={{ padding: 8 }}>{entry.entryType}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}

          {data.substitutions.length > 0 && (
            <Card>
              <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Substitutions</h2>
              <div className="sp-table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Date</th>
                      <th style={{ padding: 8 }}>Period</th>
                      <th style={{ padding: 8 }}>Course</th>
                      <th style={{ padding: 8 }}>Section</th>
                      <th style={{ padding: 8 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.substitutions.map((substitution) => (
                      <tr key={substitution.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: 8 }}>{fmtDate(substitution.effectiveDate)}</td>
                        <td style={{ padding: 8 }}>
                          P{substitution.entry.period.sequence} ({substitution.entry.period.startTime}–{substitution.entry.period.endTime})
                        </td>
                        <td style={{ padding: 8 }}>
                          {substitution.entry.courseOffering
                            ? `${substitution.entry.courseOffering.course.code} — ${substitution.entry.courseOffering.course.name}`
                            : '—'}
                        </td>
                        <td style={{ padding: 8 }}>{substitution.entry.section?.name ?? '—'}</td>
                        <td style={{ padding: 8 }}>
                          <StatusBadge value={substitution.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      )}
    </PageShell>
  );
}
