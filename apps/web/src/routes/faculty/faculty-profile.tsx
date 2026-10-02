import React, { useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { PageShell, apiFetch, usePortalData } from './faculty-shared';

interface FacultyProfile {
  id: string;
  employeeCode: string;
  displayName: string;
  honorific: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  employeeType: string;
  employmentStatus: string;
  department: { id: string; code: string; name: string } | null;
  designation: { id: string; code: string; name: string } | null;
  campus: { id: string; code: string; name: string } | null;
  user: { id: string; email: string; fullName: string; status: string } | null;
  phone: string | null;
  alternatePhone: string | null;
  personalEmail: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  qualification: string | null;
  specialization: string | null;
}

const EDIT_FIELDS = [
  ['phone', 'Phone'],
  ['alternatePhone', 'Alternate phone'],
  ['personalEmail', 'Personal email'],
  ['addressLine1', 'Address line 1'],
  ['addressLine2', 'Address line 2'],
  ['city', 'City'],
  ['state', 'State'],
  ['postalCode', 'Postal code'],
  ['country', 'Country'],
  ['qualification', 'Qualification'],
  ['specialization', 'Specialization'],
] as const;

export function FacultyProfilePage() {
  const { data, error, loading, reload } = usePortalData<FacultyProfile>('/faculty-portal/profile');
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const next: Record<string, string> = {};
    for (const [field] of EDIT_FIELDS) next[field] = (data[field] as string | null) ?? '';
    setForm(next);
  }, [data]);

  const save = async () => {
    setSaving(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch('/faculty-portal/profile', { method: 'PATCH', body: JSON.stringify(form) });
      setNotice('Profile updated.');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title="My Profile"
      subtitle="Update the contact details your institution holds for you."
      error={error ?? actionError}
      notice={notice}
      loading={loading}
      actions={
        <Button onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      }
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Employment</h2>
            <div className="sp-cards">
              <div className="sp-kv"><span>Name</span><span>{data.displayName}</span></div>
              <div className="sp-kv"><span>Employee code</span><span>{data.employeeCode}</span></div>
              <div className="sp-kv"><span>Type</span><span>{data.employeeType}</span></div>
              <div className="sp-kv"><span>Status</span><span>{data.employmentStatus}</span></div>
              <div className="sp-kv"><span>Department</span><span>{data.department?.name ?? '—'}</span></div>
              <div className="sp-kv"><span>Designation</span><span>{data.designation?.name ?? '—'}</span></div>
              <div className="sp-kv"><span>Campus</span><span>{data.campus?.name ?? '—'}</span></div>
              <div className="sp-kv"><span>Login</span><span>{data.user?.email ?? 'Not linked'}</span></div>
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Contact & qualification</h2>
            <div className="sp-cards">
              {EDIT_FIELDS.map(([field, label]) => (
                <Input
                  key={field}
                  label={label}
                  name={field}
                  value={form[field] ?? ''}
                  onChange={(event) => setForm((prev) => ({ ...prev, [field]: event.target.value }))}
                />
              ))}
            </div>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
