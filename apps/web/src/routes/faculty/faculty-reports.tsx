import React from 'react';
import { Card } from '@college-erp/ui';
import { DataTable, PageShell, Stat, StatusBadge, fmtDate, fmtDateTime, usePortalData, type Column } from './faculty-shared';

interface ReportOffering {
  id: string;
  code: string;
  course: { code: string; name: string };
  section: { code: string; name: string } | null;
  term: { code: string; name: string } | null;
  studentCount: number;
}

interface AttendanceGroup {
  subjectCode: string;
  subjectName: string;
  sessions: number;
  present: number;
  late: number;
  absent: number;
  leave: number;
  totalMarked: number;
  attended: number;
  percentage: number;
  requiredPercent: number;
  status: string;
}

interface ReportPaper {
  id: string;
  course: { code: string; name: string };
  session: { name: string; code: string; examType: string };
  examDate: string | null;
  maxMarks: number;
  passMarks: number;
  entered: number;
}

interface ReportsResponse {
  offerings: ReportOffering[];
  attendance: { data: AttendanceGroup[]; total: number };
  papers: ReportPaper[];
  marks: Array<{ status: string; count: number }>;
  leave: Array<{ status: string; count: number }>;
  generatedAt: string;
}

export function FacultyReportsPage() {
  const { data, error, loading } = usePortalData<ReportsResponse>('/faculty-portal/reports/overview');

  const totalStudents = data?.offerings.reduce((sum, offering) => sum + offering.studentCount, 0) ?? 0;
  const totalEntered = data?.papers.reduce((sum, paper) => sum + paper.entered, 0) ?? 0;

  const attendanceColumns: Column<AttendanceGroup>[] = [
    { label: 'Subject', render: (row) => row.subjectCode || row.subjectName || '—' },
    { label: 'Sessions', render: (row) => row.sessions },
    { label: 'Marked', render: (row) => row.totalMarked },
    { label: 'Present', render: (row) => row.present + row.late },
    { label: 'Absent', render: (row) => row.absent },
    { label: 'Leave', render: (row) => row.leave },
    { label: '%', render: (row) => `${row.percentage}%` },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
  ];

  const paperColumns: Column<ReportPaper>[] = [
    { label: 'Course', render: (row) => `${row.course.code} — ${row.course.name}` },
    { label: 'Session', render: (row) => `${row.session.name} (${row.session.examType})` },
    { label: 'Date', render: (row) => fmtDate(row.examDate) },
    { label: 'Max / Pass', render: (row) => `${row.maxMarks} / ${row.passMarks}` },
    { label: 'Entered', render: (row) => row.entered },
  ];

  return (
    <PageShell
      title="Reports"
      subtitle="Faculty-scoped summaries for your offerings, attendance, marks and leave."
      error={error}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Offerings" value={data.offerings.length} />
            <Stat label="Students" value={totalStudents} />
            <Stat label="Papers" value={data.papers.length} />
            <Stat label="Marks entered" value={totalEntered} />
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Offerings</h2>
            <DataTable
              columns={[
                { label: 'Course', render: (row: ReportOffering) => `${row.course.code} — ${row.course.name}` },
                { label: 'Offering', render: (row: ReportOffering) => row.code },
                { label: 'Section', render: (row: ReportOffering) => row.section?.name ?? '—' },
                { label: 'Term', render: (row: ReportOffering) => row.term?.name ?? '—' },
                { label: 'Students', render: (row: ReportOffering) => row.studentCount },
              ]}
              rows={data.offerings}
              rowKey={(row) => row.id}
              empty="No offerings."
            />
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Attendance by subject</h2>
            <DataTable columns={attendanceColumns} rows={data.attendance.data} rowKey={(row) => row.subjectCode || row.subjectName} empty="No attendance recorded." />
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Papers & marks progress</h2>
            <DataTable columns={paperColumns} rows={data.papers} rowKey={(row) => row.id} empty="No papers assigned." />
          </Card>

          <div className="sp-cards">
            <Card>
              <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Marks by status</h2>
              {data.marks.length === 0 ? (
                <p className="sp-muted">No marks entered.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {data.marks.map((row) => (
                    <li key={row.status}>
                      {row.status}: <strong>{row.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Leave</h2>
              {data.leave.length === 0 ? (
                <p className="sp-muted">No leave applications.</p>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {data.leave.map((row) => (
                    <li key={row.status}>
                      {row.status}: <strong>{row.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <span className="sp-muted">Generated {fmtDateTime(data.generatedAt)}.</span>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
