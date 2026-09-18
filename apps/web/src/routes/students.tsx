import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Input } from '@college-erp/ui';
import type {
  StudentGenderDto,
  StudentSummaryDto,
  StudentStatusDto,
} from '@college-erp/types';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch, apiFetchPaged } from '../lib/http';

const VIEW_PERMISSION = 'students.view';
const CREATE_PERMISSION = 'students.create';
const UPDATE_PERMISSION = 'students.update';
const DELETE_PERMISSION = 'students.delete';
const EXPORT_PERMISSION = 'students.export';
const MANAGE_PERMISSION = 'students.manage';

const TAKE = 25;

export const STUDENT_STATUSES: StudentStatusDto[] = [
  'APPLICANT',
  'ADMITTED',
  'PROVISIONAL',
  'ENROLLED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'WITHDRAWN',
  'GRADUATED',
  'ALUMNI',
];

const GENDERS: StudentGenderDto[] = ['MALE', 'FEMALE', 'OTHER', 'NOT_SPECIFIED'];

interface IdName {
  id: string;
  name?: string | null;
  code?: string | null;
}

interface StudentFormValues {
  firstName: string;
  middleName: string;
  lastName: string;
  gender: string;
  bloodGroup: string;
  dateOfBirth: string;
  email: string;
  primaryPhone: string;
  admissionNumber: string;
  rollNumber: string;
  registrationNumber: string;
  campusId: string;
  programId: string;
  batchId: string;
  sectionId: string;
  yearOfAdmission: string;
  admittedOn: string;
  status: string;
}

function emptyForm(): StudentFormValues {
  return {
    firstName: '',
    middleName: '',
    lastName: '',
    gender: 'NOT_SPECIFIED',
    bloodGroup: 'UNKNOWN',
    dateOfBirth: '',
    email: '',
    primaryPhone: '',
    admissionNumber: '',
    rollNumber: '',
    registrationNumber: '',
    campusId: '',
    programId: '',
    batchId: '',
    sectionId: '',
    yearOfAdmission: '',
    admittedOn: '',
    status: 'APPLICANT',
  };
}

function fromSummary(s: StudentSummaryDto): StudentFormValues {
  return {
    firstName: s.firstName,
    middleName: s.middleName ?? '',
    lastName: s.lastName,
    gender: s.gender,
    bloodGroup: 'UNKNOWN',
    dateOfBirth: s.dateOfBirth ?? '',
    email: s.email ?? '',
    primaryPhone: s.primaryPhone ?? '',
    admissionNumber: s.admissionNumber,
    rollNumber: s.rollNumber ?? '',
    registrationNumber: s.registrationNumber ?? '',
    campusId: s.campus.id,
    programId: s.program?.id ?? '',
    batchId: s.batch?.id ?? '',
    sectionId: s.section?.id ?? '',
    yearOfAdmission: s.yearOfAdmission?.toString() ?? '',
    admittedOn: s.admittedOn ?? '',
    status: s.status,
  };
}

function toPayload(v: StudentFormValues): Record<string, unknown> {
  return {
    firstName: v.firstName.trim() || undefined,
    middleName: v.middleName.trim() || undefined,
    lastName: v.lastName.trim() || undefined,
    gender: v.gender as StudentGenderDto,
    bloodGroup: v.bloodGroup === 'UNKNOWN' ? undefined : v.bloodGroup,
    dateOfBirth: v.dateOfBirth || undefined,
    email: v.email.trim() || undefined,
    primaryPhone: v.primaryPhone.trim() || undefined,
    admissionNumber: v.admissionNumber.trim() || undefined,
    rollNumber: v.rollNumber.trim() || undefined,
    registrationNumber: v.registrationNumber.trim() || undefined,
    campusId: v.campusId || undefined,
    programId: v.programId || undefined,
    batchId: v.batchId || undefined,
    sectionId: v.sectionId || undefined,
    yearOfAdmission: v.yearOfAdmission ? Number(v.yearOfAdmission) : undefined,
    admittedOn: v.admittedOn ? new Date(v.admittedOn).toISOString() : undefined,
    status: v.status as StudentStatusDto,
  };
}

function money(cents: number | null | undefined): string {
  return cents == null ? '—' : `₹${(cents / 100).toFixed(2)}`;
}

