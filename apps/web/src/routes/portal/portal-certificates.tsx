import React, { useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { Column, DataTable, PageShell, Stat, StatusBadge, apiFetch, fmtDate, usePortalData } from './portal-shared';

interface Certificate {
  id: string;
  certificateType: string;
  certificateNumber: string | null;
  title: string | null;
  requestDate: string;
  status: string;
  issuedAt: string | null;
  storageKey: string | null;
  template: { id: string; code: string; name: string } | null;
}

interface CertificatesResponse {
  certificates: Certificate[];
  summary: { total: number; pending: number; issued: number };
}

const TYPES = [
  'BONAFIDE',
  'PROVISIONAL',
  'MIGRATION',
  'TRANSCRIPT',
  'TRANSFER_CERTIFICATE',
  'GRADE_CARD',
  'MARKSHEET',
  'CHARACTER_CERTIFICATE',
  'TESTIMONIAL',
  'OTHER',
];

export function PortalCertificatesPage() {
  const { data, error, loading, reload } = usePortalData<CertificatesResponse>('/student-portal/certificates');
  const [certificateType, setCertificateType] = useState('BONAFIDE');
  const [title, setTitle] = useState('');
  const [remarks, setRemarks] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const request = async () => {
    setSubmitting(true);
    setActionError(null);
    setNotice(null);
    try {
      await apiFetch('/student-portal/certificates', {
        method: 'POST',
        body: JSON.stringify({ certificateType, title: title || undefined, remarks: remarks || undefined }),
      });
      setNotice('Certificate request submitted.');
      setTitle('');
      setRemarks('');
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Request failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const download = async (certificate: Certificate) => {
    setActionError(null);
    try {
      const result = await apiFetch<{ downloadUrl: string }>(`/student-portal/certificates/${certificate.id}/download-url`);
      window.open(result.downloadUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Download unavailable.');
    }
  };

  const columns: Column<Certificate>[] = [
    { label: 'Type', render: (row) => row.certificateType.replace(/_/g, ' ') },
    { label: 'Title', render: (row) => row.title ?? '—' },
    { label: 'Number', render: (row) => row.certificateNumber ?? '—' },
    { label: 'Requested', render: (row) => fmtDate(row.requestDate) },
    { label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
    { label: 'Issued', render: (row) => fmtDate(row.issuedAt) },
    {
      label: 'Action',
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
    <PageShell title="Certificates" subtitle="Request bonafide, transcripts and other documents." error={error ?? actionError} notice={notice} loading={loading}>
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="sp-grid">
            <Stat label="Issued" value={data.summary.issued} />
            <Stat label="In progress" value={data.summary.pending} />
            <Stat label="Total requests" value={data.summary.total} />
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>New request</h2>
            <div className="sp-cards" style={{ alignItems: 'end' }}>
              <label className="sp-row">
                <span className="sp-muted">Certificate type</span>
                <select value={certificateType} onChange={(event) => setCertificateType(event.target.value)} style={{ padding: 8, borderRadius: 8, border: '1px solid #cbd5e1' }}>
                  {TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <Input label="Title (optional)" name="title" value={title} onChange={(event) => setTitle(event.target.value)} />
              <Input label="Remarks (optional)" name="remarks" value={remarks} onChange={(event) => setRemarks(event.target.value)} />
              <Button onClick={request} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Request certificate'}
              </Button>
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>My requests</h2>
            <DataTable columns={columns} rows={data.certificates} rowKey={(row) => row.id} empty="No certificate requests yet." />
          </Card>
        </div>
      )}
    </PageShell>
  );
}
