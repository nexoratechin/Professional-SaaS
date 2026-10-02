import React, { useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { PageShell, StatusBadge, apiFetch, fmtDate, usePortalData } from './portal-shared';

interface Guardian {
  id: string;
  name: string;
  kind: string;
  role: string;
  phone: string | null;
  email: string | null;
  occupation: string | null;
}

interface Profile {
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
  alternateEmail: string | null;
  primaryPhone: string | null;
  alternatePhone: string | null;
  currentAddressLine1: string | null;
  currentAddressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  permanentAddressLine1: string | null;
  permanentAddressLine2: string | null;
  permanentCity: string | null;
  permanentState: string | null;
  permanentPostalCode: string | null;
  permanentCountry: string | null;
  profilePhotoKey: string | null;
  campus: { name: string; code: string } | null;
  program: { name: string; code: string } | null;
  batch: { name: string } | null;
  section: { name: string } | null;
  academicYear: { name: string } | null;
  guardians: Guardian[];
  holds: Array<{ id: string; type: string; reason: string; status: string }>;
}

const EDITABLE_FIELDS: Array<{ key: keyof Profile; label: string }> = [
  { key: 'email', label: 'Email' },
  { key: 'alternateEmail', label: 'Alternate email' },
  { key: 'primaryPhone', label: 'Primary phone' },
  { key: 'alternatePhone', label: 'Alternate phone' },
  { key: 'currentAddressLine1', label: 'Current address line 1' },
  { key: 'currentAddressLine2', label: 'Current address line 2' },
  { key: 'city', label: 'City' },
  { key: 'state', label: 'State' },
  { key: 'postalCode', label: 'Postal code' },
  { key: 'country', label: 'Country' },
  { key: 'permanentAddressLine1', label: 'Permanent address line 1' },
  { key: 'permanentAddressLine2', label: 'Permanent address line 2' },
  { key: 'permanentCity', label: 'Permanent city' },
  { key: 'permanentState', label: 'Permanent state' },
  { key: 'permanentPostalCode', label: 'Permanent postal code' },
  { key: 'permanentCountry', label: 'Permanent country' },
];

function valueOf(profile: Profile, key: keyof Profile): string {
  const value = profile[key];
  return typeof value === 'string' ? value : '';
}

function ReadOnly({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="sp-kv">
      <span>{label}</span>
      <span>{value ?? '—'}</span>
    </div>
  );
}

export function PortalProfilePage() {
  const { data, error, loading, reload } = usePortalData<Profile>('/student-portal/profile');
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const field of EDITABLE_FIELDS) next[field.key as string] = valueOf(data, field.key);
    setForm(next);
  }, [data]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setNotice(null);
    try {
      await apiFetch('/student-portal/profile', { method: 'PATCH', body: JSON.stringify(form) });
      setNotice('Profile updated.');
      await reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="My Profile"
      subtitle="Keep your contact details up to date."
      error={error ?? saveError}
      notice={notice}
      loading={loading}
      actions={
        <Button onClick={save} disabled={saving || !data}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      }
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {data.holds.length > 0 && (
            <Card style={{ borderColor: '#fca5a5', background: '#fef2f2' }}>
              <strong>Active hold{data.holds.length > 1 ? 's' : ''}</strong>
              <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                {data.holds.map((hold) => (
                  <li key={hold.id}>
                    {hold.type.replace(/_/g, ' ')} — {hold.reason}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Academic identity</h2>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <ReadOnly label="Full name" value={data.fullName} />
              <ReadOnly label="Admission number" value={data.admissionNumber} />
              <ReadOnly label="Roll number" value={data.rollNumber} />
              <ReadOnly label="Registration number" value={data.registrationNumber} />
              <ReadOnly label="Status" value={<StatusBadge value={data.status} />} />
              <ReadOnly label="Program" value={data.program ? `${data.program.name} (${data.program.code})` : '—'} />
              <ReadOnly label="Campus" value={data.campus?.name ?? '—'} />
              <ReadOnly label="Batch / Section" value={`${data.batch?.name ?? '—'} / ${data.section?.name ?? '—'}`} />
              <ReadOnly label="Academic year" value={data.academicYear?.name ?? '—'} />
              <ReadOnly label="Date of birth" value={fmtDate(data.dateOfBirth)} />
              <ReadOnly label="Gender / Blood group" value={`${data.gender.replace(/_/g, ' ')} / ${data.bloodGroup.replace(/_/g, ' ')}`} />
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Contact details</h2>
            <div className="sp-cards">
              {EDITABLE_FIELDS.map((field) => (
                <Input
                  key={field.key as string}
                  label={field.label}
                  name={field.key as string}
                  value={form[field.key as string] ?? ''}
                  onChange={(event) => setForm((prev) => ({ ...prev, [field.key as string]: event.target.value }))}
                />
              ))}
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Guardians</h2>
            {data.guardians.length === 0 ? (
              <p className="sp-muted">No guardians on record.</p>
            ) : (
              <div className="sp-cards">
                {data.guardians.map((guardian) => (
                  <div key={guardian.id} className="sp-stat">
                    <div style={{ fontWeight: 600 }}>{guardian.name}</div>
                    <div className="sp-muted">
                      {guardian.kind.replace(/_/g, ' ')} · {guardian.role.replace(/_/g, ' ')}
                    </div>
                    <div className="sp-muted">{guardian.phone ?? '—'} · {guardian.email ?? '—'}</div>
                    {guardian.occupation && <div className="sp-muted">{guardian.occupation}</div>}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}
    </PageShell>
  );
}
