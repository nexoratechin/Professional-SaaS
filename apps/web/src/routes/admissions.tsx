import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { ApplicationsTab } from './admissions-applications';
import { ReportsTab } from './admissions-reports';
import { InsightsTab } from './admissions-insights';

export const VIEW_PERMISSION = 'admissions.view';
const CREATE_PERMISSION = 'admissions.create';
const UPDATE_PERMISSION = 'admissions.update';
const APPROVE_PERMISSION = 'admissions.approve';
const EXPORT_PERMISSION = 'admissions.export';
const MANAGE_PERMISSION = 'admissions.manage';

export const APPLICATION_STATUSES = [
  'INITIATED',
  'SUBMITTED',
  'UNDER_VERIFICATION',
  'DOCUMENTS_VERIFIED',
  'MERIT_LISTED',
  'COUNSELLING_SCHEDULED',
  'COUNSELLED',
  'SELECTED',
  'OFFERED',
  'OFFER_ACCEPTED',
  'FEE_PAID',
  'ENROLLED',
  'WAITLISTED',
  'REJECTED',
  'CANCELLED',
] as const;

export const PAYMENT_METHODS = ['CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE'] as const;
export const DOCUMENT_CHECKLIST = ['PHOTO', 'ID_PROOF', 'MARKSHEET_HIGHEST', 'TRANSFER_CERTIFICATE', 'ADDRESS_PROOF'] as const;

export interface IdName {
  id: string;
  code?: string | null;
  name?: string | null;
}

export interface AcademicYearRow extends IdName {
  code: string;
  name: string;
}

export interface AdmissionSessionRow {
  id: string;
  code: string;
  name: string;
  status: string;
  startAt: string;
  endAt: string;
  meritPublishedAt: string | null;
  academicYear?: AcademicYearRow;
  _count?: { applications: number; programs: number; enquiries: number };
  programs?: AdmissionProgramRow[];
}

export interface AdmissionProgramRow {
  id: string;
  programId: string;
  seats: number;
  filledSeats: number;
  admissionFeeCents: number | null;
  applicationFeeCents: number | null;
  tuitionFeeCents: number | null;
  status: string;
  requiredDocuments: string[] | null;
  program?: IdName;
}

export interface ApplicationRow {
  id: string;
  applicationNumber: string;
  fullName: string;
  status: string;
  meritScore: number | null;
  meritRank: number | null;
  session?: { id: string; code: string; name: string; status: string; requiredDocuments?: string[] };
  admissionProgram?: {
    id: string;
    seats: number;
    filledSeats: number;
    admissionFeeCents: number | null;
    program?: IdName;
  };
  campus?: IdName;
  academicYear?: { id: string; code: string; name: string };
  counsellingSlot?: { id: string; date: string; venue: string | null };
}

export interface AdmissionDocument {
  id: string;
  category: string;
  documentName: string;
  status: string;
  remarks: string | null;
  verifiedAt: string | null;
}

export interface AdmissionQualification {
  id: string;
  institution: string;
  degree: string | null;
  yearOfPassing: number | null;
  percentage: number | null;
  gpa: number | null;
  grade: string | null;
  isHighestQualification: boolean;
  remarks: string | null;
}

export interface AdmissionOffer {
  id: string;
  offerNumber: string;
  status: string;
  admissionFeeCents: number | null;
  expiresAt: string | null;
  issuedAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
  remarks: string | null;
}

export interface AdmissionPayment {
  id: string;
  receiptNumber: string;
  amountCents: number;
  method: string;
  status: string;
  paidAt: string;
  referenceNumber: string | null;
}

export interface AdmissionActivity {
  id: string;
  eventType: string;
  title: string;
  description: string | null;
  occurredAt: string;
}

export interface ApplicationDetail extends ApplicationRow {
  firstName: string;
  lastName: string;
  middleName: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  category: string | null;
  nationality: string | null;
  remarks: string | null;
  guardian: Record<string, unknown> | null;
  data: Record<string, unknown> | null;
  documents: AdmissionDocument[];
  qualifications: AdmissionQualification[];
  offers: AdmissionOffer[];
  payments: AdmissionPayment[];
  activities: AdmissionActivity[];
}

export interface CounsellingSlot {
  id: string;
  date: string;
  venue: string | null;
  capacity: number | null;
}

export interface DashboardDto {
  activeSessions: number;
  totalEnquiries: number;
  applications: {
    total: number;
    submitted: number;
    verified: number;
    meritListed: number;
    selected: number;
    offered: number;
    feePaid: number;
    enrolled: number;
    rejected: number;
  };
  byStage: Record<string, number>;
  seats: { total: number; filled: number };
  recentApplications: ApplicationRow[];
}

