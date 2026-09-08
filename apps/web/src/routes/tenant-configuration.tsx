import React, { useCallback, useEffect, useState } from 'react';
import type { TenantConfigurationResponseDto } from '@college-erp/types';
import { Button, Card } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';

const CONFIG_VIEW = 'tenant.config.view';
const CONFIG_MANAGE = 'tenant.config.manage';

/** Tenant configuration engine UI. Loads the tenant's JSON configuration document and lets an
 *  admin with tenant.config.manage PATCH individual sections (branding, academic calendar,
 *  grading, attendance, fees, admissions, numbering, templates). The server enforces
 *  TENANT_CONFIG_VIEW/TENANT_CONFIG_MANAGE — the permission checks below are cosmetic nav only. */
export function TenantConfigurationPage() {
  const { permissions } = useAuth();
  const [doc, setDoc] = useState<TenantConfigurationResponseDto | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<TenantConfigurationResponseDto>('/tenant/config');
      setDoc(data);
      setDraft({ ...data.config });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canView = permissions.includes(CONFIG_VIEW);
  const canManage = permissions.includes(CONFIG_MANAGE);

  const setSection = (section: string, patch: Record<string, unknown>) => {
    setDraft((prev) => ({ ...prev, [section]: { ...((prev[section] as Record<string, unknown>) ?? {}), ...patch } }));
  };

  const saveSection = async (section: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<TenantConfigurationResponseDto>('/tenant/config', {
        method: 'PATCH',
        body: JSON.stringify({ [section]: draft[section] }),
      });
      setDoc(res);
      setDraft((prev) => ({ ...prev, ...res.config }));
      setNotice(`${label(section)} saved (v${res.version}).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, ' $1');

  const textField = (section: string, key: string, current: string | null | undefined) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      {label(key)}
      <input
        value={current ?? ''}
        onChange={(e) => setSection(section, { [key]: e.target.value })}
        style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
      />
    </label>
  );

  const numberField = (section: string, key: string, current: number | null | undefined, props?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      {label(key)}
      <input
        type="number"
        value={current ?? ''}
        onChange={(e) => setSection(section, { [key]: Number(e.target.value) })}
        {...props}
        style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
      />
    </label>
  );

  const boolField = (section: string, key: string, current: boolean | null | undefined) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <input
        type="checkbox"
        checked={current ?? false}
        onChange={(e) => setSection(section, { [key]: e.target.checked })}
        style={{ marginRight: 6 }}
      />
      {label(key)}
    </label>
  );

  const branding = (doc?.config.branding ?? {}) as Record<string, unknown>;
  const academic = (doc?.config.academicCalendar ?? {}) as Record<string, unknown>;
  const grading = (doc?.config.grading ?? {}) as Record<string, unknown>;
  const attendance = (doc?.config.attendance ?? {}) as Record<string, unknown>;
  const fees = (doc?.config.fees ?? {}) as Record<string, unknown>;
  const admissions = (doc?.config.admissions ?? {}) as Record<string, unknown>;
  const numbering = (doc?.config.numbering ?? {}) as Record<string, unknown>;

  if (error) {
    return <p style={{ color: '#b91c1c' }}>{error}</p>;
  }

  return (
    <div style={{ maxWidth: 820, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: '1.25rem' }}>Tenant Configuration</h1>

      {!canView && (
        <Card>
          <p style={{ color: '#9ca3af' }}>You don't have visibility into this tenant's configuration.</p>
        </Card>
      )}

      {canView && !doc && <p>Loading…</p>}

      {canView && doc && (
        <>
          {notice && <p style={{ color: '#15803d' }}>{notice}</p>}
          <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>Document version {doc.version}</p>

          {!canManage && <p style={{ color: '#9ca3af' }}>View-only — you need tenant.config.manage to edit.</p>}

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Branding</h2>
            {textField('branding', 'collegeName', branding.collegeName as string)}
            {textField('branding', 'tagline', branding.tagline as string)}
            {textField('branding', 'primaryColor', branding.primaryColor as string)}
            {textField('branding', 'secondaryColor', branding.secondaryColor as string)}
            {textField('branding', 'accentColor', branding.accentColor as string)}
            {textField('branding', 'logoUrl', branding.logoUrl as string)}
            {canManage && <Button onClick={() => void saveSection('branding')} disabled={busy}>Save branding</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Academic calendar</h2>
            {textField('academicCalendar', 'academicYear', academic.academicYear as string)}
            {textField('academicCalendar', 'startDate', academic.startDate as string)}
            {textField('academicCalendar', 'endDate', academic.endDate as string)}
            {numberField('academicCalendar', 'totalSemesters', academic.totalSemesters as number, { min: 1, max: 12 })}
            {boolField('academicCalendar', 'hasSemesters', academic.hasSemesters as boolean)}
            {canManage && <Button onClick={() => void saveSection('academicCalendar')} disabled={busy}>Save academic calendar</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Grading</h2>
            <label style={{ display: 'block', marginBottom: 10 }}>
              Scheme
              <select
                value={(grading.scheme as string) ?? 'PERCENTAGE'}
                onChange={(e) => setSection('grading', { scheme: e.target.value })}
                style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem' }}
              >
                <option value="PERCENTAGE">Percentage</option>
                <option value="GPA">GPA</option>
                <option value="CUSTOM">Custom</option>
              </select>
            </label>
            {numberField('grading', 'maxPercentage', grading.maxPercentage as number, { min: 0, max: 100 })}
            {numberField('grading', 'passPercentage', grading.passPercentage as number, { min: 0, max: 100 })}
            {canManage && <Button onClick={() => void saveSection('grading')} disabled={busy}>Save grading</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Attendance</h2>
            {numberField('attendance', 'thresholdPercent', attendance.thresholdPercent as number, { min: 0, max: 100 })}
            {boolField('attendance', 'requiredPerSubject', attendance.requiredPerSubject as boolean)}
            {textField('attendance', 'ruleDescription', attendance.ruleDescription as string)}
            {canManage && <Button onClick={() => void saveSection('attendance')} disabled={busy}>Save attendance</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Fees</h2>
            {textField('fees', 'dueDate', fees.dueDate as string)}
            {numberField('fees', 'lateFeePercent', fees.lateFeePercent as number, { min: 0, max: 100 })}
            {textField('fees', 'concessionRules', fees.concessionRules as string)}
            {textField('fees', 'refundRules', fees.refundRules as string)}
            {canManage && <Button onClick={() => void saveSection('fees')} disabled={busy}>Save fees</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Admissions</h2>
            <label style={{ display: 'block', marginBottom: 10 }}>
              Required fields (comma-separated)
              <input
                value={((admissions.requiredFields as string[]) ?? []).join(', ')}
                onChange={(e) =>
                  setSection('admissions', {
                    requiredFields: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 10 }}>
              Document checklist (comma-separated)
              <input
                value={((admissions.documentChecklist as string[]) ?? []).join(', ')}
                onChange={(e) =>
                  setSection('admissions', {
                    documentChecklist: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                  })
                }
                style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
              />
            </label>
            {canManage && <Button onClick={() => void saveSection('admissions')} disabled={busy}>Save admissions</Button>}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Numbering formats</h2>
            {textField('numbering', 'studentPrefix', numbering.studentPrefix as string)}
            {textField('numbering', 'admissionPrefix', numbering.admissionPrefix as string)}
            {textField('numbering', 'feeReceiptPrefix', numbering.feeReceiptPrefix as string)}
            {textField('numbering', 'certificatePrefix', numbering.certificatePrefix as string)}
            {textField('numbering', 'invoicePrefix', numbering.invoicePrefix as string)}
            {canManage && <Button onClick={() => void saveSection('numbering')} disabled={busy}>Save numbering</Button>}
          </Card>
        </>
      )}
    </div>
  );
}
