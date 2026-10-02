import React from 'react';
import { Card } from '@college-erp/ui';
import { DataTable, PageShell, Stat, StatusBadge, fmtDate, usePortalData, type Column } from './faculty-shared';

interface WorkloadRow {
  id: string;
  workloadType: string;
  title: string;
  description: string | null;
  hoursPerWeek: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  isActive: boolean;
  term: { id: string; code: string; name: string } | null;
}

interface WorkloadResponse {
  workloads: WorkloadRow[];
  total: number;
  summary: {
    weeklyClasses: number;
    teachingHoursPerWeek: number;
    declaredHoursPerWeek: number;
    totalHoursPerWeek: number;
    invigilationDuties: number;
  };
  byType: Record<string, number>;
}

export function FacultyWorkloadPage() {
  const { data, error, loading } = usePortalData<WorkloadResponse>('/faculty-portal/workload');

  const columns: Column<WorkloadRow>[] = [
    { label: 'Type', render: (row) => row.workloadType.replace(/_/g, ' ') },
    { label: 'Title', render: (row) => row.title },
    { label: 'Term', render: (row) => row.term?.name ?? '—' },
    { label: 'Hours / week', render: (row) => row.hoursPerWeek },
    { label: 'From', render: (row) => fmtDate(row.effectiveFrom) },
    { label: 'To', render: (row) => fmtDate(row.effectiveTo) },
    { label: 'Active', render: (row) => <StatusBadge value={row.isActive ? 'ACTIVE' : 'INACTIVE'} /> },
  ];

  return (
    <PageShell
      title="Workload"
      subtitle="Declared duties plus timetable-derived teaching load and invigilation."
      error={error}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Weekly classes" value={data.summary.weeklyClasses} />
            <Stat label="Teaching hours / week" value={`${data.summary.teachingHoursPerWeek}h`} />
            <Stat label="Declared hours / week" value={`${data.summary.declaredHoursPerWeek}h`} />
            <Stat label="Total load / week" value={`${data.summary.totalHoursPerWeek}h`} />
            <Stat label="Invigilation duties" value={data.summary.invigilationDuties} />
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Declared workload by type</h2>
            {Object.keys(data.byType).length === 0 ? (
              <p className="sp-muted">No declared workload records.</p>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {Object.entries(data.byType).map(([type, hours]) => (
                  <li key={type}>
                    {type.replace(/_/g, ' ')}: <strong>{Math.round(hours * 100) / 100}h / week</strong>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Workload records</h2>
            <DataTable columns={columns} rows={data.workloads} rowKey={(row) => row.id} empty="No workload records." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
