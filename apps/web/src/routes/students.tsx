import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Badge,
  BulkActionBar,
  Button,
  Card,
  CardBody,
  DataTable,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatCard,
  TableToolbar,
  statusTone,
  useConfirm,
  useToast,
  validateFields,
  email as emailRule,
  required,
  type Column,
  type SortState,
} from '@college-erp/ui';
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
const ARCHIVABLE_STATUSES: StudentStatusDto[] = ['WITHDRAWN', 'GRADUATED', 'ALUMNI'];

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
  const { permissions } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const confirm = useConfirm();

  const canView = permissions.includes(VIEW_PERMISSION);
  const canCreate = permissions.includes(CREATE_PERMISSION);
  const canUpdate = permissions.includes(UPDATE_PERMISSION);
  const canDelete = permissions.includes(DELETE_PERMISSION);
  const canExport = permissions.includes(EXPORT_PERMISSION);
  const canManage = permissions.includes(MANAGE_PERMISSION);

  const [rows, setRows] = useState<StudentSummaryDto[] | null>(null);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [take, setTake] = useState(TAKE);
  const [q, setQ] = useState('');
  const [pendingQ, setPendingQ] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StudentSummaryDto | null>(null);

  const [summary, setSummary] = useState<{ total: number; active: number; outstandingCents: number } | null>(null);

  const params = useMemo(() => {
    const p = new URLSearchParams({ skip: String(skip), take: String(take) });
    if (q) p.set('q', q);
    if (status) p.set('status', status);
    return p;
  }, [q, status, skip, take]);

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const res = await apiFetch<{ data: StudentSummaryDto[]; total: number }>(`/students?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
      setSelectedIds(new Set());
    } catch (err) {
      setRows([]);
      setError(err instanceof Error ? err.message : 'Failed to load students.');
    }
  }, [params]);

  const loadSummary = useCallback(async () => {
    try {
      const s = await apiFetch<{ total: number; active: number; outstandingCents: number }>('/students/summary');
      setSummary(s);
    } catch {
      setSummary(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary, total]);

  const applyFilters = () => {
    setSkip(0);
    setQ(pendingQ.trim());
  };

  const resetFilters = () => {
    setPendingQ('');
    setQ('');
    setStatus('');
    setSkip(0);
  };

  const save = async (values: StudentFormValues, editingRow: StudentSummaryDto | null) => {
    const payload = toPayload(values);
    if (editingRow) {
      await apiFetch(`/students/${editingRow.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      toast.success('Student updated', editingRow.fullName);
    } else {
      await apiFetch('/students', { method: 'POST', body: JSON.stringify(payload) });
      toast.success('Student created');
    }
    setEditing(null);
    setCreating(false);
    await load();
  };

  const archive = async (row: StudentSummaryDto) => {
    const ok = await confirm({
      title: `Archive "${row.fullName}"?`,
      description: 'The student is soft-deleted and can be restored later. Their history is preserved.',
      confirmLabel: 'Archive',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await apiFetch(`/students/${row.id}/archive`, { method: 'POST' });
      toast.success('Student archived', row.fullName);
      await load();
    } catch (err) {
      toast.error('Archive failed', err instanceof Error ? err.message : undefined);
    }
  };

  const restore = async (row: StudentSummaryDto) => {
    const ok = await confirm({ title: `Restore "${row.fullName}"?`, confirmLabel: 'Restore' });
    if (!ok) return;
    try {
      await apiFetch(`/students/${row.id}/restore`, { method: 'POST' });
      toast.success('Student restored', row.fullName);
      await load();
    } catch (err) {
      toast.error('Restore failed', err instanceof Error ? err.message : undefined);
    }
  };

  const exportCsv = async () => {
    try {
      const res = await apiFetch<{ csv: string; filename: string }>(`/students/export?${params.toString()}`);
      const blob = new Blob([res.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Export ready', res.filename);
    } catch (err) {
      toast.error('Export failed', err instanceof Error ? err.message : undefined);
    }
  };

  const runBulk = async (action: 'archive' | 'restore') => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const ok = await confirm({
      title: `${action === 'archive' ? 'Archive' : 'Restore'} ${ids.length} student${ids.length === 1 ? '' : 's'}?`,
      confirmLabel: action === 'archive' ? 'Archive' : 'Restore',
      tone: action === 'archive' ? 'danger' : 'primary',
    });
    if (!ok) return;
    try {
      const res = await apiFetch<{ processed: number; failed: number; total: number }>('/students/bulk', {
        method: 'POST',
        body: JSON.stringify({ ids, action }),
      });
      toast.success(`Bulk ${action} complete`, `${res.processed} processed, ${res.failed} failed (of ${res.total}).`);
      await load();
    } catch (err) {
      toast.error('Bulk action failed', err instanceof Error ? err.message : undefined);
    }
  };

  const sortedRows = useMemo(() => {
    if (!rows || !sort) return rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const pick = (row: StudentSummaryDto): string | number => {
        switch (sort.key) {
          case 'fullName':
            return row.fullName.toLowerCase();
          case 'outstandingCents':
            return row.outstandingCents;
          case 'status':
            return row.status;
          default:
            return row.admissionNumber.toLowerCase();
        }
      };
      const av = pick(a);
      const bv = pick(b);
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [rows, sort]);

  const columns = useMemo<Array<Column<StudentSummaryDto>>>(
    () => [
      { key: 'admissionNumber', header: 'Admission #', label: 'Admission #', sortable: true, render: (row) => <span style={{ fontWeight: 600 }}>{row.admissionNumber}</span> },
      { key: 'fullName', header: 'Name', label: 'Name', sortable: true, render: (row) => row.fullName },
      {
        key: 'program',
        header: 'Campus / Program',
        label: 'Campus / Program',
        render: (row) => (row.program ? `${row.program.name} (${row.program.code})` : row.campus.name),
      },
      { key: 'batch', header: 'Batch', label: 'Batch', render: (row) => row.batch?.code ?? '—' },
      { key: 'status', header: 'Status', label: 'Status', sortable: true, render: (row) => <Badge tone={statusTone(row.status)}>{row.status}</Badge> },
      { key: 'outstandingCents', header: 'Outstanding', label: 'Outstanding', align: 'right', sortable: true, render: (row) => money(row.outstandingCents) },
      {
        key: 'holds',
        header: 'Holds',
        label: 'Holds',
        align: 'center',
        render: (row) => (row.activeHoldCount > 0 ? <Badge tone="danger">{row.activeHoldCount}</Badge> : '—'),
      },
      {
        key: 'actions',
        header: 'Actions',
        label: 'Actions',
        align: 'right',
        render: (row) => (
          <div className="ui-table__actions">
            <Button size="sm" variant="secondary" onClick={() => navigate(`/students/${row.id}`)}>View</Button>
            {canUpdate && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>Edit</Button>
            )}
            {canDelete && !ARCHIVABLE_STATUSES.includes(row.status) && (
              <Button size="sm" variant="secondary" onClick={() => void archive(row)}>Archive</Button>
            )}
            {canDelete && ARCHIVABLE_STATUSES.includes(row.status) && (
              <Button size="sm" variant="secondary" onClick={() => void restore(row)}>Restore</Button>
            )}
          </div>
        ),
      },
    ],
    [canUpdate, canDelete, navigate],
  );

  if (!canView) {
    return (
      <Card>
        <CardBody>
          <p style={{ color: 'var(--ui-color-text-muted)' }}>You don't have permission to view students.</p>
        </CardBody>
      </Card>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <PageHeader
        title="Students"
        description="Search, manage and export student records across your campus."
        actions={
          <>
            {canExport && <Button variant="secondary" onClick={() => void exportCsv()}>Export CSV</Button>}
            {canCreate && <Button onClick={() => setCreating(true)}>New student</Button>}
          </>
        }
      />

      {summary && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
          <StatCard label="Total students" value={summary.total} />
          <StatCard label="Active" value={summary.active} />
          <StatCard label="Outstanding fees" value={money(summary.outstandingCents)} />
        </div>
      )}

      <Card>
        <CardBody>
          <TableToolbar>
            <div className="ui-toolbar__grow" style={{ maxWidth: 320 }}>
              <Input
                label="Search"
                value={pendingQ}
                onChange={(e) => setPendingQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') applyFilters();
                }}
                placeholder="name, admission #, email…"
              />
            </div>
            <div style={{ width: 200 }}>
              <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {STUDENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button onClick={applyFilters}>Apply</Button>
              <Button variant="ghost" onClick={resetFilters}>Reset</Button>
            </div>
          </TableToolbar>

          {canManage && (
            <BulkActionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
              <Button size="sm" variant="danger" onClick={() => void runBulk('archive')}>Archive</Button>
              <Button size="sm" variant="secondary" onClick={() => void runBulk('restore')}>Restore</Button>
            </BulkActionBar>
          )}

          <DataTable
            columns={columns}
            rows={sortedRows}
            rowKey={(row) => row.id}
            error={error}
            onRetry={() => void load()}
            selectable={canManage}
            selectedIds={selectedIds}
            onSelectedIdsChange={setSelectedIds}
            sort={sort}
            onSortChange={setSort}
            empty={<div style={{ padding: 32, textAlign: 'center', color: 'var(--ui-color-text-muted)' }}>No students match your filters.</div>}
          />

          <Pagination
            skip={skip}
            take={take}
            total={total}
            loading={rows === null}
            onSkipChange={setSkip}
            onTakeChange={(next) => {
              setTake(next);
              setSkip(0);
            }}
          />
        </CardBody>
      </Card>

      {(creating || editing) && canCreate && (
        <StudentFormModal
          initial={editing ? fromSummary(editing) : null}
          onSave={(values) => save(values, editing)}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

const FORM_RULES = {
  firstName: [required('First name is required')],
  lastName: [required('Last name is required')],
  campusId: [required('Campus is required')],
  email: [emailRule()],
};

function StudentFormModal({
  initial,
  onSave,
  onClose,
}: {
  initial: StudentFormValues | null;
  onSave: (values: StudentFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const toast = useToast();
  const [values, setValues] = useState<StudentFormValues>(initial ?? emptyForm());
  const [errors, setErrors] = useState<Partial<Record<keyof StudentFormValues, string>>>({});
  const [busy, setBusy] = useState(false);
  const [options, setOptions] = useState<{ campuses: IdName[]; programs: IdName[]; batches: IdName[]; sections: IdName[] }>({
    campuses: [],
    programs: [],
    batches: [],
    sections: [],
  });

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
      setOptions({ campuses: campuses.data, programs: programs.data, batches: batches.data, sections: sections.data });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: keyof StudentFormValues, value: string) => setValues((prev) => ({ ...prev, [key]: value }));

  const submit = async () => {
    const nextErrors = validateFields(values, FORM_RULES);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error('Please fix the highlighted fields');
      return;
    }
    setBusy(true);
    try {
      await onSave(values);
    } catch (err) {
      toast.error('Save failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={initial ? 'Edit student' : 'New student'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => void submit()}>Save</Button>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <Input label="First name" required value={values.firstName} error={errors.firstName} onChange={(e) => set('firstName', e.target.value)} />
        <Input label="Middle name" value={values.middleName} onChange={(e) => set('middleName', e.target.value)} />
        <Input label="Last name" required value={values.lastName} error={errors.lastName} onChange={(e) => set('lastName', e.target.value)} />
        <Select label="Gender" value={values.gender} onChange={(e) => set('gender', e.target.value)}>
          {GENDERS.map((g) => (
            <option key={g} value={g}>{g}</option>
          ))}
        </Select>
        <Input label="Date of birth" type="date" value={values.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} />
        <Input label="Email" type="email" value={values.email} error={errors.email} onChange={(e) => set('email', e.target.value)} />
        <Input label="Primary phone" value={values.primaryPhone} onChange={(e) => set('primaryPhone', e.target.value)} />
        <Input label="Admission number (blank = auto)" value={values.admissionNumber} onChange={(e) => set('admissionNumber', e.target.value)} />
        <Input label="Roll number" value={values.rollNumber} onChange={(e) => set('rollNumber', e.target.value)} />
        <Input label="Registration number" value={values.registrationNumber} onChange={(e) => set('registrationNumber', e.target.value)} />
        <Select label="Campus" required value={values.campusId} error={errors.campusId} onChange={(e) => set('campusId', e.target.value)}>
          <option value="">— select —</option>
          {options.campuses.map((c) => (
            <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
          ))}
        </Select>
        <Select label="Program" value={values.programId} onChange={(e) => set('programId', e.target.value)}>
          <option value="">— none —</option>
          {options.programs.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
          ))}
        </Select>
        <Select label="Batch" value={values.batchId} onChange={(e) => set('batchId', e.target.value)}>
          <option value="">— none —</option>
          {options.batches.map((b) => (
            <option key={b.id} value={b.id}>{b.code}</option>
          ))}
        </Select>
        <Select label="Section" value={values.sectionId} onChange={(e) => set('sectionId', e.target.value)}>
          <option value="">— none —</option>
          {options.sections.map((s) => (
            <option key={s.id} value={s.id}>{s.code}</option>
          ))}
        </Select>
        <Input label="Year of admission" type="number" value={values.yearOfAdmission} onChange={(e) => set('yearOfAdmission', e.target.value)} />
        <Input label="Admitted on" type="date" value={values.admittedOn} onChange={(e) => set('admittedOn', e.target.value)} />
        <Select label="Status" value={values.status} onChange={(e) => set('status', e.target.value)}>
          {STUDENT_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </Select>
      </div>
    </Modal>
  );
}
