import React from 'react';
import { Card } from '@college-erp/ui';
import { PageShell, Stat, StatusBadge, fmtDate, fmtDateTime, usePortalData } from './faculty-shared';

interface Academics {
  courses: Array<{ assignmentId: string; role: string; offering: { code: string; course: { code: string; name: string } } }>;
  invigilation: Array<{
    id: string;
    role: string;
    room: { id: string; code: string; name: string } | null;
    subject: { course: { code: string; name: string }; session: { name: string; examType: string } };
  }>;
  advising: Array<{
    id: string;
    sessionType: string;
    summary: string;
    status: string;
    priority: string;
    createdAt: string;
    student: { id: string; fullName: string; admissionNumber: string; rollNumber: string | null };
    term: { id: string; code: string; name: string } | null;
  }>;
  calendar: Array<{
    id: string;
    title: string;
    description: string | null;
    startAt: string;
    endAt: string;
    eventType: string;
    appliesTo: string | null;
    academicYear: { id: string; name: string } | null;
    term: { id: string; code: string; name: string } | null;
  }>;
}

export function FacultyAcademicsPage() {
  const { data, error, loading } = usePortalData<Academics>('/faculty-portal/academics');

  return (
    <PageShell
      title="Assignments & Academic Information"
      subtitle="Your teaching assignments, examination duties, advising load and the academic calendar."
      error={error}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Teaching assignments" value={data.courses.length} />
            <Stat label="Invigilation duties" value={data.invigilation.length} />
            <Stat label="Open advising sessions" value={data.advising.filter((record) => record.status === 'OPEN').length} />
            <Stat label="Calendar events" value={data.calendar.length} />
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Teaching assignments</h2>
            {data.courses.length === 0 ? (
              <p className="sp-muted">No teaching assignments.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {data.courses.map((course) => (
                  <li key={course.assignmentId}>
                    {course.offering.course.code} — {course.offering.course.name}{' '}
                    <span className="sp-muted">({course.role.replace(/_/g, ' ')})</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Examination duties</h2>
            {data.invigilation.length === 0 ? (
              <p className="sp-muted">No invigilation duties assigned.</p>
            ) : (
              <div className="sp-table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Course</th>
                      <th style={{ padding: 8 }}>Session</th>
                      <th style={{ padding: 8 }}>Role</th>
                      <th style={{ padding: 8 }}>Room</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.invigilation.map((duty) => (
                      <tr key={duty.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: 8 }}>{`${duty.subject.course.code} — ${duty.subject.course.name}`}</td>
                        <td style={{ padding: 8 }}>{duty.subject.session.name}</td>
                        <td style={{ padding: 8 }}>{duty.role.replace(/_/g, ' ')}</td>
                        <td style={{ padding: 8 }}>{duty.room?.name ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Advising & counselling</h2>
            {data.advising.length === 0 ? (
              <p className="sp-muted">No advising sessions recorded.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.advising.map((record) => (
                  <div key={record.id} style={{ borderLeft: '3px solid #cbd5e1', paddingLeft: 10 }}>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <strong>{record.student.fullName}</strong>
                      <StatusBadge value={record.status} />
                      <StatusBadge value={record.priority} />
                      <span className="sp-muted">{record.sessionType.replace(/_/g, ' ')}</span>
                    </div>
                    <div>{record.summary}</div>
                    <div className="sp-muted">
                      {record.term?.name ?? '—'} · {fmtDateTime(record.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Academic calendar</h2>
            {data.calendar.length === 0 ? (
              <p className="sp-muted">No published calendar events.</p>
            ) : (
              <div className="sp-table-wrap">
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Event</th>
                      <th style={{ padding: 8 }}>Type</th>
                      <th style={{ padding: 8 }}>Starts</th>
                      <th style={{ padding: 8 }}>Ends</th>
                      <th style={{ padding: 8 }}>Applies to</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.calendar.map((event) => (
                      <tr key={event.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: 8 }}>
                          {event.title}
                          {event.description ? <div className="sp-muted">{event.description}</div> : null}
                        </td>
                        <td style={{ padding: 8 }}>{event.eventType}</td>
                        <td style={{ padding: 8 }}>{fmtDate(event.startAt)}</td>
                        <td style={{ padding: 8 }}>{fmtDate(event.endAt)}</td>
                        <td style={{ padding: 8 }}>{event.appliesTo ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </PageShell>
  );
}
