import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';

const DOCUMENTS_VIEW_PERMISSION = 'documents.read';
const DOCUMENTS_MANAGE_PERMISSION = 'documents.manage';
const DOCUMENTS_APPROVE_PERMISSION = 'documents.approve';

const DOCUMENT_STATUSES = [
  'PENDING_UPLOAD',
  'UPLOADED',
  'AWAITING_SCAN',
  'READY',
  'VERIFIED',
  'REJECTED',
  'EXPIRED',
  'QUARANTINED',
] as const;

const SCAN_COLORS: Record<string, string> = {
  CLEAN: '#15803d',
  INFECTED: '#b91c1c',
  QUARANTINED: '#b91c1c',
  ERROR: '#f59e0b',
  SCANNING: '#3b82f6',
  PENDING: '#9ca3af',
};

const STATUS_COLORS: Record<string, string> = {
  PENDING_UPLOAD: '#9ca3af',
  UPLOADED: '#3b82f6',
  AWAITING_SCAN: '#f59e0b',
  READY: '#6d28d9',
  VERIFIED: '#15803d',
  REJECTED: '#b91c1c',
  EXPIRED: '#6b7280',
  QUARANTINED: '#b91c1c',
};

export interface DocumentTypeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  allowedMimeTypes: string[] | null;
  allowedExtensions: string[] | null;
  maxSizeBytes: number | null;
  isSensitive: boolean;
  canExpire: boolean;
  retentionDays: number | null;
  isActive: boolean;
}

export interface DocumentVersionRow {
  id: string;
  versionNumber: number;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number | null;
  sha256: string | null;
  scanStatus: string;
  scanEngine: string | null;
  scanError: string | null;
  scannedAt: string | null;
  uploadedBy: string | null;
  confirmedAt: string | null;
  replacedByVersionId: string | null;
  createdAt: string;
}

export interface DocumentRow {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: string;
  tags: string[];
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  expiredAt: string | null;
  verifiedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  uploadedBy: string | null;
  createdAt: string;
  documentType: { id: string; code: string; name: string; isSensitive: boolean; canExpire: boolean } | null;
  currentVersion: DocumentVersionRow | null;
  versions: DocumentVersionRow[];
}

interface AccessGrantRow {
  id: string;
  granteeType: 'USER' | 'ROLE';
  granteeUserId: string | null;
  granteeRoleId: string | null;
  canView: boolean;
  canDownload: boolean;
  grantedBy: string | null;
  createdAt: string;
}

interface DownloadLogRow {
  id: string;
  versionId: string | null;
  downloadedBy: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

function StatusBadge({ status }: { status: string }) {
  return <span style={{ color: STATUS_COLORS[status] ?? '#111827', fontWeight: 600 }}>{status}</span>;
}

export function DocumentsPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<'documents' | 'types'>('documents');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canView = permissions.includes(DOCUMENTS_VIEW_PERMISSION);
  const canManage = permissions.includes(DOCUMENTS_MANAGE_PERMISSION);
  const canApprove = permissions.includes(DOCUMENTS_APPROVE_PERMISSION);

