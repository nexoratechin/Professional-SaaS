import React, { useState } from 'react';
import { Card, Input } from '@college-erp/ui';
import { DataTable, PageShell, StatusBadge, usePortalData, fmtDate, type Column } from './faculty-shared';

interface StudentRow {
  id: string;
  status: string;
  enrolledAt: string;
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
    rollNumber: string | null;
    status: string;
  };
  courseOffering: {
    id: string;
    code: string;
    course: { code: string; name: string };
    section: { id: string; code: string; name: string } | null;
    term: { id: string; code: string; name: string } | null;
  };
}

interface OfferingOption {
  id: string;
  code: string;
  course: { code: string; name: string };
  section: { id: string; code: string; name: string } | null;
  term: { id: string; code: string; name: string } | null;
}

export function FacultyStudentsPage() {
  const [offeringId, setOfferingId] = useState('');
  const [search, setSearch] = useState('');

  const params = new URLSearchParams();
  if (offeringId) params.set('courseOfferingId', offeringId);
  if (search.trim()) params.set('search', search.trim());
  const path = `/faculty-portal/students${params.toString() ? `?${params.toString()}` : ''}`;
  const { data, error, loading } = usePortalData<{ students: StudentRow[]; total: number; offerings: OfferingOption[] }>(path);

  const columns: Column<StudentRow>[] = [
    { label: 'Roll no.', render: (row) => row.student.rollNumber ?? '—' },
    { label: 'Admission no.', render: (row) => row.student.admissionNumber },
    { label: 'Name', render: (row) => row.student.fullName },
    { label: 'Section', render: (row) => row.courseOffering.section?.name ?? '—' },
    { label: 'Course', render: (row) => `${row.courseOffering.course.code} (${row.courseOffering.code})` },
    { label: 'Term', render: (row) => row.courseOffering.term?.name ?? '—' },
    { label: 'Enrolled', render: (row) => fmtDate(row.enrolledAt) },
    { label: 'Status', render: (row) => <StatusBadge value={row.student.status} /> },
  ];

  return (
    <PageShell
      title="Students"
      subtitle="Rosters for the course offerings you are assigned to. Only your offerings are searchable."
      error={error}
      loading={loading}
      actions={
        <div className="sp-actions">
          <label className="sp-row">
            <span className="sp-muted">Course offering</span>
            <select
              value={offeringId}
              onChange={(event) => setOfferingId(event.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}
            >
              <option value="">All my offerings</option>
              {(data?.offerings ?? []).map((offering) => (
                <option key={offering.id} value={offering.id}>
                  {offering.course.code} · {offering.code}
                  {offering.section ? ` · ${offering.section.name}` : ''}
                </option>
              ))}
            </select>
          </label>
          <Input label="Search" name="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name / roll / admission" />
        </div>
      }
    >
      {data && (
        <Card>
          <DataTable columns={columns} rows={data.students} rowKey={(row) => row.id} empty="No students found." />
        </Card>
      )}
    </PageShell>
  );
}
