import React from 'react';
import { Card } from '@college-erp/ui';
import { Column, DataTable, PageShell, Stat, StatusBadge, fmtDate } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface ResultProcess {
  id: string;
  state: string;
  standing: string | null;
  subjectCount: number | null;
  passedCount: number | null;
  aggregatePercent: number | null;
  gpa: number | null;
  cgpa: number | null;
  creditsEarned: number | null;
  creditsAttempted: number | null;
  publishedAt: string | null;
  session: { name: string; code: string; program: { name: string } | null; term: { name: string } | null };
}

interface SubjectResult {
  id: string;
  subjectCode: string;
  subjectName: string;
  maxMarks: number;
  obtainedMarks: number | null;
  grade: string | null;
  gradePoint: number | null;
  percentage: number | null;
  outcome: string;
  publishedAt: string | null;
  exam: { name: string; examType: string } | null;
}

interface ResultsResponse {
  processes: ResultProcess[];
  subjectResults: SubjectResult[];
  summary: { publishedSubjects: number; publishedSessions: number };
}

export function ParentResultsPage() {
  const { data, error, loading } = useParentData<ResultsResponse>('/parent-portal/results');

  const processColumns: Column<ResultProcess>[] = [
    { label: 'Session', render: (row) => row.session.name },
    { label: 'Term', render: (row) => row.session.term?.name ?? '—' },
    { label: 'State', render: (row) => <StatusBadge value={row.state} /> },
    { label: 'Standing', render: (row) => (row.standing ? <StatusBadge value={row.standing} /> : '—') },
    { label: 'Subjects', render: (row) => `${row.passedCount ?? 0} passed / ${row.subjectCount ?? 0}` },
    { label: 'Aggregate %', render: (row) => (row.aggregatePercent === null ? '—' : `${row.aggregatePercent}%`) },
    { label: 'GPA / CGPA', render: (row) => `${row.gpa ?? '—'} / ${row.cgpa ?? '—'}` },
    { label: 'Credits', render: (row) => `${row.creditsEarned ?? 0}/${row.creditsAttempted ?? 0}` },
    { label: 'Published', render: (row) => fmtDate(row.publishedAt) },
  ];

  const subjectColumns: Column<SubjectResult>[] = [
    { label: 'Subject', render: (row) => `${row.subjectCode} — ${row.subjectName}` },
    { label: 'Exam', render: (row) => row.exam?.name ?? '—' },
    { label: 'Marks', render: (row) => `${row.obtainedMarks ?? '—'} / ${row.maxMarks}` },
    { label: 'Grade', render: (row) => row.grade ?? '—' },
    { label: 'Grade point', render: (row) => row.gradePoint ?? '—' },
    { label: 'Percentage', render: (row) => (row.percentage === null ? '—' : `${row.percentage}%`) },
    { label: 'Outcome', render: (row) => <StatusBadge value={row.outcome} /> },
  ];

  return (
    <PageShell title="Results" subtitle="Published results and academic standing." error={error} loading={loading}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Published sessions" value={data.summary.publishedSessions} />
            <Stat label="Published subjects" value={data.summary.publishedSubjects} />
          </div>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Session results</h2>
            <DataTable columns={processColumns} rows={data.processes} rowKey={(row) => row.id} empty="No published session results yet." />
          </Card>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Subject-wise results</h2>
            <DataTable columns={subjectColumns} rows={data.subjectResults} rowKey={(row) => row.id} empty="No published subject results yet." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
