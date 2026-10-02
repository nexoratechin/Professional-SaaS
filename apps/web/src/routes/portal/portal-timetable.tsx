import React from 'react';
import { Card } from '@college-erp/ui';
import { PageShell, usePortalData } from './portal-shared';

interface TimetableEntry {
  id: string;
  dayOfWeek: number;
  periodId: string;
  entryType: string;
  title: string | null;
  room: { id: string; name: string; code: string } | null;
  assignedUser: { id: string; fullName: string } | null;
  courseOffering: {
    id: string;
    code: string;
    course: { id: string; code: string; name: string };
    faculty: Array<{ user: { id: string; fullName: string } }>;
  } | null;
}

interface TimetablePeriod {
  id: string;
  sequence: number;
  startTime: string;
  endTime: string;
  isBreak: boolean;
}

interface TimetableResponse {
  timetable: { id: string; name: string; code: string | null; workingDays: unknown } | null;
  periods: TimetablePeriod[];
  entries: TimetableEntry[];
}

const DAY_NAMES: Record<number, string> = {
  0: 'Sun',
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
};

function workingDaysOf(value: unknown): number[] {
  if (Array.isArray(value)) {
    const days = value.filter((day): day is number => typeof day === 'number');
    if (days.length) return days;
  }
  return [1, 2, 3, 4, 5];
}

function entryLabel(entry: TimetableEntry): string {
  if (entry.courseOffering) {
    return `${entry.courseOffering.course.code} — ${entry.courseOffering.course.name}`;
  }
  return entry.title ?? entry.entryType;
}

export function PortalTimetablePage() {
  const { data, error, loading } = usePortalData<TimetableResponse>('/student-portal/timetable');

  return (
    <PageShell
      title="Timetable"
      subtitle={data?.timetable ? `${data.timetable.name}${data.timetable.code ? ` (${data.timetable.code})` : ''}` : 'Your published weekly schedule.'}
      error={error}
      loading={loading}
    >
      {data && !data.timetable && <Card>No published timetable is available for your section yet.</Card>}
      {data && data.timetable && (
        <Card>
          <div className="sp-table-wrap">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: 640 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                  <th style={{ padding: 8, whiteSpace: 'nowrap' }}>Period</th>
                  {workingDaysOf(data.timetable.workingDays).map((day) => (
                    <th key={day} style={{ padding: 8 }}>
                      {DAY_NAMES[day] ?? `Day ${day}`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.periods.map((period) => (
                  <tr key={period.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8, whiteSpace: 'nowrap', fontWeight: 600 }}>
                      {period.startTime}–{period.endTime}
                      {period.isBreak && <div className="sp-muted">Break</div>}
                    </td>
                    {workingDaysOf(data.timetable?.workingDays).map((day) => {
                      const entry = data.entries.find((item) => item.periodId === period.id && item.dayOfWeek === day);
                      if (period.isBreak || !entry) {
                        return <td key={day} style={{ padding: 8, color: '#cbd5e1' }}>—</td>;
                      }
                      const faculty = entry.courseOffering?.faculty ?? [];
                      const teacher = entry.assignedUser?.fullName ?? faculty[0]?.user.fullName;
                      return (
                        <td key={day} style={{ padding: 8, verticalAlign: 'top' }}>
                          <div style={{ fontWeight: 600 }}>{entryLabel(entry)}</div>
                          {teacher && <div className="sp-muted">{teacher}</div>}
                          {entry.room && <div className="sp-muted">Room {entry.room.code || entry.room.name}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </PageShell>
  );
}
