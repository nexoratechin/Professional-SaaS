import React, { useEffect } from 'react';
import { Button, Card } from '@college-erp/ui';
import { QrImage } from '../../features/pwa/qr-image';
import { PageShell, StatusBadge, fmtDate, usePortalData } from './portal-shared';

interface IdCardResponse {
  student: {
    id: string;
    fullName: string;
    admissionNumber: string;
    rollNumber: string | null;
    registrationNumber: string | null;
    status: string;
    dateOfBirth: string | null;
    bloodGroup: string;
    hasPhoto: boolean;
    admittedOn: string | null;
    campus: { name: string; code: string } | null;
    program: { name: string; code: string } | null;
    section: { name: string; code: string } | null;
    batch: { name: string } | null;
    academicYear: { name: string } | null;
  };
  token: string;
  verifyUrl: string;
  institutionName: string;
}

const PRINT_CSS = `
@media print {
  body * { visibility: hidden !important; }
  #pwa-id-card, #pwa-id-card * { visibility: visible !important; }
  #pwa-id-card { position: absolute; left: 0; top: 0; box-shadow: none !important; }
}
`;

export function PortalIdCardPage() {
  const { data, error, loading } = usePortalData<IdCardResponse>('/student-portal/id-card');

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = PRINT_CSS;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  return (
    <PageShell
      title="Digital ID"
      subtitle="Your scannable campus identity — show it at the gate, library and attendance check-in."
      error={error}
      loading={loading}
      actions={
        <Button variant="secondary" onClick={() => window.print()} disabled={!data}>
          Print / Save
        </Button>
      }
    >
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            id="pwa-id-card"
            style={{
              maxWidth: 420,
              border: '2px solid #1d4ed8',
              borderRadius: 16,
              padding: 18,
              background: 'linear-gradient(160deg, #eef2ff, #ffffff 55%)',
              boxShadow: '0 10px 30px rgba(30,64,175,0.15)',
              display: 'flex',
              gap: 16,
              alignItems: 'center',
            }}
          >
            <QrImage value={data.verifyUrl} size={132} alt="Student digital ID QR" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <p style={{ margin: 0, fontWeight: 700 }}>{data.institutionName}</p>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#475569' }}>
                {data.student.program?.name ?? '—'}
              </p>
              <p style={{ margin: '4px 0 0', fontWeight: 700, fontSize: '1.05rem', wordBreak: 'break-word' }}>
                {data.student.fullName}
              </p>
              <p style={{ margin: 0, fontSize: '0.85rem' }}>
                ID {data.student.admissionNumber}
                {data.student.rollNumber ? ` · Roll ${data.student.rollNumber}` : ''}
              </p>
              <p style={{ margin: 0, fontSize: '0.8rem', color: '#475569' }}>
                {data.student.campus?.name ?? '—'} · {data.student.section?.name ?? '—'}
              </p>
              <p style={{ margin: 0, fontSize: '0.75rem', color: '#64748b' }}>
                Valid while status is active · {data.student.status}
              </p>
            </div>
          </div>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>Card details</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 4 }}>
              <div className="sp-kv"><span>Status</span><span><StatusBadge value={data.student.status} /></span></div>
              <div className="sp-kv"><span>Admission number</span><span>{data.student.admissionNumber}</span></div>
              <div className="sp-kv"><span>Registration number</span><span>{data.student.registrationNumber ?? '—'}</span></div>
              <div className="sp-kv"><span>Roll number</span><span>{data.student.rollNumber ?? '—'}</span></div>
              <div className="sp-kv"><span>Program</span><span>{data.student.program ? `${data.student.program.name} (${data.student.program.code})` : '—'}</span></div>
              <div className="sp-kv"><span>Campus</span><span>{data.student.campus?.name ?? '—'}</span></div>
              <div className="sp-kv"><span>Batch / Section</span><span>{`${data.student.batch?.name ?? '—'} / ${data.student.section?.name ?? '—'}`}</span></div>
              <div className="sp-kv"><span>Academic year</span><span>{data.student.academicYear?.name ?? '—'}</span></div>
              <div className="sp-kv"><span>Date of birth</span><span>{fmtDate(data.student.dateOfBirth)}</span></div>
              <div className="sp-kv"><span>Blood group</span><span>{data.student.bloodGroup.replace(/_/g, ' ')}</span></div>
              <div className="sp-kv"><span>Admitted on</span><span>{fmtDate(data.student.admittedOn)}</span></div>
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginTop: 0 }}>How it works</h2>
            <ul style={{ margin: 0, paddingLeft: 18, color: '#475569', fontSize: '0.9rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li>Campus staff scan the QR to verify your identity against the college records.</li>
              <li>Use the attendance screen's <strong>Scan to check in</strong> action to mark yourself present in an open class session.</li>
              <li>The code contains no personal data — only an opaque token that resolves server-side.</li>
              <li>If you believe your card was exposed, contact the registrar to have the token rotated.</li>
            </ul>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
