import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';
import {
  CERTIFICATE_STATUSES,
  CERTIFICATE_TYPES,
  CERTIFICATES_APPROVE_PERMISSION,
  CERTIFICATES_CREATE_PERMISSION,
  CERTIFICATES_EXPORT_PERMISSION,
  CERTIFICATES_MANAGE_PERMISSION,
  CertificateDetail,
  CertificateRow,
  CertificateTemplateRow,
  Paged,
} from './certificates-shared';

export function CertificatesPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<'templates' | 'certificates'>('templates');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = permissions.includes(CERTIFICATES_MANAGE_PERMISSION);
  const canCreate = permissions.includes(CERTIFICATES_CREATE_PERMISSION);
  const canApprove = permissions.includes(CERTIFICATES_APPROVE_PERMISSION);
  const canExport = permissions.includes(CERTIFICATES_EXPORT_PERMISSION);

  return (
    <div style={{ maxWidth: 1180, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Certificates</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('templates')}>Templates</Button>
          <Button variant="secondary" onClick={() => setTab('certificates')}>Certificates</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'templates' && <TemplatesTab canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'certificates' && (
        <CertificatesTab
          canCreate={canCreate}
          canApprove={canApprove}
          canExport={canExport}
          onError={setError}
          onNotice={setNotice}
        />
      )}
    </div>
  );
}

interface TemplateFormState {
  isNew: boolean;
  id?: string;
  code: string;
  name: string;
  certificateType: string;
  qrEnabled: boolean;
  isDefault: boolean;
  isActive: boolean;
  prefix: string;
  start: string;
  padding: string;
  fields: Array<{ label: string; source: string }>;
  branding: Record<string, string>;
}

// ── Templates ───────────────────────────────────────────────────────────────