  return (
    <div style={{ maxWidth: 1180, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Documents</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('documents')}>Documents</Button>
          {canView && <Button variant="secondary" onClick={() => setTab('types')}>Document types</Button>}
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'documents' && (
        <DocumentsTab canManage={canManage} canApprove={canApprove} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'types' && canView && (
        <TypesTab canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
    </div>
  );
}

// ── Documents tab ───────────────────────────────────────────────────────────

function DocumentsTab({
  canManage,
  canApprove,
  onError,
  onNotice,
}: {
  canManage: boolean;
  canApprove: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [types, setTypes] = useState<DocumentTypeRow[]>([]);
  const [typeId, setTypeId] = useState('');
  const [rows, setRows] = useState<DocumentRow[]>([]);
  const [detail, setDetail] = useState<DocumentRow | null>(null);
  const [showUpload, setShowUpload] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    if (typeId) params.set('documentTypeId', typeId);
    params.set('skip', '0');
    params.set('take', '100');
    try {
      const res = await apiFetch<{ data: DocumentRow[]; total: number }>(`/documents?${params.toString()}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load documents.');
    }
  }, [status, search, typeId, onError]);

  useEffect(() => {
    void load();
    apiFetch<DocumentTypeRow[]>('/document-types')
      .then(setTypes)
      .catch(() => setTypes([]));
  }, [load]);

  const reload = () => void load();

  const download = async (id: string) => {
    try {
      const res = await apiFetch<{ downloadUrl: string }>(`/documents/${id}/download-url`);
      window.open(res.downloadUrl, '_blank', 'noopener,noreferrer');
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to fetch download link.');
    }
  };

  const act = async (path: string, success: string, body?: unknown) => {
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
      onNotice(success);
      onError(null);
      reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const rejectDoc = async (id: string) => {
    const reason = window.prompt('Rejection reason:');
    if (reason === null) return;
    if (!reason.trim()) {
      window.alert('A reason is required to reject a document.');
      return;
    }
    await act(`/documents/${id}/reject`, 'Document rejected.', { reason: reason.trim() });
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this document? Its current file will be removed from storage (use Expire/Reject to keep an audit trail).')) return;
    try {
      await apiFetch(`/documents/${id}`, { method: 'DELETE' });
      onNotice('Document deleted.');
      onError(null);
      reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete document.');
    }
  };

  const openDetail = async (id: string) => {
    try {
      setDetail(await apiFetch<DocumentRow>(`/documents/${id}`));
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load document.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Documents</h2>
          {canManage && <Button onClick={() => setShowUpload(true)}>Upload document</Button>}
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ ...selectStyle, width: 170 }}>
            <option value="">All statuses</option>
            {DOCUMENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={{ ...selectStyle, width: 220 }}>
            <option value="">All types</option>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
            ))}
          </select>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title / filename" style={{ flex: 1, minWidth: 220 }} />
          <Button variant="secondary" onClick={reload}>Refresh</Button>
        </div>

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No documents match the filters.</p>}

        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Document</th>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>File</th>
                <th style={{ padding: 8 }}>Size</th>
                <th style={{ padding: 8 }}>Created</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>
                    {d.title || d.originalFilename || d.id.slice(0, 8)}
                    {d.documentType?.isSensitive && <span title="Sensitive type" style={{ marginLeft: 6 }}>🔒</span>}
                  </td>
                  <td style={{ padding: 8 }}>{d.documentType?.name ?? d.category ?? '—'}</td>
                  <td style={{ padding: 8 }}>{d.originalFilename ?? '—'}</td>
                  <td style={{ padding: 8 }}>{fmtBytes(d.sizeBytes)}</td>
                  <td style={{ padding: 8 }}>{fmtDate(d.createdAt)}</td>
                  <td style={{ padding: 8 }}>
                    <StatusBadge status={d.status} />
                    {d.status === 'REJECTED' && d.rejectionReason && <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{d.rejectionReason}</div>}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void download(d.id)}>Download</Button>
                    {d.status === 'READY' && canApprove && (
                      <Button variant="secondary" style={{ marginRight: 6 }}
                        onClick={() => void act(`/documents/${d.id}/verify`, 'Document verified.')}>
                        Verify
                      </Button>
                    )}
                    {canApprove && (d.status === 'READY' || d.status === 'UPLOADED' || d.status === 'AWAITING_SCAN' || d.status === 'VERIFIED') && (
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void rejectDoc(d.id)}>Reject</Button>
                    )}
                    {canManage && d.status !== 'EXPIRED' && (
                      <Button variant="secondary" style={{ marginRight: 6 }}
                        onClick={() => void act(`/documents/${d.id}/expire`, 'Document expired.')}>
                        Expire
                      </Button>
                    )}
                    {canManage && (
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void replace(d, onError, onNotice, load)}>
                        Replace
                      </Button>
                    )}
                    {canManage && (
                      <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => void remove(d.id)}>Delete</Button>
                    )}
                    <Button variant="secondary" onClick={() => void openDetail(d.id)}>Details</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {showUpload && (
        <UploadModal
          types={types}
          onClose={() => setShowUpload(false)}
          onDone={() => {
            setShowUpload(false);
            reload();
          }}
          onError={onError}
          onNotice={onNotice}
        />
      )}

      {detail && (
        <DetailPanel
          documentId={detail.id}
          onClose={() => setDetail(null)}
          onChanged={reload}
          canApprove={canApprove}
          canManage={canManage}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

/** Replacement flow: request a fresh version slot → PUT bytes → confirm (handled by file picker
 *  so it also works inline). */
async function replace(
  doc: DocumentRow,
  onError: (m: string | null) => void,
  onNotice: (m: string | null) => void,
  reload: () => void,
) {
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const res = await apiFetch<{ documentId: string; versionId: string; uploadUrl: string }>(
        `/documents/${doc.id}/versions/upload-url`,
        { method: 'POST', body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream' }) },
      );
      await fetch(res.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      await apiFetch(`/documents/${res.documentId}/versions/${res.versionId}/confirm-upload`, {
        method: 'POST',
        body: JSON.stringify({ sizeBytes: file.size }),
      });
      onNotice('Replacement version uploaded.');
      onError(null);
      reload();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Replacement failed.');
    }
  };
  input.click();
}

// ── Upload modal ───────────────────────────────────────────────────────────

function UploadModal({
  types,
  onClose,
  onDone,
  onError,
  onNotice,
}: {
  types: DocumentTypeRow[];
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [documentTypeId, setDocumentTypeId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!file) {
      onError('Choose a file to upload.');
      return;
    }
    setBusy(true);
    try {
      const res = await apiFetch<{ document: { id: string }; uploadUrl: string }>('/documents/upload-url', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          ...(documentTypeId ? { documentTypeId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
        }),
      });
      await fetch(res.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      await apiFetch(`/documents/${res.document.id}/confirm-upload`, { method: 'POST', body: JSON.stringify({ sizeBytes: file.size }) });
      onNotice('Document uploaded and queued for virus scan.');
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Upload document</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button disabled={busy || !file} onClick={() => void submit()}>Upload</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} style={{ flex: 1, minWidth: 260 }} />
        <select value={documentTypeId} onChange={(e) => setDocumentTypeId(e.target.value)} style={{ ...selectStyle, width: 240 }}>
          <option value="">No type (generic)</option>
          {types.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (defaults to filename)" style={{ flex: 1, minWidth: 200 }} />
        <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category (optional)" style={{ flex: 1, minWidth: 160 }} />
        <Input value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} type="date" placeholder="Expires" style={{ width: 160 }} />
      </div>
      <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description (optional)" style={{ width: '100%' }} />
      <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 8 }}>
        Files are privately stored; the server validates MIME/size and runs a virus scan before the document becomes ready.
      </p>
    </Card>
  );
}

// ── Detail panel (metadata / versions / grants / download history) ─────────

function DetailPanel({
  documentId,
  onClose,
  onChanged,
  canApprove,
  canManage,
  onError,
  onNotice,
}: {
  documentId: string;
  onClose: () => void;
  onChanged: () => void;
  canApprove: boolean;
  canManage: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [grants, setGrants] = useState<AccessGrantRow[]>([]);
  const [logs, setLogs] = useState<DownloadLogRow[]>([]);
  const [showGrant, setShowGrant] = useState(false);

  const load = useCallback(async () => {
    onError(null);
    try {
      const d = await apiFetch<DocumentRow>(`/documents/${documentId}`);
      setDoc(d);
      if (canManage) {
        const [g, l] = await Promise.all([
          apiFetch<AccessGrantRow[]>(`/documents/${documentId}/grants`),
          apiFetch<{ data: DownloadLogRow[]; total: number }>(`/documents/${documentId}/download-history?take=100`),
        ]);
        setGrants(g);
        setLogs(l.data);
      }
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load document.');
    }
  }, [documentId, canManage, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (path: string, success: string, body?: unknown) => {
    try {
      await apiFetch(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
      onNotice(success);
      onError(null);
      await load();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const revokeGrant = async (grantId: string) => {
    if (!window.confirm('Revoke this access grant?')) return;
    try {
      await apiFetch(`/documents/${documentId}/grants/${grantId}`, { method: 'DELETE' });
      onNotice('Access revoked.');
      onError(null);
      await load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to revoke access.');
    }
  };

  if (!doc) return <Card><p>Loading…</p></Card>;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{doc.title || doc.originalFilename}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {doc.status === 'READY' && canApprove && (
            <Button variant="secondary" onClick={() => void act(`/documents/${doc.id}/verify`, 'Document verified.')}>Verify</Button>
          )}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8, marginBottom: 16, fontSize: '0.9rem' }}>
        <div><strong>Status:</strong> <StatusBadge status={doc.status} /></div>
        <div><strong>Category:</strong> {doc.category}</div>
        <div><strong>Type:</strong> {doc.documentType ? `${doc.documentType.name} (${doc.documentType.code})` : '—'}</div>
        <div><strong>Filename:</strong> {doc.originalFilename ?? '—'}</div>
        <div><strong>MIME:</strong> {doc.mimeType ?? '—'}</div>
        <div><strong>Size:</strong> {fmtBytes(doc.sizeBytes)}</div>
        <div><strong>Created:</strong> {fmtDate(doc.createdAt)}</div>
        <div><strong>Expires:</strong> {doc.expiresAt ? fmtDate(doc.expiresAt) : '—'}</div>
        {doc.verifiedAt && <div><strong>Verified:</strong> {fmtDate(doc.verifiedAt)}</div>}
        {doc.rejectedAt && <div><strong>Rejected:</strong> {fmtDate(doc.rejectedAt)}{doc.rejectionReason ? ` — ${doc.rejectionReason}` : ''}</div>}
        <div><strong>Uploaded by:</strong> {doc.uploadedBy ?? '—'}</div>
        {doc.currentVersion?.sha256 && (
          <div style={{ gridColumn: '1 / -1' }}>
            <strong>SHA-256:</strong> <code style={{ fontSize: '0.75rem' }}>{doc.currentVersion.sha256}</code>
          </div>
        )}
      </div>

      {doc.description && <p style={{ marginBottom: 16, whiteSpace: 'pre-wrap' }}>{doc.description}</p>}

      {canManage && doc.status !== 'EXPIRED' && (
        <div style={{ marginBottom: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setShowGrant(true)}>Grant access</Button>
          <Button variant="secondary" onClick={() => void act(`/documents/${doc.id}/expire`, 'Document expired.')}>Expire</Button>
        </div>
      )}

      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Versions ({doc.versions.length})</h3>
      {doc.versions.length === 0 && <p style={{ color: '#9ca3af' }}>No file uploaded yet.</p>}
      {doc.versions.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 16 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 6 }}>#</th>
              <th style={{ padding: 6 }}>Filename</th>
              <th style={{ padding: 6 }}>Size</th>
              <th style={{ padding: 6 }}>Scan</th>
              <th style={{ padding: 6 }}>Engine</th>
              <th style={{ padding: 6 }}>Confirmed</th>
              <th style={{ padding: 6 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {doc.versions.map((v) => (
              <tr key={v.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 6 }}>{v.versionNumber}{doc.currentVersion?.id === v.id ? ' (current)' : ''}</td>
                <td style={{ padding: 6 }}>{v.originalFilename}</td>
                <td style={{ padding: 6 }}>{fmtBytes(v.sizeBytes)}</td>
                <td style={{ padding: 6, color: SCAN_COLORS[v.scanStatus] ?? '#111827', fontWeight: 600 }}>{v.scanStatus}</td>
                <td style={{ padding: 6 }}>{v.scanEngine ?? '—'}</td>
                <td style={{ padding: 6 }}>{v.confirmedAt ? fmtDate(v.confirmedAt) : '—'}</td>
                <td style={{ padding: 6 }}>{v.replacedByVersionId ? 'Superseded' : 'Active'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {canManage && (
        <>
          <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Access grants ({grants.length})</h3>
          {grants.length === 0 && <p style={{ color: '#9ca3af', marginBottom: 12 }}>No explicit grants — downloads are limited to the uploader and managers.</p>}
          {grants.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginBottom: 16 }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: 6 }}>Grantee</th>
                  <th style={{ padding: 6 }}>View</th>
                  <th style={{ padding: 6 }}>Download</th>
                  <th style={{ padding: 6 }}>Granted</th>
                  <th style={{ padding: 6, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 6 }}>{g.granteeType === 'ROLE' ? `Role ${g.granteeRoleId ?? ''}` : `User ${g.granteeUserId ?? ''}`}</td>
                    <td style={{ padding: 6 }}>{g.canView ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 6 }}>{g.canDownload ? 'Yes' : 'No'}</td>
                    <td style={{ padding: 6 }}>{fmtDate(g.createdAt)}</td>
                    <td style={{ padding: 6, textAlign: 'right' }}>
                      <Button variant="secondary" onClick={() => void revokeGrant(g.id)}>Revoke</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Download history ({logs.length})</h3>
          {logs.length === 0 && <p style={{ color: '#9ca3af' }}>No downloads recorded.</p>}
          {logs.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: 6 }}>When</th>
                  <th style={{ padding: 6 }}>User</th>
                  <th style={{ padding: 6 }}>IP</th>
                  <th style={{ padding: 6 }}>User agent</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 6 }}>{fmtDate(l.createdAt)}</td>
                    <td style={{ padding: 6 }}>{l.downloadedBy ?? '—'}</td>
                    <td style={{ padding: 6 }}>{l.ipAddress ?? '—'}</td>
                    <td style={{ padding: 6, fontSize: '0.75rem', color: '#6b7280', wordBreak: 'break-all' }}>{l.userAgent ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {showGrant && (
        <GrantModal
          documentId={doc.id}
          onClose={() => setShowGrant(false)}
          onDone={() => {
            setShowGrant(false);
            void load();
          }}
          onError={onError}
        />
      )}
    </Card>
  );
}

// ── Grant access modal ──────────────────────────────────────────────────────

function GrantModal({
  documentId,
  onClose,
  onDone,
  onError,
}: {
  documentId: string;
  onClose: () => void;
  onDone: () => void;
  onError: (m: string | null) => void;
}) {
  const [users, setUsers] = useState<{ id: string; fullName: string }[]>([]);
  const [roles, setRoles] = useState<{ id: string; code: string; name: string }[]>([]);
  const [granteeType, setGranteeType] = useState<'USER' | 'ROLE'>('USER');
  const [granteeUserId, setGranteeUserId] = useState('');
  const [granteeRoleId, setGranteeRoleId] = useState('');
  const [canView, setCanView] = useState(true);
  const [canDownload, setCanDownload] = useState(true);

  useEffect(() => {
    apiFetch<{ id: string; fullName: string }[]>('/users?take=500')
      .then(setUsers)
      .catch(() => setUsers([]));
    apiFetch<{ id: string; code: string; name: string }[]>('/roles')
      .then(setRoles)
      .catch(() => setRoles([]));
  }, []);

  const submit = async () => {
    if (granteeType === 'USER' && !granteeUserId) {
      onError('Select a user.');
      return;
    }
    if (granteeType === 'ROLE' && !granteeRoleId) {
      onError('Select a role.');
      return;
    }
    try {
      await apiFetch(`/documents/${documentId}/grants`, {
        method: 'POST',
        body: JSON.stringify({
          granteeType,
          ...(granteeType === 'USER' ? { granteeUserId } : { granteeRoleId }),
          canView,
          canDownload,
        }),
      });
      onError(null);
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to grant access.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Grant document access</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void submit()}>Grant</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
        <select value={granteeType} onChange={(e) => setGranteeType(e.target.value as 'USER' | 'ROLE')} style={{ ...selectStyle, width: 170 }}>
          <option value="USER">Specific user</option>
          <option value="ROLE">Role</option>
        </select>
        {granteeType === 'USER' ? (
          <select value={granteeUserId} onChange={(e) => setGranteeUserId(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 220 }}>
            <option value="">Select user…</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.fullName}</option>
            ))}
          </select>
        ) : (
          <select value={granteeRoleId} onChange={(e) => setGranteeRoleId(e.target.value)} style={{ ...selectStyle, flex: 1, minWidth: 220 }}>
            <option value="">Select role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
            ))}
          </select>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={canView} onChange={(e) => setCanView(e.target.checked)} />
          Can view
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={canDownload} onChange={(e) => setCanDownload(e.target.checked)} />
          Can download
        </label>
      </div>
    </Card>
  );
}

// ── Document types tab ──────────────────────────────────────────────────────

function TypesTab({
  canManage,
  onError,
  onNotice,
}: {
  canManage: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [rows, setRows] = useState<DocumentTypeRow[]>([]);
  const [editor, setEditor] = useState<DocumentTypeRow | 'new' | null>(null);

  const load = useCallback(async () => {
    onError(null);
    try {
      setRows(await apiFetch<DocumentTypeRow[]>('/document-types'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load document types.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    if (!window.confirm('Delete this document type? Existing documents keep resolving it (soft delete).')) return;
    try {
      await apiFetch(`/document-types/${id}`, { method: 'DELETE' });
      onNotice('Document type deleted.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete document type.');
    }
  };

  const blankEditor: DocumentTypeRow = {
    id: '',
    code: '',
    name: '',
    description: null,
    allowedMimeTypes: null,
    allowedExtensions: null,
    maxSizeBytes: null,
    isSensitive: false,
    canExpire: false,
    retentionDays: null,
    isActive: true,
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Document types</h2>
          {canManage && <Button onClick={() => setEditor('new')}>New type</Button>}
        </div>

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No document types yet — create one to enforce MIME/size/retention policies per kind of document.</p>}

        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Extensions</th>
                <th style={{ padding: 8 }}>Max size</th>
                <th style={{ padding: 8 }}>Sensitive</th>
                <th style={{ padding: 8 }}>Expiry</th>
                <th style={{ padding: 8 }}>Retention</th>
                <th style={{ padding: 8 }}>Active</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{t.code}</td>
                  <td style={{ padding: 8 }}>{t.name}</td>
                  <td style={{ padding: 8 }}>{(t.allowedExtensions ?? []).join(', ') || 'any'}</td>
                  <td style={{ padding: 8 }}>{t.maxSizeBytes ? fmtBytes(t.maxSizeBytes) : 'global cap'}</td>
                  <td style={{ padding: 8 }}>{t.isSensitive ? 'Yes' : 'No'}</td>
                  <td style={{ padding: 8 }}>{t.canExpire ? 'Yes' : 'No'}</td>
                  <td style={{ padding: 8 }}>{t.retentionDays ? `${t.retentionDays} days` : '—'}</td>
                  <td style={{ padding: 8 }}>{t.isActive ? 'Yes' : 'No'}</td>
                  <td style={{ padding: 8, textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canManage && (
                      <>
                        <Button variant="secondary" style={{ marginRight: 6 }} onClick={() => setEditor(t)}>Edit</Button>
                        <Button variant="secondary" onClick={() => void remove(t.id)}>Delete</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editor && (
        <TypeEditor
          isNew={editor === 'new'}
          initial={editor === 'new' ? blankEditor : editor}
          onClose={() => setEditor(null)}
          onChanged={() => void load()}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

function TypeEditor({
  isNew,
  initial,
  onClose,
  onChanged,
  onError,
  onNotice,
}: {
  isNew: boolean;
  initial: DocumentTypeRow;
  onClose: () => void;
  onChanged: () => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [f, setF] = useState<DocumentTypeRow>(initial);
  const update = (patch: Partial<DocumentTypeRow>) => setF((cur) => ({ ...cur, ...patch }));

  const save = async () => {
    if (!f.code.trim() || !f.name.trim()) {
      onError('Code and name are required.');
      return;
    }
    const payload = {
      ...(isNew ? { code: f.code.trim().toUpperCase() } : {}),
      name: f.name.trim(),
      ...(f.description ? { description: f.description } : {}),
      allowedMimeTypes: f.allowedMimeTypes?.length ? f.allowedMimeTypes : undefined,
      allowedExtensions: f.allowedExtensions?.length ? f.allowedExtensions : undefined,
      ...(f.maxSizeBytes ? { maxSizeBytes: Number(f.maxSizeBytes) } : {}),
      isSensitive: f.isSensitive,
      canExpire: f.canExpire,
      ...(f.retentionDays ? { retentionDays: Number(f.retentionDays) } : {}),
      isActive: f.isActive,
    };
    try {
      if (isNew) {
        await apiFetch('/document-types', { method: 'POST', body: JSON.stringify(payload) });
        onNotice('Document type created.');
      } else {
        await apiFetch(`/document-types/${f.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        onNotice('Document type updated.');
      }
      onError(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save document type.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{isNew ? 'New document type' : `Document type — ${f.code}`}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => void save()}>Save</Button>
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {isNew && (
          <Input value={f.code} onChange={(e) => update({ code: e.target.value })} placeholder="Code (e.g. MARKSHEET)" style={{ width: 160 }} />
        )}
        <Input value={f.name} onChange={(e) => update({ name: e.target.value })} placeholder="Name" style={{ flex: 1, minWidth: 180 }} />
        <Input
          value={f.allowedExtensions?.join(', ') ?? ''}
          onChange={(e) => update({ allowedExtensions: e.target.value.split(',').map((x) => x.trim().replace(/^\./, '')).filter(Boolean) })}
          placeholder="Extensions (comma separated, no dots)"
          style={{ flex: 1, minWidth: 200 }}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Input
          value={f.allowedMimeTypes?.join(', ') ?? ''}
          onChange={(e) => update({ allowedMimeTypes: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })}
          placeholder="MIME types (comma separated; blank = any)"
          style={{ flex: 1, minWidth: 220 }}
        />
        <Input
          value={f.maxSizeBytes ? String(f.maxSizeBytes) : ''}
          onChange={(e) => update({ maxSizeBytes: e.target.value ? Number(e.target.value) : null })}
          placeholder="Max size bytes"
          type="number"
          style={{ width: 150 }}
        />
        <Input
          value={f.retentionDays ? String(f.retentionDays) : ''}
          onChange={(e) => update({ retentionDays: e.target.value ? Number(e.target.value) : null })}
          placeholder="Retention days"
          type="number"
          style={{ width: 130 }}
        />
      </div>
      <Input value={f.description ?? ''} onChange={(e) => update({ description: e.target.value })} placeholder="Description (optional)" style={{ width: '100%', marginBottom: 12 }} />
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={f.isSensitive} onChange={(e) => update({ isSensitive: e.target.checked })} />
          Sensitive (reviewers must verify)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={f.canExpire} onChange={(e) => update({ canExpire: e.target.checked })} />
          Allow expiry dates
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={f.isActive} onChange={(e) => update({ isActive: e.target.checked })} />
          Active
        </label>
      </div>
    </Card>
  );
}