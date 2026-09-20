import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import {
  APPLICATION_STATUSES,
  DOCUMENT_CHECKLIST,
  PAYMENT_METHODS,
  type AdmissionDocument,
  type AdmissionSessionRow,
  type ApplicationDetail,
  type ApplicationRow,
  type CounsellingSlot,
  downloadCsv,
  fmtDate,
  money,
} from './admissions';

export function ApplicationsTab({
  canCreate,
  canUpdate,
  canApprove,
  canExport,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
  canExport: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<ApplicationRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [sessions, setSessions] = useState<AdmissionSessionRow[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const TAKE = 20;

  const params = useMemo(() => {
    const p = new URLSearchParams({ skip: String(skip), take: String(TAKE) });
    if (q) p.set('search', q);
    if (status) p.set('status', status);
    if (sessionId) p.set('sessionId', sessionId);
    return p;
  }, [q, status, sessionId, skip]);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<{ data: ApplicationRow[]; total: number }>(`/admissions/applications?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load applications.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  useEffect(() => {
    setSkip(0);
  }, [q, status, sessionId]);

  useEffect(() => {
    void (async () => {
      try {
        setSessions((await apiFetch<AdmissionSessionRow[]>('/admissions/sessions')) ?? []);
      } catch {
        setSessions([]);
      }
    })();
  }, []);

  const exportCsv = async () => {
    try {
      const res = await apiFetch<{ csv: string; filename: string }>(`/admissions/export/applications?${params.toString()}`);
      downloadCsv(res.csv, res.filename);
      onNotice(`Exported to ${res.filename}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 220 }}>
            <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="application #, name, email…" />
          </div>
          <div style={{ width: 180 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#374151', marginBottom: 4 }}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
              <option value="">All statuses</option>
              {APPLICATION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <div style={{ width: 180 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#374151', marginBottom: 4 }}>Session</label>
            <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
              <option value="">All sessions</option>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.code}</option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={() => void load()}>Apply</Button>
          {canExport && <Button variant="secondary" onClick={() => void exportCsv()}>Export CSV</Button>}
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#6b7280' }}>{total} application(s)</span>
        </div>

        {rows === null && <p>Loading…</p>}
        {rows !== null && rows.length === 0 && <p style={{ color: '#9ca3af' }}>No applications found.</p>}
        {rows !== null && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Application #</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Program</th>
                <th style={{ padding: 8 }}>Campus</th>
                <th style={{ padding: 8 }}>Merit</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{row.applicationNumber}</td>
                  <td style={{ padding: 8 }}>{row.fullName}</td>
                  <td style={{ padding: 8 }}>{row.admissionProgram?.program?.name ?? '—'}</td>
                  <td style={{ padding: 8 }}>{row.campus?.name ?? '—'}</td>
                  <td style={{ padding: 8 }}>{row.meritRank != null ? `#${row.meritRank}` : row.meritScore != null ? `${row.meritScore}` : '—'}</td>
                  <td style={{ padding: 8 }}>{row.status}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" onClick={() => setOpenId(openId === row.id ? null : row.id)}>
                      {openId === row.id ? 'Close' : 'View'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, alignItems: 'center' }}>
          <Button variant="secondary" disabled={skip === 0 || rows === null} onClick={() => setSkip(Math.max(0, skip - TAKE))}>
            Previous
          </Button>
          <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            {skip + 1}–{Math.min(skip + TAKE, total)} of {total}
          </span>
          <Button variant="secondary" disabled={skip + TAKE >= total || rows === null} onClick={() => setSkip(skip + TAKE)}>
            Next
          </Button>
        </div>
      </Card>

      {openId && (
        <ApplicationDetail
          applicationId={openId}
          canCreate={canCreate}
          canUpdate={canUpdate}
          canApprove={canApprove}
          onChanged={() => setReloadKey((k) => k + 1)}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

export function ApplicationDetail({
  applicationId,
  canCreate,
  canUpdate,
  canApprove,
  onChanged,
  onError,
  onNotice,
}: {
  applicationId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canApprove: boolean;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [app, setApp] = useState<ApplicationDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<CounsellingSlot[]>([]);
  const [slotChoice, setSlotChoice] = useState('');
  const [docCategory, setDocCategory] = useState('');
  const [docName, setDocName] = useState('');
  const [qual, setQual] = useState({ institution: '', degree: '', yearOfPassing: '', percentage: '', isHighest: false });

  const load = useCallback(async () => {
    try {
      setApp(await apiFetch<ApplicationDetail>(`/admissions/applications/${applicationId}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load application detail.');
    }
  }, [applicationId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!applicationId) return;
    void (async () => {
      try {
        const list = (await apiFetch<CounsellingSlot[]>('/admissions/counselling-slots')) ?? [];
        setSlots(list);
        setSlotChoice((c) => c || list[0]?.id || '');
      } catch {
        setSlots([]);
      }
    })();
  }, [applicationId]);

  const run = async (path: string, method: 'POST' | 'PATCH', body?: Record<string, unknown>, msg?: string) => {
    setBusy(true);
    try {
      await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      if (msg) onNotice(msg);
      await load();
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (!app) return <Card><p>Loading detail…</p></Card>;

  const status = app.status;
  const actions: React.ReactNode[] = [];

  if (canUpdate && status === 'INITIATED') {
    actions.push(
      <Button key="submit" disabled={busy} onClick={() => void run(`/admissions/applications/${app.id}/submit`, 'POST', undefined, 'Submitted.')}>
        Submit application
      </Button>,
    );
  }
  if (canApprove && (status === 'SUBMITTED' || status === 'UNDER_VERIFICATION')) {
    actions.push(
      <Button key="verify" disabled={busy} onClick={() => void run(`/admissions/applications/${app.id}/complete-verification`, 'POST', undefined, 'Verification completed.')}>
        Complete verification
      </Button>,
    );
  }
  if (canUpdate && (status === 'DOCUMENTS_VERIFIED' || status === 'MERIT_LISTED')) {
    actions.push(
      <Button key="score" disabled={busy} onClick={() => void run(`/admissions/applications/${app.id}/score`, 'POST', { auto: true }, 'Auto-scored from qualifications.')}>
        Auto-score
      </Button>,
    );
  }
  if (app.offers.length === 0 && status === 'COUNSELLED') {
    actions.push(
      <span key="decision" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <Button
          disabled={busy}
          onClick={() => void run(`/admissions/applications/${app.id}/counselled`, 'POST', { decision: 'SELECTED' }, 'Marked selected.')}
        >
          Mark selected
        </Button>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => void run(`/admissions/applications/${app.id}/counselled`, 'POST', { decision: 'WAITLISTED' }, 'Marked waitlisted.')}
        >
          Waitlist
        </Button>
      </span>,
    );
  }
  if (canCreate && status === 'SELECTED') {
    actions.push(
      <span key="slot" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <label style={{ fontSize: '0.85rem', color: '#374151' }}>Slot</label>
        <select value={slotChoice} onChange={(e) => setSlotChoice(e.target.value)} style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
          {slots.map((s) => (
            <option key={s.id} value={s.id}>{fmtDate(s.date)} {s.venue ?? ''}</option>
          ))}
        </select>
        <Button disabled={busy || !slotChoice} onClick={() => void run(`/admissions/applications/${app.id}/book-counselling`, 'POST', { counsellingSlotId: slotChoice }, 'Slot booked.')}>
          Book slot
        </Button>
      </span>,
    );
  }
  if (canApprove && status === 'SELECTED') {
    actions.push(
      <Button key="offer" disabled={busy} onClick={() => void run(`/admissions/applications/${app.id}/offer`, 'POST', {}, 'Offer issued.')}>
        Issue offer
      </Button>,
    );
  }
  if (canApprove && status === 'OFFER_ACCEPTED') {
    actions.push(
      <span key="pay" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
        <label style={{ fontSize: '0.85rem', color: '#374151' }}>Method</label>
        <select defaultValue="CASH" id="pay-method" style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
          {PAYMENT_METHODS.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <Button
          disabled={busy}
          onClick={() => {
            const el = document.getElementById('pay-method') as HTMLSelectElement;
            void run(`/admissions/applications/${app.id}/fees/pay`, 'POST', { method: el?.value ?? 'CASH' }, 'Admission fee recorded.');
          }}
        >
          Record admission fee
        </Button>
      </span>,
    );
  }
  if (canApprove && status === 'FEE_PAID') {
    actions.push(
      <Button key="enroll" disabled={busy} onClick={() => void run(`/admissions/applications/${app.id}/enroll`, 'POST', {}, 'Enrolled — student created.')}>
        Enroll (create student)
      </Button>,
    );
  }
  if (canUpdate && !['ENROLLED', 'REJECTED', 'CANCELLED'].includes(status)) {
    actions.push(
      <Button key="cancel" variant="secondary" disabled={busy} onClick={() => void run(`/admissions/applications/${app.id}/cancel`, 'POST', { reason: 'Cancelled by admissions office' }, 'Cancelled.')}>
        Cancel application
      </Button>,
    );
  }

  const pendingDocs = app.documents.filter((d: AdmissionDocument) => d.status === 'PENDING');
  const checklist = (app.session as unknown as { requiredDocuments?: string[] } | undefined)?.requiredDocuments?.length
    ? (app.session as { requiredDocuments: string[] }).requiredDocuments
    : DOCUMENT_CHECKLIST;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{app.applicationNumber} — {app.fullName}</h2>
        <span style={{ fontSize: '0.9rem', color: '#374151' }}>Status: <strong>{app.status}</strong></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: '0.9rem', marginBottom: 12 }}>
        <p><strong>Program:</strong> {app.admissionProgram?.program?.name ?? '—'}</p>
        <p><strong>Campus:</strong> {app.campus?.name ?? '—'}</p>
        <p><strong>Academic year:</strong> {app.academicYear?.code ?? '—'}</p>
        <p><strong>Contact:</strong> {app.email ?? '—'} / {app.phone ?? '—'}</p>
        <p><strong>DOB:</strong> {fmtDate(app.dateOfBirth)}</p>
        <p><strong>Merit:</strong> {app.meritScore ?? '—'}{app.meritRank != null ? ` (rank #${app.meritRank})` : ''}</p>
      </div>

      {actions.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, alignItems: 'center' }}>{actions}</div>
      )}

      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Documents</h3>
      {canCreate && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label>
            <span style={{ fontSize: '0.85rem', color: '#374151' }}>Category</span>
            <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} style={{ padding: '0.45rem', borderRadius: 6, border: '1px solid #d1d5db', marginLeft: 6 }}>
              <option value="">—</option>
              {checklist.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <Input label="Document name" value={docName} onChange={(e) => setDocName(e.target.value)} placeholder="e.g. 12th marksheet.jpg" />
          <Button
            disabled={busy || !docCategory || !docName.trim()}
            onClick={() => void (async () => {
              await run(`/admissions/applications/${app.id}/documents`, 'POST', { category: docCategory.toUpperCase(), documentName: docName.trim() }, 'Document attached (pending verification).');
              setDocCategory('');
              setDocName('');
            })()}
          >
            Attach document
          </Button>
        </div>
      )}
      {app.documents.length === 0 && <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>No documents attached.</p>}
      {app.documents.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Category</th>
              <th style={{ padding: 8 }}>Name</th>
              <th style={{ padding: 8 }}>Status</th>
              <th style={{ padding: 8 }}>Remarks</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {app.documents.map((d) => (
              <tr key={d.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{d.category}</td>
                <td style={{ padding: 8 }}>{d.documentName}</td>
                <td style={{ padding: 8 }}>{d.status}</td>
                <td style={{ padding: 8 }}>{d.remarks ?? '—'}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>
                  {canApprove && d.status === 'PENDING' && (
                    <>
                      <Button variant="secondary" style={{ marginRight: 8 }} disabled={busy} onClick={() => void run(`/admissions/documents/${d.id}/verify`, 'POST', {}, 'Document verified.')}>
                        Verify
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() => void (async () => {
                          const reason = window.prompt('Rejection reason:');
                          if (!reason) return;
                          await run(`/admissions/documents/${d.id}/reject`, 'POST', { remarks: reason }, 'Document rejected.');
                        })()}
                      >
                        Reject
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {pendingDocs.length > 0 && (
        <p style={{ fontSize: '0.85rem', color: '#b45309', marginTop: 8 }}>{pendingDocs.length} document(s) awaiting verification.</p>
      )}

      <h3 style={{ fontSize: '0.95rem', margin: '16px 0 8px' }}>Qualifications</h3>
      {canCreate && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Input label="Institution" value={qual.institution} onChange={(e) => setQual((p) => ({ ...p, institution: e.target.value }))} />
          <Input label="Degree" value={qual.degree} onChange={(e) => setQual((p) => ({ ...p, degree: e.target.value }))} />
          <Input label="Year" type="number" value={qual.yearOfPassing} onChange={(e) => setQual((p) => ({ ...p, yearOfPassing: e.target.value }))} />
          <Input label="Percentage" type="number" value={qual.percentage} onChange={(e) => setQual((p) => ({ ...p, percentage: e.target.value }))} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={qual.isHighest} onChange={(e) => setQual((p) => ({ ...p, isHighest: e.target.checked }))} />
            <span style={{ fontSize: '0.85rem', color: '#374151' }}>Highest</span>
          </label>
          <Button
            disabled={busy || !qual.institution.trim()}
            onClick={() => void (async () => {
              await run(`/admissions/applications/${app.id}/qualifications`, 'POST', {
                institution: qual.institution.trim(),
                degree: qual.degree.trim() || undefined,
                yearOfPassing: qual.yearOfPassing ? Number(qual.yearOfPassing) : undefined,
                percentage: qual.percentage ? Number(qual.percentage) : undefined,
                isHighestQualification: qual.isHighest || undefined,
              }, 'Qualification added.');
              setQual({ institution: '', degree: '', yearOfPassing: '', percentage: '', isHighest: false });
            })()}
          >
            Add qualification
          </Button>
        </div>
      )}
      {app.qualifications.length === 0 && <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>No qualifications recorded.</p>}
      {app.qualifications.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Institution</th>
              <th style={{ padding: 8 }}>Degree</th>
              <th style={{ padding: 8 }}>Year</th>
              <th style={{ padding: 8 }}>Percentage</th>
              <th style={{ padding: 8 }}>GPA</th>
              <th style={{ padding: 8 }}>Highest</th>
            </tr>
          </thead>
          <tbody>
            {app.qualifications.map((q) => (
              <tr key={q.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                <td style={{ padding: 8 }}>{q.institution}</td>
                <td style={{ padding: 8 }}>{q.degree ?? '—'}</td>
                <td style={{ padding: 8 }}>{q.yearOfPassing ?? '—'}</td>
                <td style={{ padding: 8 }}>{q.percentage ?? '—'}</td>
                <td style={{ padding: 8 }}>{q.gpa ?? '—'}</td>
                <td style={{ padding: 8 }}>{q.isHighestQualification ? '✓' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {app.offers.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.95rem', margin: '16px 0 8px' }}>Offers</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Offer #</th>
                <th style={{ padding: 8 }}>Admission fee</th>
                <th style={{ padding: 8 }}>Expires</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {app.offers.map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{o.offerNumber}</td>
                  <td style={{ padding: 8 }}>{money(o.admissionFeeCents)}</td>
                  <td style={{ padding: 8 }}>{fmtDate(o.expiresAt)}</td>
                  <td style={{ padding: 8 }}>{o.status}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {canApprove && o.status === 'ISSUED' && (
                      <>
                        <Button variant="secondary" style={{ marginRight: 8 }} disabled={busy} onClick={() => void run(`/admissions/offers/${o.id}/accept`, 'POST', {}, 'Offer accepted.')}>
                          Accept
                        </Button>
                        <Button variant="secondary" disabled={busy} onClick={() => void run(`/admissions/offers/${o.id}/decline`, 'POST', {}, 'Offer declined.')}>
                          Decline
                        </Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {app.payments.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.95rem', margin: '16px 0 8px' }}>Payments</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Receipt</th>
                <th style={{ padding: 8 }}>Amount</th>
                <th style={{ padding: 8 }}>Method</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Date</th>
              </tr>
            </thead>
            <tbody>
              {app.payments.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{p.receiptNumber}</td>
                  <td style={{ padding: 8 }}>{money(p.amountCents)}</td>
                  <td style={{ padding: 8 }}>{p.method}</td>
                  <td style={{ padding: 8 }}>{p.status}</td>
                  <td style={{ padding: 8 }}>{fmtDate(p.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {app.activities.length > 0 && (
        <>
          <h3 style={{ fontSize: '0.95rem', margin: '16px 0 8px' }}>Timeline</h3>
          <ul style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.85rem' }}>
            {app.activities.map((a) => (
              <li key={a.id}>
                <span style={{ color: '#6b7280' }}>{new Date(a.occurredAt).toLocaleString()}</span> — <strong>{a.title}</strong>
                {a.description ? ` · ${a.description}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}