function TemplatesTab({
  canManage,
  onError,
  onNotice,
}: {
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<CertificateTemplateRow[]>([]);
  const [editor, setEditor] = useState<TemplateFormState | null>(null);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<CertificateTemplateRow>>('/certificates/templates');
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load templates.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const openNew = (): TemplateFormState => ({
    isNew: true,
    code: '',
    name: '',
    certificateType: 'BONAFIDE',
    qrEnabled: true,
    isDefault: false,
    isActive: true,
    prefix: '',
    start: '1',
    padding: '4',
    fields: [{ label: '', source: '' }],
    branding: {},
  });

  const openEdit = (row: CertificateTemplateRow): TemplateFormState => {
    const numbering = row.numberingJson ?? {};
    const fields = Object.entries(row.fieldConfigJson ?? {}).map(([label, source]) => ({ label, source }));
    const branding = row.brandingJson ?? {};
    const selected = ['collegeName', 'tagline', 'headerText', 'footerText', 'signedBy', 'primaryColor', 'accentColor'];
    const safeBranding: Record<string, string> = {};
    for (const key of selected) {
      const value = branding[key];
      safeBranding[key] = typeof value === 'string' ? value : '';
    }
    return {
      isNew: false,
      id: row.id,
      code: row.code,
      name: row.name,
      certificateType: row.certificateType,
      qrEnabled: row.qrEnabled,
      isDefault: row.isDefault,
      isActive: row.isActive,
      prefix: typeof numbering.prefix === 'string' ? numbering.prefix : '',
      start: typeof numbering.start === 'number' ? String(numbering.start) : '1',
      padding: typeof numbering.padding === 'number' ? String(numbering.padding) : '4',
      fields: fields.length ? fields : [{ label: '', source: '' }],
      branding: safeBranding,
    };
  };

  const makeDefault = async (id: string) => {
    try {
      await apiFetch(`/certificates/templates/${id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) });
      onNotice('Template set as default for its type.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to set default template.');
    }
  };

  const archive = async (id: string) => {
    if (!window.confirm('Archive this template (deactivate it for new requests)?')) return;
    try {
      await apiFetch(`/certificates/templates/${id}/archive`, { method: 'POST', body: JSON.stringify({}) });
      onNotice('Template archived.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to archive template.');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this template? Templates referenced by issued certificates must be archived instead.')) return;
    try {
      await apiFetch(`/certificates/templates/${id}`, { method: 'DELETE' });
      onNotice('Template deleted.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete template.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Templates</h2>
          {canManage && <Button onClick={() => setEditor(openNew())}>New template</Button>}
        </div>

        {rows.length === 0 && (
          <p style={{ color: '#9ca3af' }}>No templates yet — create one to define branding, fields and numbering per certificate type.</p>
        )}

        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Fields</th>
                <th style={{ padding: 8 }}>Numbering</th>
                <th style={{ padding: 8 }}>QR</th>
                <th style={{ padding: 8 }}>Default</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{t.code}</td>
                  <td style={{ padding: 8 }}>{t.name}</td>
                  <td style={{ padding: 8 }}>{t.certificateType}</td>
                  <td style={{ padding: 8 }}>{Object.keys(t.fieldConfigJson ?? {}).length}</td>
                  <td style={{ padding: 8 }}>{formatNumbering(t.numberingJson ?? null)}</td>
                  <td style={{ padding: 8 }}>{t.qrEnabled ? 'Yes' : 'No'}</td>
                  <td style={{ padding: 8 }}>{t.isDefault ? 'Yes' : '—'}</td>
                  <td style={{ padding: 8 }}>{t.isActive ? 'Active' : 'Archived'}</td>
                  <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setEditor(openEdit(t))}>Edit</Button>
                    {canManage && !t.isDefault && (
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void makeDefault(t.id)}>Set default</Button>
                    )}
                    {canManage && t.isActive && (
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void archive(t.id)}>Archive</Button>
                    )}
                    {canManage && <Button variant="secondary" onClick={() => void remove(t.id)}>Delete</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editor && (
        <TemplateEditor
          form={editor}
          canManage={canManage}
          onClose={() => setEditor(null)}
          onChanged={() => void load()}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

function formatNumbering(n: { prefix?: string; start?: number; padding?: number } | null): string {
  if (!n?.prefix) return '—';
  return `${n.prefix}-…-${String(n.start ?? 1).padStart(n.padding ?? 0, '0')}`;
}

function TemplateEditor({
  form,
  canManage,
  onClose,
  onChanged,
  onError,
  onNotice,
}: {
  form: TemplateFormState;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [f, setF] = useState<TemplateFormState>(form);
  const update = (patch: Partial<TemplateFormState>) => setF((cur) => ({ ...cur, ...patch }));

  const updateField = (i: number, patch: { label?: string; source?: string }) =>
    setF((cur) => ({ ...cur, fields: cur.fields.map((row, x) => (x === i ? { ...row, ...patch } : row)) }));

  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) {
      onError('Code and name are required.');
      return;
    }
    const fieldConfig = Object.fromEntries(
      f.fields.filter((row) => row.label.trim() !== '' && row.source.trim() !== '').map((row) => [row.label.trim(), row.source.trim()]),
    );
    const branding: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(f.branding)) {
      if (value.trim() !== '') branding[key] = value.trim();
    }
    const common = {
      name: f.name.trim(),
      qrEnabled: f.qrEnabled,
      isDefault: f.isDefault,
      isActive: f.isActive,
      fieldConfig,
      numbering: {
        prefix: f.prefix.trim() || undefined,
        start: Number(f.start) || 1,
        padding: Number(f.padding) || 4,
      },
      branding,
    };
    try {
      if (f.isNew) {
        await apiFetch('/certificates/templates', {
          method: 'POST',
          body: JSON.stringify({ ...common, code: f.code.trim(), certificateType: f.certificateType }),
        });
        onNotice('Template created.');
      } else if (f.id) {
        await apiFetch(`/certificates/templates/${f.id}`, { method: 'PATCH', body: JSON.stringify(common) });
        onNotice('Template updated.');
      }
      onError(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save template.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{f.isNew ? 'New template' : `Template — ${f.code}`}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canManage && <Button onClick={() => void save()}>Save</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {f.isNew && (
          <>
            <Input value={f.code} onChange={(e) => update({ code: e.target.value })} placeholder="Code" style={{ width: 130 }} />
            <select value={f.certificateType} onChange={(e) => update({ certificateType: e.target.value })} style={{ ...selectStyle, width: 220 }}>
              {CERTIFICATE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </>
        )}
        <Input value={f.name} onChange={(e) => update({ name: e.target.value })} placeholder="Name" style={{ flex: 1, minWidth: 180 }} />
        <Input value={f.prefix} onChange={(e) => update({ prefix: e.target.value })} placeholder="Prefix (e.g. CERT)" style={{ width: 150 }} />
        <Input value={f.start} onChange={(e) => update({ start: e.target.value })} placeholder="Start" type="number" style={{ width: 80 }} />
        <Input value={f.padding} onChange={(e) => update({ padding: e.target.value })} placeholder="Padding" type="number" style={{ width: 90 }} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: '0.9rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={f.qrEnabled} onChange={(e) => update({ qrEnabled: e.target.checked })} />
          QR verify
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={f.isDefault} onChange={(e) => update({ isDefault: e.target.checked })} />
          Default for type
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={f.isActive} onChange={(e) => update({ isActive: e.target.checked })} />
          Active
        </label>
      </div>

      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Field config (label → source)</h3>
      <p style={{ fontSize: '0.8rem', color: '#6b7280', marginBottom: 8 }}>
        Sources: <code>student.fullName</code>, <code>student.admissionNumber</code>, <code>program.name</code>,{' '}
        <code>campus.name</code>, <code>batch.name</code>, <code>certificate.title</code>, or the block tokens{' '}
        <code>subjects</code> / <code>summary</code>.
      </p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginBottom: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: 8 }}>Label</th>
            <th style={{ padding: 8 }}>Source</th>
            <th style={{ padding: 8, textAlign: 'right' }}></th>
          </tr>
        </thead>
        <tbody>
          {f.fields.map((row, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: 6 }}>
                <Input value={row.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder="e.g. Student Name" style={{ minWidth: 160 }} />
              </td>
              <td style={{ padding: 6 }}>
                <Input value={row.source} onChange={(e) => updateField(i, { source: e.target.value })} placeholder="e.g. student.fullName" style={{ minWidth: 200 }} />
              </td>
              <td style={{ padding: 6, textAlign: 'right' }}>
                <Button variant="secondary" onClick={() => setF((cur) => ({ ...cur, fields: cur.fields.filter((_, x) => x !== i) }))}>Remove</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Button variant="secondary" style={{ marginBottom: 16 }} onClick={() => setF((cur) => ({ ...cur, fields: [...cur.fields, { label: '', source: '' }] }))}>
        Add field
      </Button>

      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Branding overrides</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8, marginBottom: 8 }}>
        <Input value={f.branding.collegeName ?? ''} onChange={(e) => update({ branding: { ...f.branding, collegeName: e.target.value } })} placeholder="College name" />
        <Input value={f.branding.tagline ?? ''} onChange={(e) => update({ branding: { ...f.branding, tagline: e.target.value } })} placeholder="Tagline" />
        <Input value={f.branding.headerText ?? ''} onChange={(e) => update({ branding: { ...f.branding, headerText: e.target.value } })} placeholder="Header text" />
        <Input value={f.branding.footerText ?? ''} onChange={(e) => update({ branding: { ...f.branding, footerText: e.target.value } })} placeholder="Footer text" />
        <Input value={f.branding.signedBy ?? ''} onChange={(e) => update({ branding: { ...f.branding, signedBy: e.target.value } })} placeholder="Signed by (title)" />
        <Input value={f.branding.primaryColor ?? ''} onChange={(e) => update({ branding: { ...f.branding, primaryColor: e.target.value } })} placeholder="Primary color (#hex)" />
        <Input value={f.branding.accentColor ?? ''} onChange={(e) => update({ branding: { ...f.branding, accentColor: e.target.value } })} placeholder="Accent color (#hex)" />
      </div>
      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>Blank fields inherit the tenant&apos;s configured branding.</p>
    </Card>
  );
}

// ── Certificates ────────────────────────────────────────────────────────────

function CertificatesTab({
  canCreate,
  canApprove,
  canExport,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canApprove: boolean;
  canExport: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState<CertificateRow[]>([]);
  const [detail, setDetail] = useState<CertificateDetail | null>(null);
  const [showRequest, setShowRequest] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    if (search) params.set('search', search);
    params.set('skip', '0');
    params.set('take', '100');
    try {
      const res = await apiFetch<Paged<CertificateRow>>(`/certificates?${params.toString()}`);
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load certificates.');
    }
  }, [status, type, search, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      onNotice(success);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Operation failed.');
    }
  };

  const reload = () => void load();

  const reject = async (id: string) => {
    const reason = window.prompt('Rejection reason:');
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert('A reason is required to reject a certificate.');
      return;
    }
    await run(() => apiFetch(`/certificates/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), 'Certificate rejected.');
    reload();
  };

  const revoke = async (id: string) => {
    const reason = window.prompt('Revocation reason:');
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert('A reason is required to revoke a certificate.');
      return;
    }
    await run(() => apiFetch(`/certificates/${id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) }), 'Certificate revoked.');
    reload();
  };

  const download = async (id: string) => {
    try {
      const res = await apiFetch<{ downloadUrl: string }>(`/certificates/${id}/download-url`);
      window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to fetch download link.');
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await apiFetch<CertificateDetail>(`/certificates/${id}`));
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load certificate.');
    }
  };

  const exportCsv = async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    try {
      const res = await apiFetch<{ csv: string; filename: string }>(`/certificates/export?${params.toString()}`);
      downloadCsv(res.csv, res.filename);
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to export certificates.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Certificates</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {canExport && <Button variant="secondary" onClick={() => void exportCsv()}>Export CSV</Button>}
            {canCreate && <Button onClick={() => setShowRequest(true)}>Request certificate</Button>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...selectStyle, width: 150 }}>
            <option value="">All statuses</option>
            {CERTIFICATE_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={type} onChange={(e) => setType(e.target.value)} style={{ ...selectStyle, width: 230 }}>
            <option value="">All types</option>
            {CERTIFICATE_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number / title / student" style={{ flex: 1, minWidth: 220 }} />
          <Button variant="secondary" onClick={reload}>Refresh</Button>
        </div>

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No certificates match the filters.</p>}

        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Number</th>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Title</th>
                <th style={{ padding: 8 }}>Student</th>
                <th style={{ padding: 8 }}>Requested</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{c.certificateNumber ?? '—'}</td>
                  <td style={{ padding: 8 }}>{c.certificateType}</td>
                  <td style={{ padding: 8 }}>{c.title ?? '—'}</td>
                  <td style={{ padding: 8 }}>{c.student?.fullName ?? '—'}</td>
                  <td style={{ padding: 8 }}>{fmtDate(c.requestDate)}</td>
                  <td style={{ padding: 8 }}>
                    <StatusBadge status={c.status} />
                    {c.status === 'REJECTED' && c.rejectReason && <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{c.rejectReason}</div>}
                    {c.status === 'REVOKED' && c.revokeReason && <div style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{c.revokeReason}</div>}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {c.status === 'REQUESTED' && canCreate && (
                      <Button variant="secondary" style={{ marginRight: 6 }}
                        onClick={() => void run(() => apiFetch(`/certificates/${c.id}/generate`, { method: 'POST', body: JSON.stringify({}) }), 'Certificate generated.').then(reload)}>
                        Generate
                      </Button>
                    )}
                    {c.status === 'GENERATED' && canApprove && (
                      <>
                        <Button variant="secondary" style={{ marginRight: 6 }}
                          onClick={() => void run(() => apiFetch(`/certificates/${c.id}/approve`, { method: 'POST', body: JSON.stringify({}) }), 'Certificate approved.').then(reload)}>
                          Approve
                        </Button>
                        <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void reject(c.id)}>Reject</Button>
                      </>
                    )}
                    {c.status === 'APPROVED' && canApprove && (
                      <Button variant="secondary" style={{ marginRight: 6 }}
                        onClick={() => void run(() => apiFetch(`/certificates/${c.id}/issue`, { method: 'POST', body: JSON.stringify({}) }), 'Certificate issued.').then(reload)}>
                        Issue
                      </Button>
                    )}
                    {(c.status === 'REQUESTED') && canApprove && (
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void reject(c.id)}>Reject</Button>
                    )}
                    {(c.status === 'GENERATED' || c.status === 'APPROVED' || c.status === 'ISSUED') && (
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void download(c.id)}>Download</Button>
                    )}
                    {c.status === 'ISSUED' && canApprove && c.qrToken && (
                      <Button variant="secondary" style={{ marginRight: 6 }}
                        onClick={() => window.open(`/verify/certificate?token=${encodeURIComponent(c.qrToken!)}`, '_blank', 'noopener,noreferrer')}>
                        Verify
                      </Button>
                    )}
                    {c.status === 'ISSUED' && canApprove && (
                      <>
                        <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void revoke(c.id)}>Revoke</Button>
                        <Button variant="secondary" style={{ marginRight: 6 }}
                          onClick={() => void run(() => apiFetch(`/certificates/${c.id}/reissue`, { method: 'POST', body: JSON.stringify({}) }), 'Reissued certificate created.').then(reload)}>
                          Reissue
                        </Button>
                      </>
                    )}
                    <Button variant="secondary" onClick={() => void openDetail(c.id)}>Details</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showRequest && (
        <RequestModal
          onClose={() => setShowRequest(false)}
          onDone={() => {
            setShowRequest(false);
            reload();
          }}
          onError={onError}
          onNotice={onNotice}
        />
      )}

      {detail && <DetailCard detail={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StatusBadge({ status }: { status: string }) {
  const color: Record<string, string> = {
    REQUESTED: '#f59e0b',
    GENERATED: '#3b82f6',
    APPROVED: '#8b5cf6',
    ISSUED: '#15803d',
    REJECTED: '#b91c1c',
    REVOKED: '#6b7280',
  };
  return <span style={{ color: color[status] ?? '#111827', fontWeight: 600 }}>{status}</span>;
}

// ── Request modal ───────────────────────────────────────────────────────────

interface StudentOption {
  id: string;
  fullName: string;
  admissionNumber: string | null;
}

function RequestModal({
  onClose,
  onDone,
  onError,
  onNotice,
}: {
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [studentId, setStudentId] = useState('');
  const [certificateType, setCertificateType] = useState('BONAFIDE');
  const [title, setTitle] = useState('');
  const [remarks, setRemarks] = useState('');

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: StudentOption[]; total: number }>('/students?skip=0&take=500')
      .then((res) => {
        if (mounted) setStudents(Array.isArray(res.data) ? res.data : []);
      })
      .catch(() => {
        if (mounted) setStudents([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const submit = async () => {
    if (!studentId) {
      onError('Select a student.');
      return;
    }
    try {
      await apiFetch('/certificates', {
        method: 'POST',
        body: JSON.stringify({
          studentId,
          certificateType,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        }),
      });
      onNotice('Certificate requested.');
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to request certificate.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Request certificate</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void submit()}>Request</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 240 }}>
          <option value="">Select student…</option>
          {students.map((s) => (
            <option key={s.id} value={s.id}>
              {s.fullName} {s.admissionNumber ? `(${s.admissionNumber})` : ''}
            </option>
          ))}
        </select>
        <select value={certificateType} onChange={(e) => setCertificateType(e.target.value)} style={{ ...selectStyle, width: 230 }}>
          {CERTIFICATE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" style={{ flex: 1, minWidth: 200 }} />
        <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional)" style={{ flex: 1, minWidth: 200 }} />
      </div>
    </Card>
  );
}

// ── Detail / history ────────────────────────────────────────────────────────

function DetailCard({ detail, onClose }: { detail: CertificateDetail; onClose: () => void }) {
  const history = detail.history ?? [];
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>
          {detail.certificateNumber ?? 'Certificate'} — {detail.student?.fullName ?? ''}
        </h2>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 16, fontSize: '0.9rem' }}>
        <div><strong>Type:</strong> {detail.certificateType}</div>
        <div><strong>Status:</strong> <StatusBadge status={detail.status} /></div>
        <div><strong>Requested:</strong> {fmtDate(detail.requestDate)}</div>
        <div><strong>Generated:</strong> {detail.generatedAt ? fmtDate(detail.generatedAt) : '—'}</div>
        <div><strong>Approved:</strong> {detail.approvedAt ? fmtDate(detail.approvedAt) : '—'}</div>
        <div><strong>Issued:</strong> {detail.issuedAt ? fmtDate(detail.issuedAt) : '—'}</div>
        <div><strong>Template:</strong> {detail.template ? `${detail.template.code} (${detail.template.name})` : '—'}</div>
        {detail.reissuedFrom && <div><strong>Reissued from:</strong> {detail.reissuedFrom.certificateNumber ?? detail.reissuedFrom.id}</div>}
      </div>

      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>History</h3>
      {history.length === 0 && <p style={{ color: '#9ca3af' }}>No history recorded.</p>}
      {history.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Transition</th>
              <th style={{ padding: 8 }}>When</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h) => (
              <tr key={h.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{h.fromStatus} → {h.toStatus}</td>
                <td style={{ padding: 8 }}>{fmtDate(h.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}