export function money(cents: number | null | undefined): string {
  return cents == null ? '—' : `₹${(cents / 100).toFixed(2)}`;
}

export function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function AdmissionsPage() {
  const { permissions } = useAuth();
  const canView = permissions.includes(VIEW_PERMISSION);
  const canCreate = permissions.includes(CREATE_PERMISSION);
  const canUpdate = permissions.includes(UPDATE_PERMISSION);
  const canApprove = permissions.includes(APPROVE_PERMISSION);
  const canExport = permissions.includes(EXPORT_PERMISSION);
  const canManage = permissions.includes(MANAGE_PERMISSION);

  const [tab, setTab] = useState<'dashboard' | 'applications' | 'reports' | 'insights'>('dashboard');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (!canView) {
    return (
      <div style={{ maxWidth: 960, margin: '2rem auto' }}>
        <Card>
          <p style={{ color: '#9ca3af' }}>You don't have permission to view admissions.</p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1150, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Admissions</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" onClick={() => setTab('dashboard')}>Dashboard</Button>
          <Button variant="secondary" onClick={() => setTab('applications')}>Applications</Button>
          <Button variant="secondary" onClick={() => setTab('reports')}>Reports</Button>
          <Button variant="secondary" onClick={() => setTab('insights')}>Insights</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'dashboard' && (
        <DashboardTab canCreate={canCreate} canApprove={canApprove} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'applications' && (
        <ApplicationsTab
          canCreate={canCreate}
          canUpdate={canUpdate}
          canApprove={canApprove}
          canExport={canExport}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'reports' && <ReportsTab canExport={canExport} onError={setError} onNotice={setNotice} />}
      {tab === 'insights' && <InsightsTab onError={setError} onNotice={setNotice} />}
    </div>
  );
}

function DashboardTab({
  canCreate,
  canApprove,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canApprove: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [dash, setDash] = useState<DashboardDto | null>(null);
  const [sessions, setSessions] = useState<AdmissionSessionRow[]>([]);
  const [programs, setPrograms] = useState<AdmissionProgramRow[]>([]);
  const [selectedSession, setSelectedSession] = useState('');
  const [showSessionForm, setShowSessionForm] = useState(false);
  const [showProgramForm, setShowProgramForm] = useState(false);

  const loadAll = useCallback(async () => {
    try {
      const [d, s] = await Promise.all([
        apiFetch<DashboardDto>('/admissions/dashboard'),
        apiFetch<AdmissionSessionRow[]>('/admissions/sessions'),
      ]);
      setDash(d);
      setSessions(s);
      const active = s.find((x) => x.status === 'OPEN');
      setSelectedSession((cur) => cur || active?.id || s[0]?.id || '');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load admissions dashboard.');
    }
  }, [onError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadPrograms = useCallback(
    async (sessionId: string) => {
      if (!sessionId) {
        setPrograms([]);
        return;
      }
      try {
        setPrograms(await apiFetch<AdmissionProgramRow[]>(`/admissions/programs?sessionId=${sessionId}`));
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load program offers.');
      }
    },
    [onError],
  );

  useEffect(() => {
    void loadPrograms(selectedSession);
  }, [selectedSession, loadPrograms]);

  const run = async (path: string, body?: Record<string, unknown>, msg?: string) => {
    try {
      await apiFetch(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
      if (msg) onNotice(msg);
      void loadAll();
      void loadPrograms(selectedSession);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const stages = dash ? dash.byStage : {};
  const maxStage = Object.values(stages).reduce((m, n) => Math.max(m, n), 0) || 1;

  return (
    <>
      {dash && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Kpi label="Open sessions" value={String(dash.activeSessions)} />
          <Kpi label="Enquiries" value={String(dash.totalEnquiries)} />
          <Kpi label="Applications" value={String(dash.applications.total)} />
          <Kpi label="Enrolled" value={String(dash.applications.enrolled)} />
          <Kpi label="Seats filled" value={`${dash.seats.filled}/${dash.seats.total}`} />
        </div>
      )}

      {dash && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Pipeline (by stage)</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {Object.entries(stages).map(([stage, count]) => (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 110, fontSize: '0.85rem', color: '#374151', textTransform: 'capitalize' }}>{stage}</span>
                <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 12 }}>
                  <div style={{ width: `${Math.max(2, (count / maxStage) * 100)}%`, height: 12, borderRadius: 4, background: '#2563eb' }} />
                </div>
                <span style={{ width: 36, textAlign: 'right', fontSize: '0.85rem' }}>{count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Admission sessions</h2>
          {canCreate && <Button onClick={() => setShowSessionForm((s) => !s)}>New session</Button>}
        </div>
        {showSessionForm && canCreate && (
          <SessionForm
            onDone={(msg) => {
              setShowSessionForm(false);
              onNotice(msg);
              void loadAll();
            }}
            onError={onError}
          />
        )}
        {sessions.length === 0 && <p style={{ color: '#9ca3af' }}>No sessions yet.</p>}
        {sessions.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Academic year</th>
                <th style={{ padding: 8 }}>Dates</th>
                <th style={{ padding: 8 }}>Counts</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{s.code}</td>
                  <td style={{ padding: 8 }}>{s.name}</td>
                  <td style={{ padding: 8 }}>{s.academicYear?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>{fmtDate(s.startAt)} → {fmtDate(s.endAt)}</td>
                  <td style={{ padding: 8 }}>
                    {s._count ? `${s._count.enquiries} enq · ${s._count.applications} app · ${s._count.programs} prog` : '—'}
                  </td>
                  <td style={{ padding: 8 }}>{s.status}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {canApprove && s.status === 'OPEN' && (
                      <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void run(`/admissions/sessions/${s.id}/publish-merit`, undefined, 'Merit list published.')}>
                        Publish merit
                      </Button>
                    )}
                    {canManage && s.status === 'OPEN' && (
                      <Button variant="secondary" onClick={() => void run(`/admissions/sessions/${s.id}/close`, undefined, 'Session closed.')}>Close</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Program offers (seat matrix)</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontSize: '0.85rem', color: '#374151' }}>Session</label>
            <select value={selectedSession} onChange={(e) => setSelectedSession(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
            {canManage && <Button onClick={() => setShowProgramForm((p) => !p)}>Add program</Button>}
          </div>
        </div>
        {showProgramForm && canManage && (
          <ProgramForm
            sessionId={selectedSession}
            onDone={(msg) => {
              setShowProgramForm(false);
              onNotice(msg);
              void loadPrograms(selectedSession);
            }}
            onError={onError}
          />
        )}
        {programs.length === 0 && <p style={{ color: '#9ca3af' }}>No program offers for this session.</p>}
        {programs.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Program</th>
                <th style={{ padding: 8 }}>Seats</th>
                <th style={{ padding: 8 }}>Application fee</th>
                <th style={{ padding: 8 }}>Admission fee</th>
                <th style={{ padding: 8 }}>Tuition (yr)</th>
                <th style={{ padding: 8 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {programs.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{p.program?.name ?? ''}{p.program?.code ? ` (${p.program.code})` : ''}</td>
                  <td style={{ padding: 8 }}>{p.filledSeats}/{p.seats}</td>
                  <td style={{ padding: 8 }}>{money(p.applicationFeeCents)}</td>
                  <td style={{ padding: 8 }}>{money(p.admissionFeeCents)}</td>
                  <td style={{ padding: 8 }}>{money(p.tuitionFeeCents)}</td>
                  <td style={{ padding: 8 }}>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {dash && dash.recentApplications.length > 0 && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Recent applications</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Application #</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Program</th>
                <th style={{ padding: 8 }}>Campus</th>
                <th style={{ padding: 8 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {dash.recentApplications.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{r.applicationNumber}</td>
                  <td style={{ padding: 8 }}>{r.fullName}</td>
                  <td style={{ padding: 8 }}>{r.admissionProgram?.program?.name ?? '—'}</td>
                  <td style={{ padding: 8 }}>{r.campus?.name ?? '—'}</td>
                  <td style={{ padding: 8 }}>{r.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card style={{ flex: 1, minWidth: 140 }}>
      <h2 style={{ fontSize: '0.9rem', color: '#6b7280' }}>{label}</h2>
      <p style={{ fontSize: '1.4rem', fontWeight: 600 }}>{value}</p>
    </Card>
  );
}

function SessionForm({ onDone, onError }: { onDone: (msg: string) => void; onError: (msg: string | null) => void }) {
  const [academicYears, setAcademicYears] = useState<AcademicYearRow[]>([]);
  const [values, setValues] = useState({
    code: '',
    name: '',
    academicYearId: '',
    startAt: '',
    endAt: '',
    applicationFeeCents: '',
    admissionFeeCents: '',
    requiredDocuments: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch<{ data: AcademicYearRow[] }>('/organization/academic-year?skip=0&take=500');
        if (!cancelled) setAcademicYears(res.data ?? []);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load academic years.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const submit = async () => {
    setBusy(true);
    try {
      const requiredDocuments = values.requiredDocuments.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
      await apiFetch('/admissions/sessions', {
        method: 'POST',
        body: JSON.stringify({
          code: values.code.trim().toUpperCase(),
          name: values.name.trim(),
          academicYearId: values.academicYearId,
          startAt: new Date(values.startAt).toISOString(),
          endAt: new Date(values.endAt).toISOString(),
          applicationFeeCents: values.applicationFeeCents ? Number(values.applicationFeeCents) : undefined,
          admissionFeeCents: values.admissionFeeCents ? Number(values.admissionFeeCents) : undefined,
          requiredDocuments: requiredDocuments.length ? requiredDocuments : undefined,
        }),
      });
      onDone('Admission session created.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>New admission session</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Input label="Code *" value={values.code} onChange={set('code')} placeholder="ADM-2026" />
        <Input label="Name *" value={values.name} onChange={set('name')} placeholder="Admissions 2026" />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Academic year *</span>
          <select value={values.academicYearId} onChange={set('academicYearId')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="">— select —</option>
            {academicYears.map((y) => (
              <option key={y.id} value={y.id}>{y.code} — {y.name}</option>
            ))}
          </select>
        </label>
        <Input label="Start date *" type="date" value={values.startAt} onChange={set('startAt')} />
        <Input label="End date *" type="date" value={values.endAt} onChange={set('endAt')} />
        <Input label="Application fee (paise)" type="number" value={values.applicationFeeCents} onChange={set('applicationFeeCents')} />
        <Input label="Admission fee (paise)" type="number" value={values.admissionFeeCents} onChange={set('admissionFeeCents')} />
        <Input
          label="Document checklist (comma separated)"
          value={values.requiredDocuments}
          onChange={set('requiredDocuments')}
          placeholder={DOCUMENT_CHECKLIST.join(', ')}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button
          onClick={() => void submit()}
          disabled={busy || !values.code || !values.name || !values.academicYearId || !values.startAt || !values.endAt}
        >
          Create session
        </Button>
      </div>
    </Card>
  );
}

function ProgramForm({
  sessionId,
  onDone,
  onError,
}: {
  sessionId: string;
  onDone: (msg: string) => void;
  onError: (msg: string | null) => void;
}) {
  const [programs, setPrograms] = useState<IdName[]>([]);
  const [values, setValues] = useState({
    programId: '',
    seats: '',
    applicationFeeCents: '',
    admissionFeeCents: '',
    tuitionFeeCents: '',
    requiredDocuments: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch<{ data: IdName[] }>('/organization/program?skip=0&take=500');
        if (!cancelled) setPrograms(res.data ?? []);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load programs.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, onError]);

  const submit = async () => {
    if (!sessionId) {
      onError('Select a session first.');
      return;
    }
    setBusy(true);
    try {
      const requiredDocuments = values.requiredDocuments.split(/[\s,;]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
      await apiFetch('/admissions/programs', {
        method: 'POST',
        body: JSON.stringify({
          sessionId,
          programId: values.programId,
          seats: values.seats ? Number(values.seats) : undefined,
          applicationFeeCents: values.applicationFeeCents ? Number(values.applicationFeeCents) : undefined,
          admissionFeeCents: values.admissionFeeCents ? Number(values.admissionFeeCents) : undefined,
          tuitionFeeCents: values.tuitionFeeCents ? Number(values.tuitionFeeCents) : undefined,
          requiredDocuments: requiredDocuments.length ? requiredDocuments : undefined,
        }),
      });
      onDone('Program offer created.');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Create failed.');
    } finally {
      setBusy(false);
    }
  };

  const set = (key: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setValues((prev) => ({ ...prev, [key]: e.target.value }));

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Add program to session</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Program *</span>
          <select value={values.programId} onChange={set('programId')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="">— select —</option>
            {programs.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </label>
        <Input label="Seats" type="number" value={values.seats} onChange={set('seats')} />
        <Input label="Application fee (paise)" type="number" value={values.applicationFeeCents} onChange={set('applicationFeeCents')} />
        <Input label="Admission fee (paise)" type="number" value={values.admissionFeeCents} onChange={set('admissionFeeCents')} />
        <Input label="Tuition fee / year (paise)" type="number" value={values.tuitionFeeCents} onChange={set('tuitionFeeCents')} />
        <Input label="Document checklist (comma separated)" value={values.requiredDocuments} onChange={set('requiredDocuments')} placeholder={DOCUMENT_CHECKLIST.join(', ')} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button onClick={() => void submit()} disabled={busy || !values.programId}>Add program</Button>
      </div>
    </Card>
  );
}