export function StudentsPage() {
  const { permissions, tenantSlug } = useAuth();
  const navigate = useNavigate();
  const canView = permissions.includes(VIEW_PERMISSION);
  const canCreate = permissions.includes(CREATE_PERMISSION);
  const canUpdate = permissions.includes(UPDATE_PERMISSION);
  const canDelete = permissions.includes(DELETE_PERMISSION);
  const canExport = permissions.includes(EXPORT_PERMISSION);
  const canManage = permissions.includes(MANAGE_PERMISSION);

  const [rows, setRows] = useState<StudentSummaryDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StudentSummaryDto | null>(null);
  const [showBulk, setShowBulk] = useState(false);

  const [summary, setSummary] = useState<{
    total: number;
    active: number;
    outstandingCents: number;
  } | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ skip: String(skip), take: String(TAKE) });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    return p;
  }, [q, status, skip]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiFetch<{ data: StudentSummaryDto[]; total: number }>(
        `/students?${params.toString()}`,
      );
      setRows(res.data);
      setTotal(res.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load students.');
    }
  }, [params]);

  const loadSummary = useCallback(async () => {
    try {
      const s = await apiFetch<{ total: number; active: number; outstandingCents: number }>(
        '/students/summary',
      );
      setSummary(s);
    } catch {
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setSkip(0);
  }, [q, status]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, total]);

  const applyFilters = () => {
    setSkip(0);
    void load();
  };

  const save = async (values: StudentFormValues, editingRow: StudentSummaryDto | null) => {
    setError(null);
    setNotice(null);
    const payload = toPayload(values);
    try {
      if (editingRow) {
        await apiFetch(`/students/${editingRow.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
        setNotice(`Updated student ${editingRow.fullName}.`);
      } else {
        await apiFetch('/students', { method: 'POST', body: JSON.stringify(payload) });
        setNotice('Created student.');
      }
      setEditing(null);
      setCreating(false);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const archive = async (row: StudentSummaryDto) => {
    if (!window.confirm(`Archive "${row.fullName}"?`)) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/students/${row.id}/archive`, { method: 'POST' });
      setNotice(`Archived ${row.fullName}.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed.');
    }
  };

  const restore = async (row: StudentSummaryDto) => {
    if (!window.confirm(`Restore "${row.fullName}"?`)) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/students/${row.id}/restore`, { method: 'POST' });
      setNotice(`Restored ${row.fullName}.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed.');
    }
  };

  const exportCsv = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await apiFetch<{ csv: string; filename: string }>(`/students/export?${params.toString()}`);
      const blob = new Blob([res.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported to ${res.filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  if (!canView) {
    return (
      <div style={{ maxWidth: 960, margin: '2rem auto' }}>
        <Card>
          <p style={{ color: '#9ca3af' }}>You don't have permission to view students.</p>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Students</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setShowBulk((s) => !s)} disabled={!canManage}>
            Bulk actions
          </Button>
          {canExport && <Button variant="secondary" onClick={() => void exportCsv()}>Export CSV</Button>}
          {canCreate && <Button onClick={() => setCreating(true)}>New student</Button>}
        </div>
      </div>

      {summary && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <Card style={{ flex: 1, minWidth: 160 }}>
            <h2 style={{ fontSize: '0.9rem', color: '#6b7280' }}>Total</h2>
            <p style={{ fontSize: '1.4rem', fontWeight: 600 }}>{summary.total}</p>
          </Card>
          <Card style={{ flex: 1, minWidth: 160 }}>
            <h2 style={{ fontSize: '0.9rem', color: '#6b7280' }}>Active</h2>
            <p style={{ fontSize: '1.4rem', fontWeight: 600 }}>{summary.active}</p>
          </Card>
          <Card style={{ flex: 1, minWidth: 160 }}>
            <h2 style={{ fontSize: '0.9rem', color: '#6b7280' }}>Outstanding fees</h2>
            <p style={{ fontSize: '1.4rem', fontWeight: 600 }}>{money(summary.outstandingCents)}</p>
          </Card>
        </div>
      )}

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {(creating || editing) && canCreate && (
        <StudentForm
          initial={editing ? fromSummary(editing) : null}
          tenantSlug={tenantSlug}
          onSave={(values) => void save(values, editing)}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      {showBulk && canManage && (
        <BulkPanel
          onDone={() => {
            setShowBulk(false);
            void load();
          }}
          onError={setError}
          onNotice={setNotice}
        />
      )}

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 240 }}>
            <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="name, admission #, email…" />
          </div>
          <div style={{ width: 180 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#374151', marginBottom: 4 }}>Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
            >
              <option value="">All statuses</option>
              {STUDENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
          <Button variant="secondary" onClick={applyFilters}>Apply</Button>
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#6b7280' }}>{total} student(s)</span>
        </div>

        {rows === null && <p>Loading…</p>}

        {rows !== null && rows.length === 0 && <p style={{ color: '#9ca3af' }}>No students found.</p>}

        {rows !== null && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Admission #</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Campus / Program</th>
                <th style={{ padding: 8 }}>Batch</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Outstanding</th>
                <th style={{ padding: 8 }}>Holds</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{row.admissionNumber}</td>
                  <td style={{ padding: 8 }}>{row.fullName}</td>
                  <td style={{ padding: 8 }}>
                    {row.program ? `${row.program.name} (${row.program.code})` : row.campus.name}
                  </td>
                  <td style={{ padding: 8 }}>{row.batch?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>{row.status}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>{money(row.outstandingCents)}</td>
                  <td style={{ padding: 8 }}>{row.activeHoldCount > 0 ? `${row.activeHoldCount}⚠` : '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" onClick={() => navigate(`/students/${row.id}`)} style={{ marginRight: 8 }}>
                      View
                    </Button>
                    {canUpdate && (
                      <Button variant="secondary" onClick={() => setEditing(row)} style={{ marginRight: 8 }}>
                        Edit
                      </Button>
                    )}
                    {canDelete && row.status !== 'WITHDRAWN' && row.status !== 'GRADUATED' && row.status !== 'ALUMNI' && (
                      <Button variant="secondary" onClick={() => void archive(row)}>Archive</Button>
                    )}
                    {canDelete && (row.status === 'WITHDRAWN' || row.status === 'GRADUATED' || row.status === 'ALUMNI') && (
                      <Button variant="secondary" onClick={() => void restore(row)}>Restore</Button>
                    )}
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
    </div>
  );
}

function StudentForm({
  initial,
  tenantSlug,
  onSave,
  onCancel,
}: {
  initial: StudentFormValues | null;
  tenantSlug: string | null;
  onSave: (values: StudentFormValues) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<StudentFormValues>(initial ?? emptyForm());
  const [options, setOptions] = useState<{
    campuses: IdName[];
    programs: IdName[];
    batches: IdName[];
    sections: IdName[];
  }>({ campuses: [], programs: [], batches: [], sections: [] });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [campuses, programs, batches, sections] = await Promise.all([
        apiFetchPaged<IdName[]>('/organization/campus?skip=0&take=500'),
        apiFetchPaged<IdName[]>('/organization/program?skip=0&take=500'),
        apiFetchPaged<IdName[]>('/organization/batch?skip=0&take=500'),
        apiFetchPaged<IdName[]>('/organization/section?skip=0&take=500'),
      ]);
      if (cancelled) return;
      setOptions({
        campuses: campuses.data,
        programs: programs.data,
        batches: batches.data,
        sections: sections.data,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: keyof StudentFormValues, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    setBusy(true);
    try {
      await onSave(values);
    } finally {
      setBusy(false);
    }
  };

  const setV = (key: keyof StudentFormValues) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => set(key, e.target.value);

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>{initial ? 'Edit student' : 'New student'}</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Input label="First name *" value={values.firstName} onChange={setV('firstName')} />
        <Input label="Middle name" value={values.middleName} onChange={setV('middleName')} />
        <Input label="Last name *" value={values.lastName} onChange={setV('lastName')} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Gender</span>
          <select value={values.gender} onChange={setV('gender')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            {GENDERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </label>
        <Input label="Date of birth" type="date" value={values.dateOfBirth} onChange={setV('dateOfBirth')} />
        <Input label="Email" value={values.email} onChange={setV('email')} />
        <Input label="Primary phone" value={values.primaryPhone} onChange={setV('primaryPhone')} />
        <Input label="Admission number (blank = auto)" value={values.admissionNumber} onChange={setV('admissionNumber')} />
        <Input label="Roll number" value={values.rollNumber} onChange={setV('rollNumber')} />
        <Input label="Registration number" value={values.registrationNumber} onChange={setV('registrationNumber')} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Campus *</span>
          <select value={values.campusId} onChange={setV('campusId')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="">— select —</option>
            {options.campuses.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Program</span>
          <select value={values.programId} onChange={setV('programId')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="">— none —</option>
            {options.programs.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Batch</span>
          <select value={values.batchId} onChange={setV('batchId')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="">— none —</option>
            {options.batches.map((b) => (
              <option key={b.id} value={b.id}>{b.code}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Section</span>
          <select value={values.sectionId} onChange={setV('sectionId')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            <option value="">— none —</option>
            {options.sections.map((s) => (
              <option key={s.id} value={s.id}>{s.code}</option>
            ))}
          </select>
        </label>
        <Input label="Year of admission" type="number" value={values.yearOfAdmission} onChange={setV('yearOfAdmission')} />
        <Input label="Admitted on" type="date" value={values.admittedOn} onChange={setV('admittedOn')} />
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: '0.85rem', color: '#374151' }}>Status</span>
          <select value={values.status} onChange={setV('status')} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
            {STUDENT_STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
      </div>
      <p style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 8 }}>
        {tenantSlug ? `Tenant: ${tenantSlug}` : ''}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button onClick={() => void submit()} disabled={busy}>
          Save
        </Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

function BulkPanel({
  onDone,
  onError,
  onNotice,
}: {
  onDone: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [ids, setIds] = useState('');
  const [action, setAction] = useState<string>('archive');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    onError(null);
    onNotice(null);
    try {
      const idList = ids.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
      if (idList.length === 0) throw new Error('Enter at least one student id.');
      const res = await apiFetch<{ processed: number; failed: number; total: number }>('/students/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids: idList, action }),
      });
      onNotice(`Bulk ${action}: ${res.processed} processed, ${res.failed} failed (of ${res.total}).`);
      setIds('');
      onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Bulk action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Bulk actions</h2>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <textarea
          value={ids}
          onChange={(e) => setIds(e.target.value)}
          placeholder={'One student id per line or comma-separated'}
          rows={3}
          style={{ flex: 1, minWidth: 260, padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db', fontFamily: 'monospace', fontSize: '0.85rem' }}
        />
        <select
          value={action}
          onChange={(e) => setAction(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
        >
          <option value="archive">Archive</option>
          <option value="restore">Restore</option>
        </select>
        <Button onClick={() => void run()} disabled={busy || ids.trim() === ''}>Run</Button>
      </div>
    </Card>
  );
}