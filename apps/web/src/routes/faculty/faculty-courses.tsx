import React from 'react';
import { Card } from '@college-erp/ui';
import { DataTable, PageShell, Stat, StatusBadge, usePortalData, type Column } from './faculty-shared';

interface AssignedCourse {
  assignmentId: string;
  role: string;
  allocationPercent: number | null;
  studentCount: number;
  offering: {
    id: string;
    code: string;
    status: string;
    course: { id: string; code: string; name: string; creditHours: number; courseType: string };
    term: { id: string; code: string; name: string } | null;
    section: { id: string; code: string; name: string } | null;
    program: { id: string; code: string; name: string } | null;
  };
}

export function FacultyCoursesPage() {
  const { data, error, loading } = usePortalData<{ courses: AssignedCourse[]; total: number }>('/faculty-portal/courses');

  const columns: Column<AssignedCourse>[] = [
    { label: 'Course', render: (row) => `${row.offering.course.code} — ${row.offering.course.name}` },
    { label: 'Offering', render: (row) => row.offering.code },
    { label: 'Term', render: (row) => row.offering.term?.name ?? '—' },
    { label: 'Section', render: (row) => row.offering.section?.name ?? '—' },
    { label: 'Program', render: (row) => row.offering.program?.name ?? '—' },
    { label: 'Credits', render: (row) => row.offering.course.creditHours },
    { label: 'Role', render: (row) => row.role.replace(/_/g, ' ') },
    { label: 'Students', render: (row) => row.studentCount },
    { label: 'Status', render: (row) => <StatusBadge value={row.offering.status} /> },
  ];

  const totalStudents = data?.courses.reduce((sum, course) => sum + course.studentCount, 0) ?? 0;

  return (
    <PageShell
      title="My Courses"
      subtitle="Course offerings you are assigned to teach. Access to these rosters is enforced by the API."
      error={error}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Assigned offerings" value={data.total} />
            <Stat label="Students across courses" value={totalStudents} />
          </div>
          <Card>
            <DataTable columns={columns} rows={data.courses} rowKey={(row) => row.assignmentId} empty="No course assignments yet." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
