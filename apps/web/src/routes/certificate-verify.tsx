import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '@college-erp/ui';
import { apiFetch } from '../lib/http';

interface VerifyCertificatePayload {
  valid: boolean;
  reason: string;
  certificate: {
    id: string;
    certificateNumber: string | null;
    certificateType: string;
    title: string | null;
    studentName: string;
    admissionNumber?: string | null;
    status?: string;
    issuedAt?: string | null;
    revokedAt?: string | null;
    revokeReason?: string | null;
  } | null;
}

const VALID = '#15803d';
const INVALID = '#b91c1c';

/** Public QR landing page — no login required. The token alone is the credential, so the page
 * never reads/writes any tenant state and stays outside the authenticated route tree. */
export function CertificateVerifyPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [result, setResult] = useState<VerifyCertificatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState('error');
      setError('No verification token in the URL.');
      return;
    }
    let mounted = true;
    apiFetch<VerifyCertificatePayload>(`/public/certificates/verify/${encodeURIComponent(token)}`, { skipAuth: true })
      .then((res) => {
        if (mounted) {
          setResult(res);
          setState('done');
        }
      })
      .catch((err) => {
        if (mounted) {
          setState('error');
          setError(err instanceof Error ? err.message : 'Verification failed.');
        }
      });
    return () => {
      mounted = false;
    };
  }, [token]);

  return (
    <div style={{ maxWidth: 560, margin: '3rem auto', padding: '0 1rem' }}>
      <Card>
        <h1 style={{ fontSize: '1.25rem', marginBottom: 16 }}>Certificate verification</h1>

        {state === 'loading' && <p style={{ color: '#6b7280' }}>Checking certificate…</p>}

        {state === 'error' && <p style={{ color: INVALID }}>{error}</p>}

        {state === 'done' && result && <ResultView result={result} />}
      </Card>
    </div>
  );
}

function ResultView({ result }: { result: VerifyCertificatePayload }) {
  const cert = result.certificate;
  if (!result.valid || !cert) {
    const subtitle =
      result.reason === 'REVOKED'
        ? 'This certificate has been revoked and is no longer valid.'
        : result.reason === 'NOT_ISSUED'
          ? `This certificate is not issued yet (status: ${cert?.status ?? 'unknown'}).`
          : 'No certificate matches this token. The document may be forged or the link damaged.';
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ color: INVALID, fontWeight: 600, margin: 0 }}>Not valid</p>
        <p style={{ margin: 0 }}>{subtitle}</p>
        {cert && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <tbody>
              <DetailRow label="Certificate no." value={cert.certificateNumber} />
              <DetailRow label="Student" value={cert.studentName} />
              <DetailRow label="Type" value={cert.certificateType} />
              <DetailRow label="Title" value={cert.title} />
              {result.reason === 'REVOKED' && <DetailRow label="Revoked" value={cert.revokedAt ? new Date(cert.revokedAt).toLocaleString() : '—'} />}
              {result.reason === 'REVOKED' && <DetailRow label="Reason" value={cert.revokeReason ?? '—'} />}
            </tbody>
          </table>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p style={{ color: VALID, fontWeight: 600, margin: 0 }}>Valid certificate</p>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <tbody>
          <DetailRow label="Certificate no." value={cert.certificateNumber} />
          <DetailRow label="Student" value={cert.studentName} />
          <DetailRow label="Admission no." value={cert.admissionNumber ?? '—'} />
          <DetailRow label="Type" value={cert.certificateType} />
          <DetailRow label="Title" value={cert.title} />
          <DetailRow label="Issued" value={cert.issuedAt ? new Date(cert.issuedAt).toLocaleString() : '—'} />
          <DetailRow label="Verify source" value="Printed QR code matches the issued record." />
        </tbody>
      </table>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
      <td style={{ padding: '8px 8px 8px 0', color: '#6b7280', width: 160 }}>{label}</td>
      <td style={{ padding: 8 }}>{value ?? '—'}</td>
    </tr>
  );
}