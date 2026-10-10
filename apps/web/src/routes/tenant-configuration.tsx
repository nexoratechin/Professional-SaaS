import React, { useCallback, useEffect, useState } from 'react';
import type { BrandingAssetKind, TenantConfigurationResponseDto } from '@college-erp/types';
import { Button, Card } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { brandingAssetUrl, uploadBrandingAsset, useBranding } from '../features/branding/branding-context';
import { apiFetch } from '../lib/http';

const CONFIG_VIEW = 'tenant.config.view';
const CONFIG_MANAGE = 'tenant.config.manage';

type Json = Record<string, unknown>;

/** Tenant configuration engine UI. Loads the tenant's JSON configuration document and lets an
 *  admin with tenant.config.manage PATCH individual sections (branding, academic calendar,
 *  grading, attendance, fees, admissions, numbering, templates). The server enforces
 *  TENANT_CONFIG_VIEW/TENANT_CONFIG_MANAGE — the permission checks below are cosmetic nav only.
 *
 *  The Branding section is the white-label surface: identity, colors, uploaded logo/favicon/
 *  login-background assets, login page, email templates, notification sender identity, and
 *  certificate/PDF branding. */
export function TenantConfigurationPage() {
  const { permissions } = useAuth();
  const { branding: preview, refresh: refreshBranding } = useBranding();
  const [doc, setDoc] = useState<TenantConfigurationResponseDto | null>(null);
  const [draft, setDraft] = useState<Record<string, Json>>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<BrandingAssetKind | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<TenantConfigurationResponseDto>('/tenant/config');
      setDoc(data);
      setDraft({ ...(data.config as unknown as Record<string, Json>) });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load configuration.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const canView = permissions.includes(CONFIG_VIEW);
  const canManage = permissions.includes(CONFIG_MANAGE);

  /** Merges the server document with unsaved local edits so inputs reflect typing immediately. */
  const sectionOf = useCallback(
    (name: string): Json => ({
      ...(((doc?.config as unknown as Record<string, Json>)?.[name] as Json) ?? {}),
      ...(draft[name] ?? {}),
    }),
    [doc, draft],
  );

  const setSection = (section: string, patch: Json) => {
    setDraft((prev) => ({ ...prev, [section]: { ...(prev[section] ?? {}), ...patch } }));
  };

  const saveSection = async (section: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<TenantConfigurationResponseDto>('/tenant/config', {
        method: 'PATCH',
        body: JSON.stringify({ [section]: sectionOf(section) }),
      });
      setDoc(res);
      setDraft({ ...(res.config as unknown as Record<string, Json>) });
      setNotice(`${label(section)} saved (v${res.version}).`);
      if (section === 'branding') refreshBranding();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    } finally {
      setBusy(false);
    }
  };

  const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, ' $1');

  const textField = (section: string, key: string, current: string | null | undefined, type = 'text') => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      {label(key)}
      <input
        type={type}
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

  const branding = sectionOf('branding');
  const certificate = (branding.certificate as Json) ?? {};
  const pdf = (branding.pdf as Json) ?? {};

  const setBranding = (patch: Json) => setSection('branding', patch);
  const setNested = (group: 'certificate' | 'pdf', key: string, value: unknown) =>
    setBranding({ [group]: { ...((branding[group] as Json) ?? {}), [key]: value } });

  const nestedTextField = (
    group: 'certificate' | 'pdf',
    key: string,
    current: string | null | undefined,
    type = 'text',
  ) => (
    <label style={{ display: 'block', marginBottom: 10 }}>
      {label(key)}
      <input
        type={type}
        value={current ?? ''}
        onChange={(e) => setNested(group, key, e.target.value)}
        style={{ display: 'block', marginTop: 4, padding: '0.35rem 0.5rem', width: '100%', boxSizing: 'border-box' }}
      />
    </label>
  );

  const colorField = (section: 'branding', group: 'certificate' | 'pdf' | null, key: string, current: string | null | undefined) => {
    const update = (value: string) => (group ? setNested(group, key, value) : setBranding({ [key]: value }));
    return (
      <label style={{ display: 'block', marginBottom: 10 }}>
        {label(key)}
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
          <input type="color" value={current ?? '#1d4ed8'} onChange={(e) => update(e.target.value)} />
          <input
            value={current ?? ''}
            onChange={(e) => update(e.target.value)}
            placeholder="#1d4ed8"
            style={{ flex: 1, padding: '0.35rem 0.5rem' }}
          />
        </div>
      </label>
    );
  };

  const onUpload = async (kind: BrandingAssetKind, file: File | null) => {
    if (!file) return;
    setUploading(kind);
    setError(null);
    setNotice(null);
    try {
      await uploadBrandingAsset(kind, file);
      await load();
      refreshBranding();
      setNotice(`${label(kind)} uploaded.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(null);
    }
  };

  const assetUrl = (kind: BrandingAssetKind): string | null => {
    if (!preview) return null;
    if (kind === 'logo') return brandingAssetUrl(preview.logoUrl);
    if (kind === 'favicon') return brandingAssetUrl(preview.faviconUrl);
    return brandingAssetUrl(preview.login.backgroundUrl);
  };

  const assetField = (kind: BrandingAssetKind, labelText: string) => (
    <div style={{ marginBottom: 14, borderTop: '1px solid var(--ui-color-border)', paddingTop: 10 }}>
      <div style={{ fontWeight: 600, marginBottom: 6 }}>{labelText}</div>
      {assetUrl(kind) ? (
        <img src={assetUrl(kind) as string} alt={labelText} style={{ maxHeight: 48, maxWidth: 180, display: 'block', marginBottom: 6 }} />
      ) : (
        <div style={{ color: '#9ca3af', fontSize: '0.85rem', marginBottom: 6 }}>No {kind} uploaded.</div>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        disabled={!canManage || uploading === kind}
        onChange={(e) => void onUpload(kind, e.target.files?.[0] ?? null)}
      />
      {uploading === kind && <span style={{ marginLeft: 8, fontSize: '0.8rem' }}>Uploading…</span>}
    </div>
  );

  const academic = sectionOf('academicCalendar');
  const grading = sectionOf('grading');
  const attendance = sectionOf('attendance');
  const fees = sectionOf('fees');
  const admissions = sectionOf('admissions');
  const numbering = sectionOf('numbering');

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
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Branding — identity</h2>
            {textField('branding', 'collegeName', branding.collegeName as string)}
            {textField('branding', 'tagline', branding.tagline as string)}
            {textField('branding', 'portalName', branding.portalName as string)}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              {colorField('branding', null, 'primaryColor', branding.primaryColor as string)}
              {colorField('branding', null, 'secondaryColor', branding.secondaryColor as string)}
              {colorField('branding', null, 'accentColor', branding.accentColor as string)}
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Branding — assets</h2>
            {assetField('logo', 'Logo')}
            {assetField('favicon', 'Favicon')}
            {assetField('loginBackground', 'Login background')}
            <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>PNG, JPEG, WebP or GIF, up to 2 MiB.</p>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Branding — login page</h2>
            {textField('branding', 'loginTitle', branding.loginTitle as string)}
            {textField('branding', 'loginSubtitle', branding.loginSubtitle as string)}
            {textField('branding', 'loginWelcomeText', branding.loginWelcomeText as string)}
            {colorField('branding', null, 'loginBackgroundColor', branding.loginBackgroundColor as string)}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Branding — email templates</h2>
            {colorField('branding', null, 'emailHeaderColor', branding.emailHeaderColor as string)}
            {textField('branding', 'emailFooterText', branding.emailFooterText as string)}
            {textField('branding', 'emailSignature', branding.emailSignature as string)}
            {textField('branding', 'emailSupportAddress', branding.emailSupportAddress as string, 'email')}
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Notification sender identity</h2>
            {textField('branding', 'senderName', branding.senderName as string)}
            {textField('branding', 'senderEmail', branding.senderEmail as string, 'email')}
            {textField('branding', 'replyToEmail', branding.replyToEmail as string, 'email')}
            <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>
              The display name and Reply-To applied to outbound email; the SMTP provider's envelope sender is unchanged.
            </p>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Certificate branding</h2>
            {nestedTextField('certificate', 'headerText', certificate.headerText as string)}
            {nestedTextField('certificate', 'footerText', certificate.footerText as string)}
            {nestedTextField('certificate', 'watermark', certificate.watermark as string)}
            {nestedTextField('certificate', 'signedBy', certificate.signedBy as string)}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {colorField('branding', 'certificate', 'primaryColor', certificate.primaryColor as string)}
              {colorField('branding', 'certificate', 'accentColor', certificate.accentColor as string)}
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>PDF branding</h2>
            {nestedTextField('pdf', 'headerText', pdf.headerText as string)}
            {nestedTextField('pdf', 'footerText', pdf.footerText as string)}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {colorField('branding', 'pdf', 'primaryColor', pdf.primaryColor as string)}
              {colorField('branding', 'pdf', 'accentColor', pdf.accentColor as string)}
            </div>
            <label style={{ display: 'block', marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={(pdf.showCollegeName as boolean) ?? true}
                onChange={(e) => setNested('pdf', 'showCollegeName', e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Show college name on PDFs
            </label>
            <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>Applied to generated report/statement PDFs.</p>
          </Card>

          {canManage && (
            <Button onClick={() => void saveSection('branding')} disabled={busy}>
              Save branding
            </Button>
          )}

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
            {numberField('attendance', 'gracePeriodMinutes', attendance.gracePeriodMinutes as number, { min: 0 })}
            {numberField('attendance', 'correctionWindowHours', attendance.correctionWindowHours as number, { min: 1 })}
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
