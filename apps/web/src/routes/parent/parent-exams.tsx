import React from 'react';
import { Card } from '@college-erp/ui';
import { PageShell, StatusBadge, fmtDate } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface ExamSubject {
  id: string;
  maxMarks: number;
  passMarks: number;
  examDate: string | null;
  startTime: string | null;
  endTime: string | null;
  course: { id: string; code: string; name: string };
  room: { id: string; name: string } | null;
}

interface ExamRegistration {
  id: string;
  status: string;
  registeredAt: string;
  session: {
    id: string;
    name: string;
    code: string;
    examType: string;
    status: string;
    startDate: string | null;
    endDate: string | null;
    subjects: ExamSubject[];
  };
  hallTicket: { id: string; ticketNumber: string; status: string } | null;
}

interface ExamsResponse {
  registrations: ExamRegistration[];
}

export function ParentExamsPage() {
  const { data, error, loading } = useParentData<ExamsResponse>('/parent-portal/exams');

  return (
    <PageShell title="Examinations" subtitle="Registered sessions, papers and hall tickets." error={error} loading={loading}>
      {data && data.registrations.length === 0 && <Card>Your child is not registered for any examination session.</Card>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.registrations.map((registration) => (
            <Card key={registration.id}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <h2 style={{ fontSize: '1rem', margin: 0 }}>{registration.session.name}</h2>
                  <div className="sp-muted">
                    {registration.session.code} · {registration.session.examType.replace(/_/g, ' ')} ·{' '}
                    {fmtDate(registration.session.startDate)} – {fmtDate(registration.session.endDate)}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <StatusBadge value={registration.status} />
                  {registration.hallTicket ? (
                    <span className="sp-muted">Hall ticket {registration.hallTicket.ticketNumber} ({registration.hallTicket.status})</span>
                  ) : (
                    <span className="sp-muted">Hall ticket pending</span>
                  )}
                </div>
              </div>
              <div className="sp-table-wrap" style={{ marginTop: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                      <th style={{ padding: 8 }}>Paper</th>
                      <th style={{ padding: 8 }}>Date</th>
                      <th style={{ padding: 8 }}>Time</th>
                      <th style={{ padding: 8 }}>Room</th>
                      <th style={{ padding: 8 }}>Marks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registration.session.subjects.map((subject) => (
                      <tr key={subject.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                        <td style={{ padding: 8 }}>{subject.course.code} — {subject.course.name}</td>
                        <td style={{ padding: 8 }}>{fmtDate(subject.examDate)}</td>
                        <td style={{ padding: 8 }}>{subject.startTime ?? '—'}{subject.endTime ? ` – ${subject.endTime}` : ''}</td>
                        <td style={{ padding: 8 }}>{subject.room?.name ?? '—'}</td>
                        <td style={{ padding: 8 }}>{subject.maxMarks} (pass {subject.passMarks})</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      )}
    </PageShell>
  );
}
