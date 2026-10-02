import React from 'react';
import { Card } from '@college-erp/ui';
import { PageShell, StatusBadge, fmtDate } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface Guardian {
  id: string;
  name: string;
  kind: string;
  role: string;
  phone: string | null;
  email: string | null;
  occupation: string | null;
}

interface ChildProfile {
  id: string;
  fullName: string;
  admissionNumber: string;
  rollNumber: string | null;
  registrationNumber: string | null;
  status: string;
  gender: string;
  bloodGroup: string;
  dateOfBirth: string | null;
  nationality: string | null;
  category: string | null;
  email: string | null;
  primaryPhone: string | null;
  currentAddressLine1: string | null;
  currentAddressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  campus: { name: string; code: string } | null;
  program: { name: string; code: string } | null;
  batch: { name: string } | null;
  section: { name: string } | null;
  academicYear: { name: string } | null;
  guardians: Guardian[];
  enrollments: Array<{ id: string; academicYear: { name: string } | null; program: { name: string } | null; section: { name: string } | null; status: string }>;
  holds: Array<{ id: string; type: string; reason: string; status: string }>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="sp-kv">
      <span>{label}</span>
      <span>{value ?? '—'}</span>
    </div>
  );
}

export function ParentProfilePage() {
  const { data, error, loading } = useParentData<ChildProfile>('/parent-portal/profile');

  return (
    <PageShell
      title="Student Profile"
      subtitle="A read-only view of your child's profile."
      error={error}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '1.1rem', margin: 0 }}>{data.fullName}</h2>
              <StatusBadge value={data.status} />
            </div>
            <div style={{ marginTop: 8 }}>
              <Row label="Admission number" value={data.admissionNumber} />
              <Row label="Roll number" value={data.rollNumber} />
              <Row label="Registration number" value={data.registrationNumber} />
              <Row label="Program" value={data.program ? `${data.program.name} (${data.program.code})` : null} />
              <Row label="Campus" value={data.campus?.name} />
              <Row label="Batch / Section" value={`${data.batch?.name ?? '—'} / ${data.section?.name ?? '—'}`} />
              <Row label="Academic year" value={data.academicYear?.name} />
              <Row label="Date of birth" value={fmtDate(data.dateOfBirth)} />
              <Row label="Gender" value={data.gender.replace(/_/g, ' ')} />
              <Row label="Blood group" value={data.bloodGroup.replace(/_/g, ' ')} />
              <Row label="Email" value={data.email} />
              <Row label="Phone" value={data.primaryPhone} />
              <Row
                label="Current address"
                value={[data.currentAddressLine1, data.currentAddressLine2, data.city, data.state, data.postalCode, data.country]
                  .filter(Boolean)
                  .join(', ') || null}
              />
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Guardians</h2>
            {data.guardians.length === 0 ? (
              <p className="sp-muted">No guardians on record.</p>
            ) : (
              data.guardians.map((guardian) => (
                <div key={guardian.id} className="sp-kv">
                  <span>
                    {guardian.name} · {guardian.kind.replace(/_/g, ' ')} ({guardian.role})
                  </span>
                  <span>{[guardian.phone, guardian.email, guardian.occupation].filter(Boolean).join(' · ') || '—'}</span>
                </div>
              ))
            )}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Active holds</h2>
            {data.holds.length === 0 ? (
              <p className="sp-muted">No active holds.</p>
            ) : (
              data.holds.map((hold) => (
                <div key={hold.id} className="sp-kv">
                  <span>{hold.type.replace(/_/g, ' ')}</span>
                  <span>{hold.reason}</span>
                </div>
              ))
            )}
          </Card>
        </div>
      )}
    </PageShell>
  );
}
