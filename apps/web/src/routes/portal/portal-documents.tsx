import React, { useRef, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { Column, DataTable, PageShell, Stat, StatusBadge, apiFetch, fmtDate, usePortalData } from './portal-shared';

interface PortalDocument {
  id: string;
  title: string;
  category: string;
  status: string;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  createdAt: string;
  documentType: { id: string; code: string; name: string } | null;
}

interface StudentDocument {
  id: string;
  category: string;
  documentName: string;
  originalFilename: string | null;
  status: string;
  createdAt: string;
}

interface DocumentsResponse {
  documents: PortalDocument[];
  studentDocuments: StudentDocument[];
  total: number;
  summary: { uploads: number; studentDocs: number };
}

function humanSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function PortalDocumentsPage() {
  const { data, error, loading, reload } = usePortalData<DocumentsResponse>('/student-portal/documents?take=100');
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const upload = async () => {
    const input = fileRef.current;
    const file = input?.files?.item(0);
    if (!file) {
      setActionError('Choose a file to upload.');
      return;
    }
    setUploading(true);
    setActionError(null);
    setNotice(null);
    try {
      const init = await apiFetch<{ uploadUrl: string; documentId: string }>('/student-portal/documents/upload-url', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', title: title || undefined }),
      });
      const putResponse = await fetch(init.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!putResponse.ok) {
        throw new Error(`Upload to storage failed (${putResponse.status}).`);
      }
      await apiFetch(`/student-portal/documents/${init.documentId}/confirm-upload`, {
        method: 'POST',
        body: JSON.stringify({ sizeBytes: file.size }),
      });
      setNotice('Document uploaded and queued for virus scan.');
      setTitle('');
      if (input) input.value = '';
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const download = async (document: PortalDocument) => {
    setActionError(null);
    try {
      const result = await apiFetch<{ downloadUrl: string }>(`/student-portal/documents/${document.id}/download-url`);
      window.open(result.downloadUrl, '_blank', 'noopener');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Download unavailable.');
    }
  };

  const columns: Column<PortalDocument>[] = [
    { label: 'Title', render: (row) => row.title || row.originalFilename || '—' },
    { label: 'Type', render: (row) => row.documentType?.name ?? row.category },
    { label: 'Format', render: (row) => row.mimeType ?? '—' },
    { label: 'Size', render: (row) => humanSize(row.sizeBytes) },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Uploaded', render: (row) => fmtDate(row.createdAt) },
    {
      label: '',
      render: (row) =>
        row.status === 'READY' || row.status === 'VERIFIED' || row.status === 'UPLOADED' ? (
          <Button variant="secondary" onClick={() => download(row)}>
            Download
          </Button>
        ) : (
          <span className="sp-muted">—</span>
        ),
    },
  ];

  const studentColumns: Column<StudentDocument>[] = [
    { label: 'Document', render: (row) => row.documentName },
    { label: 'Category', render: (row) => row.category.replace(/_/g, ' ') },
    { label: 'File', render: (row) => row.originalFilename ?? '—' },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Added', render: (row) => fmtDate(row.createdAt) },
  ];

  return (
    <PageShell title="Documents" subtitle="Upload and manage your documents." error={error ?? actionError} notice={notice} loading={loading}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="My uploads" value={data.summary.uploads} />
            <Stat label="Profile documents" value={data.summary.studentDocs} />
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Upload a document</h2>
            <div className="sp-cards" style={{ alignItems: 'end' }}>
              <label className="sp-row">
                <span className="sp-muted">File</span>
                <input ref={fileRef} type="file" />
              </label>
              <Input label="Title (optional)" name="docTitle" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Button onClick={upload} disabled={uploading}>
                {uploading ? 'Uploading…' : 'Upload'}
              </Button>
            </div>
            <p className="sp-muted" style={{ marginTop: 8 }}>
              Files are uploaded directly to secure object storage and virus-scanned before they become downloadable.
            </p>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>My uploads</h2>
            <DataTable columns={columns} rows={data.documents} rowKey={(row) => row.id} empty="No documents uploaded yet." />
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Profile documents</h2>
            <DataTable columns={studentColumns} rows={data.studentDocuments} rowKey={(row) => row.id} empty="No profile documents on record." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
