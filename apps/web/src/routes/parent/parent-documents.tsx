import React, { useState } from 'react';
import { Button, Card } from '@college-erp/ui';
import { Column, DataTable, PageShell, Stat, StatusBadge, apiFetch, fmtDate } from '../portal/portal-shared';
import { useParentData } from './parent-context';

interface StudentDocument {
  id: string;
  category: string;
  documentName: string;
  originalFilename: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  status: string;
  storageKey: string | null;
  createdAt: string;
}

interface DocumentsResponse {
  studentDocuments: StudentDocument[];
  total: number;
  summary: { uploads: number; pending: number };
}

function humanSize(bytes: number | null): string {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ParentDocumentsPage() {
  const { data, error, loading } = useParentData<DocumentsResponse>('/parent-portal/documents', { take: 100 });
  const [actionError, setActionError] = useState<string | null>(null);

  const download = async (document: StudentDocument) => {
    setActionError(null);
    try {
      const result = await apiFetch<{ downloadUrl: string }>(`/parent-portal/documents/${document.id}/download-url`);
      window.open(result.downloadUrl, '_blank', 'noopener');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Download unavailable.');
    }
  };

  const columns: Column<StudentDocument>[] = [
    { label: 'Document', render: (row) => row.documentName },
    { label: 'Category', render: (row) => row.category.replace(/_/g, ' ') },
    { label: 'File', render: (row) => row.originalFilename ?? '—' },
    { label: 'Size', render: (row) => humanSize(row.sizeBytes) },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Added', render: (row) => fmtDate(row.createdAt) },
    {
      label: '',
      render: (row) =>
        row.storageKey ? (
          <Button variant="secondary" onClick={() => download(row)}>
            Download
          </Button>
        ) : (
          <span className="sp-muted">—</span>
        ),
    },
  ];

  return (
    <PageShell
      title="Documents"
      subtitle="Documents on your child's profile."
      error={error ?? actionError}
      loading={loading}
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Documents" value={data.summary.uploads} />
            <Stat label="Pending verification" value={data.summary.pending} />
          </div>
          <Card>
            <DataTable columns={columns} rows={data.studentDocuments} rowKey={(row) => row.id} empty="No documents on record." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
