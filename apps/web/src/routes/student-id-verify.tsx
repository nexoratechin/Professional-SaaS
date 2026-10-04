import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import { StatusBadge } from './portal/portal-shared';

interface VerifyResponse {
  valid: boolean;
  student?: {
    fullName: string;
    admissionNumber: string;
    rollNumber: string | null;
    status: string;
    hasPhoto: boolean;
    campus: { name: string; code: string } | null;
    program: { name: string; code: string } | null;
  };
  verifiedAt?: string;
}

/** Public landing for a scanned student digital-ID QR. No auth, no tenant header — the opaque
 *  token is the credential and the API returns only a minimal identity projection. */
export function StudentIdVerifyPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [result, setResult] = useState<VerifyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setError('No verification token supplied.');
      setLoading(false);
      return;
    }
    let cancelled = false;
    apiFetch<VerifyResponse>(`/public/student-id/verify/${encodeURIComponent(token)}`, { skipAuth: true })
      .then((data) => {
        if (!cancelled) setResult(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Verification failed.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#f8fafc', padding: 20 }}>
      <Card style={{ maxWidth: 460, width: '100%' }}>
        <h1 style={{ fontSize: '1.2rem', marginTop: 0 }}>Student ID verification</h1>
        {loading && <p style={{ color: '#64748b' }}>Checking…</p>}
        {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
        {result && !result.valid && (
          <div>
            <p style={{ color: '#b91c1c', fontWeight: 600 }}>Not a valid College ERP student ID.</p>
            <p style={{ color: '#64748b', fontSize: '0.9rem' }}>
              The code may be damaged, revoked, or from a different institution.
            </p>
          </div>
        )}
        {result?.valid && result.student && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <p style={{ color: '#15803d', fontWeight: 700, margin: 0 }}>✓ Verified student</p>
            <div className="sp-kv"><span>Name</span><span>{result.student.fullName}</span></div>
            <div className="sp-kv"><span>Admission number</span><span>{result.student.admissionNumber}</span></div>
            <div className="sp-kv"><span>Roll number</span><span>{result.student.rollNumber ?? '—'}</span></div>
            <div className="sp-kv"><span>Program</span><span>{result.student.program ? `${result.student.program.name} (${result.student.program.code})` : '—'}</span></div>
            <div className="sp-kv"><span>Campus</span><span>{result.student.campus?.name ?? '—'}</span></div>
            <div className="sp-kv"><span>Status</span><span><StatusBadge value={result.student.status} /></span></div>
            {result.verifiedAt && (
              <p style={{ color: '#94a3b8', fontSize: '0.75rem', margin: 0 }}>
                Verified {new Date(result.verifiedAt).toLocaleString()}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
