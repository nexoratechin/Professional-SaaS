import React from 'react';
import { Card } from '@college-erp/ui';
import { Column, DataTable, PageShell, StatusBadge, fmtDate, usePortalData } from './portal-shared';

interface Registration {
  id: string;
  status: string;
  enrolledAt: string;
  term: { id: string; name: string } | null;
  courseOffering: {
    id: string;
    code: string;
    course: { code: string; name: string; creditHours: number; courseType: string };
    faculty: Array<{ user: { fullName: string } }>;
  };
}

interface Enrollment {
  id: string;
  status: string;
  semester: number | null;
  rollNumber: string | null;
  enrolledAt: string | null;
  academicYear: { name: string };
  term: { name: string } | null;
  program: { name: string; code: string };
  section: { name: string } | null;
}

interface CoursesResponse {
  registrations: Registration[];
  enrollments: Enrollment[];
}

export function PortalCoursesPage() {
  const { data, error, loading } = usePortalData<CoursesResponse>('/student-portal/courses');

  const registrationColumns: Column<Registration>[] = [
    { label: 'Code', render: (row) => row.courseOffering.course.code },
    { label: 'Course', render: (row) => row.courseOffering.course.name },
    { label: 'Term', render: (row) => row.term?.name ?? '—' },
    { label: 'Credits', render: (row) => row.courseOffering.course.creditHours },
    { label: 'Type', render: (row) => row.courseOffering.course.courseType },
    {
      label: 'Faculty',
      render: (row) => row.courseOffering.faculty.map((faculty) => faculty.user.fullName).join(', ') || '—',
    },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Enrolled', render: (row) => fmtDate(row.enrolledAt) },
  ];

  const enrollmentColumns: Column<Enrollment>[] = [
    { label: 'Academic year', render: (row) => row.academicYear.name },
    { label: 'Term', render: (row) => row.term?.name ?? '—' },
    { label: 'Program', render: (row) => `${row.program.name} (${row.program.code})` },
    { label: 'Semester', render: (row) => row.semester ?? '—' },
    { label: 'Section', render: (row) => row.section?.name ?? '—' },
    { label: 'Roll no.', render: (row) => row.rollNumber ?? '—' },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
  ];

  return (
    <PageShell title="Courses" subtitle="Your registrations and enrollment history." error={error} loading={loading}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Current registrations</h2>
            <DataTable
              columns={registrationColumns}
              rows={data.registrations}
              rowKey={(row) => row.id}
              empty="No course registrations yet."
            />
          </Card>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Enrollment history</h2>
            <DataTable
              columns={enrollmentColumns}
              rows={data.enrollments}
              rowKey={(row) => row.id}
              empty="No enrollment records yet."
            />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
