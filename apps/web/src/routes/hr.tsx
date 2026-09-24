/**
 * HR & Faculty Management page — employee master/lifecycle, faculty workload, leave, performance
 * reviews and payroll. Row-level scope is enforced by the API (hr.view/create/update/delete/manage),
 * so the UI only renders actions the current user holds via useAuth().permissions. Payroll
 * administration (salary structures, runs, payslips) additionally requires the GLOBAL hr.manage —
 * the backend enforces that; the UI just hides the buttons without it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import {
  Badge,
  DOCUMENT_TYPES,
  EMPLOYEE_STATUSES,
  EMPLOYEE_TYPES,
  EMPLOYMENT_TYPES,
  EXIT_TYPES,
  GENDERS,
  HALF_DAY_OPTIONS,
  JOINING_STATUSES,
  LEAVE_CATEGORIES,
  LEAVE_STATUSES,
  NO_DUE_STATUSES,
  PAYROLL_RUN_STATUSES,
  REVIEW_STATUSES,
  REVIEW_TYPES,
  WORKLOAD_TYPES,
  downloadDocument,
  fmtDate,
  inputStyle,
  labelStyle,
  loadError,
  money,
  requestUpload,
  selectStyle,
  tdStyle,
  thStyle,
  uploadToUrl,
  useHrLookups,
} from './hr-shared';
import type {
  EmployeeDetailDto,
  EmployeeDocumentDto,
  EmployeeExitDto,
  EmployeeJoiningDto,
  EmployeeListItemDto,
  FacultyWorkloadDto,
  HrLookupState,
  HrOverviewDto,
  LeaveApplicationDto,
  LeaveBalanceDto,
  LeaveTypeDto,
  PayslipDto,
  PayrollRunDetailDto,
  PayrollRunDto,
  PerformanceReviewDto,
  SalaryStructureDto,
} from './hr-shared';

export const HR_VIEW_PERMISSION = 'hr.view';
export const HR_CREATE_PERMISSION = 'hr.create';
export const HR_UPDATE_PERMISSION = 'hr.update';
export const HR_DELETE_PERMISSION = 'hr.delete';
export const HR_MANAGE_PERMISSION = 'hr.manage';

const TAKE = 50;

export function HrPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<'overview' | 'employees' | 'leave' | 'performance' | 'payroll'>('overview');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  const can = {
    view: permissions.includes(HR_VIEW_PERMISSION),
    create: permissions.includes(HR_CREATE_PERMISSION),
    update: permissions.includes(HR_UPDATE_PERMISSION),
    del: permissions.includes(HR_DELETE_PERMISSION),
    manage: permissions.includes(HR_MANAGE_PERMISSION),
  };

  return (
    <div style={{ maxWidth: 1180, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>HR &amp; Faculty</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('overview')}>Overview</Button>
          <Button variant="secondary" onClick={() => setTab('employees')}>Employees</Button>
          <Button variant="secondary" onClick={() => setTab('leave')}>Leave</Button>
          <Button variant="secondary" onClick={() => setTab('performance')}>Performance</Button>
          <Button variant="secondary" onClick={() => setTab('payroll')}>Payroll</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'overview' && <OverviewTab reload={reload} onError={setError} />}
      {tab === 'employees' && (
        <EmployeesTab
          can={can}
          reload={reload}
          onReload={() => setReload((r) => r + 1)}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'leave' && (
        <LeaveTab can={can} reload={reload} onReload={() => setReload((r) => r + 1)} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'performance' && (
        <PerformanceTab can={can} reload={reload} onReload={() => setReload((r) => r + 1)} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'payroll' && (
        <PayrollTab can={can} reload={reload} onReload={() => setReload((r) => r + 1)} onError={setError} onNotice={setNotice} />
      )}
    </div>
  );
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewTab({ reload, onError }: { reload: number; onError: (msg: string) => void }) {
  const [data, setData] = useState<HrOverviewDto | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    apiFetch<HrOverviewDto>('/hr/reports/overview')
      .then((res) => {
        if (mounted) setData(res);
      })
      .catch((e) => {
        if (mounted) onError(loadError(e, 'Failed to load overview'));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [reload, onError]);

  if (loading && !data) return <p>Loading…</p>;
  if (!data) return <p>No data.</p>;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <Card><h3 style={{ fontSize: '0.9rem' }}>Headcount</h3><p style={{ fontSize: '1.5rem' }}>{data.headcount}</p></Card>
        <Card><h3 style={{ fontSize: '0.9rem' }}>Pending leave applications</h3><p style={{ fontSize: '1.5rem' }}>{data.pendingLeaves}</p></Card>
        <Card><h3 style={{ fontSize: '0.9rem' }}>Active workload (hrs/week)</h3><p style={{ fontSize: '1.5rem' }}>{data.activeWorkloadHoursPerWeek}</p></Card>
        <Card><h3 style={{ fontSize: '0.9rem' }}>Paid payroll lines</h3><p style={{ fontSize: '1.5rem' }}>{data.payroll.paidLines}</p></Card>
        <Card><h3 style={{ fontSize: '0.9rem' }}>Net paid to date</h3><p style={{ fontSize: '1.5rem' }}>{money(data.payroll.paidNetTotal)}</p></Card>
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Card>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>By department</h3>
          {data.byDepartment.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No employees.</p>
          ) : (
            <ul>
              {data.byDepartment.map((d) => (
                <li key={d.departmentId ?? 'none'} style={{ marginBottom: 4 }}>{d.departmentName ?? '—'}: <b>{d.count}</b></li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>By status</h3>
          {data.byStatus.length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No employees.</p>
          ) : (
            <ul>
              {data.byStatus.map((s) => (
                <li key={s.employmentStatus} style={{ marginBottom: 4 }}>
                  <Badge value={s.employmentStatus} /> <b>{s._count._all}</b>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Payroll totals (gross/net)</h3>
          <p>Gross: {money(data.payroll.paidGrossTotal)}</p>
          <p>Net: {money(data.payroll.paidNetTotal)}</p>
        </Card>
      </div>
    </div>
  );
}

// ── Employees ───────────────────────────────────────────────────────────────

interface Permissions {
  view: boolean;
  create: boolean;
  update: boolean;
  del: boolean;
  manage: boolean;
}

function EmployeesTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const lookups = useHrLookups();
  const [rows, setRows] = useState<EmployeeListItemDto[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [employmentStatus, setEmploymentStatus] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
      if (search) params.set('search', search);
      if (departmentId) params.set('departmentId', departmentId);
      if (employmentStatus) params.set('employmentStatus', employmentStatus);
      if (includeArchived) params.set('includeArchived', 'true');
      const res = await apiFetch<{ data: EmployeeListItemDto[]; total: number }>(`/hr/employees?${params.toString()}`);
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      onError(loadError(e, 'Failed to load employees'));
    } finally {
      setLoading(false);
    }
  }, [search, departmentId, employmentStatus, includeArchived, onError]);

  useEffect(() => {
    load();
  }, [load, reload]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ ...labelStyle, width: 220 }}><label>Search</label>
          <input style={inputStyle} value={search} placeholder="Name / code" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div style={{ ...labelStyle, width: 180 }}><label>Department</label>
          <select style={selectStyle} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All</option>
            {lookups?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div style={{ ...labelStyle, width: 160 }}><label>Status</label>
          <select style={selectStyle} value={employmentStatus} onChange={(e) => setEmploymentStatus(e.target.value)}>
            <option value="">All</option>
            {EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem' }}>
          <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
          Include archived
        </label>
        <Button variant="secondary" onClick={load}>Search</Button>
        {can.create && <Button onClick={() => setShowCreate(true)}>Add employee</Button>}
      </div>

      <p style={{ fontSize: '0.8rem', color: '#6b7280' }}>{total} employee(s) matching.</p>

      {showCreate && lookups && (
        <CreateEmployeeModal
          lookups={lookups}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            onNotice('Employee created.');
            onReload();
          }}
          onError={onError}
        />
      )}

      {loading && rows.length === 0 ? (
        <p>Loading…</p>
      ) : (
        <Card>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Department</th>
                <th style={thStyle}>Campus</th>
                <th style={thStyle}>Designation</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.employeeCode}</td>
                  <td style={tdStyle}>{r.fullName} {r.deletedAt && <Badge value="Archived" />}</td>
                  <td style={tdStyle}><Badge value={r.employeeType} /></td>
                  <td style={tdStyle}><Badge value={r.employmentStatus} /></td>
                  <td style={tdStyle}>{r.department?.name ?? '—'}</td>
                  <td style={tdStyle}>{r.campus?.name ?? '—'}</td>
                  <td style={tdStyle}>{r.designation?.name ?? '—'}</td>
                  <td style={tdStyle}>
                    <Button variant="secondary" onClick={() => setSelectedId(r.id)}>View</Button>
                    {can.update && !r.deletedAt && (
                      <Button
                        variant="secondary"
                        style={{ marginLeft: 6 }}
                        onClick={async () => {
                          try {
                            await apiFetch(`/hr/employees/${r.id}/restore`, { method: 'POST' });
                            onNotice('Employee restored.');
                            onReload();
                          } catch (e) {
                            onError(loadError(e, 'Failed to restore'));
                          }
                        }}
                      >
                        Restore
                      </Button>
                    )}
                    {can.update && r.deletedAt && (
                      <Button
                        variant="secondary"
                        style={{ marginLeft: 6 }}
                        onClick={async () => {
                          try {
                            await apiFetch(`/hr/employees/${r.id}`, { method: 'DELETE' });
                            onNotice('Employee archived (soft deleted).');
                            onReload();
                          } catch (e) {
                            onError(loadError(e, 'Failed to archive'));
                          }
                        }}
                      >
                        Archive
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p style={{ padding: '1rem 0', color: '#9ca3af' }}>No employees found.</p>}
        </Card>
      )}

      {selectedId && lookups && (
        <EmployeeDetailModal
          id={selectedId}
          can={can}
          lookups={lookups}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            onReload();
          }}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </div>
  );
}

function CreateEmployeeModal({
  lookups,
  onClose,
  onCreated,
  onError,
}: {
  lookups: HrLookupState;
  onClose: () => void;
  onCreated: () => void;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<Record<string, string>>({ employeeType: 'FACULTY', employmentType: 'FULL_TIME', employmentStatus: 'ACTIVE', gender: 'NOT_SPECIFIED' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      if (!form.firstName || !form.lastName) throw new Error('First and last name are required.');
      if (!form.departmentId) throw new Error('Department is required.');
      await apiFetch('/hr/employees', { method: 'POST', body: JSON.stringify(form) });
      onCreated();
    } catch (e) {
      onError(loadError(e, 'Failed to create employee'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>New employee</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
        <Input label="Employee code" value={form.employeeCode ?? ''} onChange={(e) => set('employeeCode', e.target.value)} />
        <Input label="First name *" value={form.firstName ?? ''} onChange={(e) => set('firstName', e.target.value)} />
        <Input label="Last name *" value={form.lastName ?? ''} onChange={(e) => set('lastName', e.target.value)} />
        <Input label="Honorific" value={form.honorific ?? ''} onChange={(e) => set('honorific', e.target.value)} />
        <div style={labelStyle}><label>Gender</label>
          <select style={selectStyle} value={form.gender ?? 'NOT_SPECIFIED'} onChange={(e) => set('gender', e.target.value)}>
            {GENDERS.map((g) => <option key={g} value={g}>{g}</option>)}
          </select>
        </div>
        <Input label="Date of birth" type="date" value={form.dateOfBirth ?? ''} onChange={(e) => set('dateOfBirth', e.target.value)} />
        <Input label="Phone" value={form.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
        <Input label="Personal email" value={form.personalEmail ?? ''} onChange={(e) => set('personalEmail', e.target.value)} />
        <div style={labelStyle}><label>Department *</label>
          <select style={selectStyle} value={form.departmentId ?? ''} onChange={(e) => set('departmentId', e.target.value)}>
            <option value="">Select</option>
            {lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div style={labelStyle}><label>Designation</label>
          <select style={selectStyle} value={form.designationId ?? ''} onChange={(e) => set('designationId', e.target.value)}>
            <option value="">Select</option>
            {lookups.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div style={labelStyle}><label>Campus</label>
          <select style={selectStyle} value={form.campusId ?? ''} onChange={(e) => set('campusId', e.target.value)}>
            <option value="">Select</option>
            {lookups.campuses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div style={labelStyle}><label>Employee type</label>
          <select style={selectStyle} value={form.employeeType ?? 'FACULTY'} onChange={(e) => set('employeeType', e.target.value)}>
            {EMPLOYEE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={labelStyle}><label>Employment type</label>
          <select style={selectStyle} value={form.employmentType ?? 'FULL_TIME'} onChange={(e) => set('employmentType', e.target.value)}>
            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={labelStyle}><label>Status</label>
          <select style={selectStyle} value={form.employmentStatus ?? 'ACTIVE'} onChange={(e) => set('employmentStatus', e.target.value)}>
            {EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <Input label="Join date" type="date" value={form.joinDate ?? ''} onChange={(e) => set('joinDate', e.target.value)} />
        <Input label="Notes" value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Create'}</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </Card>
  );
}

function EmployeeDetailModal({
  id,
  can,
  lookups,
  onClose,
  onChanged,
  onError,
  onNotice,
}: {
  id: string;
  can: Permissions;
  lookups: HrLookupState;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [detail, setDetail] = useState<EmployeeDetailDto | null>(null);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const [edit, setEdit] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiFetch<EmployeeDetailDto>(`/hr/employees/${id}`);
      setDetail(res);
      setLoadMsg(null);
    } catch (e) {
      setLoadMsg(loadError(e, 'Failed to load employee'));
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: '#fff', maxWidth: 980, width: '95%', maxHeight: '92vh', overflowY: 'auto', borderRadius: 10, padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1.1rem' }}>
            {detail ? `${detail.fullName} (${detail.employeeCode})` : 'Employee'}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {can.update && <Button variant="secondary" onClick={() => setEdit((v) => !v)}>{edit ? 'Done' : 'Edit'}</Button>}
            <Button variant="secondary" onClick={onClose}>Close</Button>
          </div>
        </div>

        {loadMsg && <p style={{ color: '#b91c1c' }}>{loadMsg}</p>}
        {!detail && !loadMsg && <p>Loading…</p>}
        {!detail || !lookups ? null : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <FullProfile info={detail} />
            {edit && (
              <EditEmployeeForm
                employee={detail}
                lookups={lookups}
                onSubmit={async (body) => {
                  await apiFetch(`/hr/employees/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
                  onNotice('Employee updated.');
                  onChanged();
                  await load();
                }}
                onError={onError}
              />
            )}
            <JoiningsSection employeeId={id} joinings={detail.joinings} can={can} onError={onError} onNotice={onNotice} onChanged={load} />
            <ExitsSection employeeId={id} exits={detail.exits} can={can} onError={onError} onNotice={onNotice} onChanged={load} />
            <DocumentsSection employeeId={id} documents={detail.documents} can={can} onError={onError} onNotice={onNotice} />
            <WorkloadSection employeeId={id} workloads={detail.workloads} lookups={lookups} can={can} onError={onError} onNotice={onNotice} onChanged={load} />
            <SalarySection employeeId={id} structures={detail.salaryStructures} can={can} onError={onError} onNotice={onNotice} onChanged={load} />
            <SmallLeavesSection applications={detail.leaveApplications} />

            <SmallReviewsSection reviews={detail.reviews} />
            <TimetableAndAttendanceSection employeeId={id} onError={onError} />
          </div>
        )}
      </div>
    </div>
  );
}

function FullProfile({ info }: { info: EmployeeDetailDto }) {
  const rows: Array<[string, string | null | undefined]> = [
    ['Phone', info.phone],
    ['Personal email', info.personalEmail],
    ['Join date', info.joinDate],
    ['Exit date', info.exitDate],
    ['Address', [info.addressLine1, info.city, info.state, info.postalCode, info.country].filter(Boolean).join(', ') || null],
    ['Bank', info.bankAccountNumber ? `${info.bankAccountNumber} / ${info.bankIfsc ?? ''}` : null],
    ['UAN', info.uanNumber],
    ['Qualification', info.qualification],
    ['Specialization', info.specialization],
    ['User', info.user ? `${info.user.fullName} (${info.user.email})` : null],
  ];
  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Profile</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
        <div>Type: <Badge value={info.employeeType} /></div>
        <div>Status: <Badge value={info.employmentStatus} /></div>
        <div>Employment: {info.employmentType}</div>
        <div>Department: {info.department?.name ?? '—'}</div>
        <div>Campus: {info.campus?.name ?? '—'}</div>
        <div>Designation: {info.designation?.name ?? '—'}</div>
        {rows.map(([k, v]) => v ? <div key={k}>{k}: {v}</div> : null)}
      </div>
    </Card>
  );
}

function EditEmployeeForm({
  employee,
  lookups,
  onSubmit,
  onError,
}: {
  employee: EmployeeDetailDto;
  lookups: HrLookupState;
  onSubmit: (body: Record<string, unknown>) => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [form, setForm] = useState<{
    employmentStatus: string;
    employmentType: string;
    phone: string;
    personalEmail: string;
    departmentId: string;
    designationId: string;
  }>({
    employmentStatus: employee.employmentStatus,
    employmentType: employee.employmentType,
    phone: employee.phone ?? '',
    personalEmail: employee.personalEmail ?? '',
    departmentId: employee.departmentId ?? '',
    designationId: employee.designation?.id ?? '',
  });
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (e) {
      onError(loadError(e, 'Failed to update employee'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Edit</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
        <div style={labelStyle}><label>Status</label>
          <select style={selectStyle} value={form.employmentStatus} onChange={(e) => setForm((f) => ({ ...f, employmentStatus: e.target.value }))}>
            {EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div style={labelStyle}><label>Employment type</label>
          <select style={selectStyle} value={form.employmentType} onChange={(e) => setForm((f) => ({ ...f, employmentType: e.target.value }))}>
            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <Input label="Phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        <Input label="Personal email" value={form.personalEmail} onChange={(e) => setForm((f) => ({ ...f, personalEmail: e.target.value }))} />
        <div style={labelStyle}><label>Department</label>
          <select style={selectStyle} value={form.departmentId} onChange={(e) => setForm((f) => ({ ...f, departmentId: e.target.value }))}>
            <option value="">—</option>
            {lookups.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div style={labelStyle}><label>Designation</label>
          <select style={selectStyle} value={form.designationId} onChange={(e) => setForm((f) => ({ ...f, designationId: e.target.value }))}>
            <option value="">—</option>
            {lookups.designations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
      </div>
      <Button style={{ marginTop: 12 }} onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
    </Card>
  );
}

function JoiningsSection({
  employeeId,
  joinings,
  can,
  onError,
  onNotice,
  onChanged,
}: {
  employeeId: string;
  joinings: EmployeeJoiningDto[];
  can: Permissions;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onChanged: () => void;
}) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ joiningStatus: 'PENDING', offerDate: '', effectiveDate: '', probationMonths: '', confirmationDate: '', remarks: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch(`/hr/employees/${employeeId}/joinings`, {
        method: 'POST',
        body: JSON.stringify({
          joiningStatus: form.joiningStatus,
          offerDate: form.offerDate || undefined,
          effectiveDate: form.effectiveDate || undefined,
          probationMonths: form.probationMonths ? Number(form.probationMonths) : undefined,
          confirmationDate: form.confirmationDate || undefined,
          remarks: form.remarks || undefined,
        }),
      });
      onNotice('Joining record created.');
      setShow(false);
      onChanged();
    } catch (e) {
      onError(loadError(e, 'Failed to create joining record'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>Joining / onboarding</h3>
        {can.create && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'Add'}</Button>}
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
          <div style={labelStyle}><label>Status</label>
            <select style={selectStyle} value={form.joiningStatus} onChange={(e) => set('joiningStatus', e.target.value)}>
              {JOINING_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <Input label="Offer date" type="date" value={form.offerDate} onChange={(e) => set('offerDate', e.target.value)} />
          <Input label="Effective date" type="date" value={form.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} />
          <Input label="Probation months" type="number" value={form.probationMonths} onChange={(e) => set('probationMonths', e.target.value)} />
          <Input label="Confirmation date" type="date" value={form.confirmationDate} onChange={(e) => set('confirmationDate', e.target.value)} />
          <Input label="Remarks" value={form.remarks} onChange={(e) => set('remarks', e.target.value)} />
          <Button onClick={submit} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Save'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Status</th><th style={thStyle}>Offer</th><th style={thStyle}>Effective</th>
            <th style={thStyle}>Probation (mo)</th><th style={thStyle}>Confirmation</th><th style={thStyle}>Remarks</th>
          </tr>
        </thead>
        <tbody>
          {joinings.map((j) => (
            <tr key={j.id}>
              <td style={tdStyle}><Badge value={j.joiningStatus} /></td>
              <td style={tdStyle}>{fmtDate(j.offerDate)}</td>
              <td style={tdStyle}>{fmtDate(j.effectiveDate)}</td>
              <td style={tdStyle}>{j.probationMonths ?? '—'}</td>
              <td style={tdStyle}>{fmtDate(j.confirmationDate)}</td>
              <td style={tdStyle}>{j.remarks ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {joinings.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No joining records.</p>}
    </Card>
  );
}

function ExitsSection({
  employeeId,
  exits,
  can,
  onError,
  onNotice,
  onChanged,
}: {
  employeeId: string;
  exits: EmployeeExitDto[];
  can: Permissions;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onChanged: () => void;
}) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ exitType: 'RESIGNATION', effectiveDate: '', lastWorkingDate: '', reason: '', noDueStatus: 'PENDING', settlementAmount: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch(`/hr/employees/${employeeId}/exits`, {
        method: 'POST',
        body: JSON.stringify({
          exitType: form.exitType,
          effectiveDate: form.effectiveDate || undefined,
          lastWorkingDate: form.lastWorkingDate || undefined,
          reason: form.reason || undefined,
          noDueStatus: form.noDueStatus,
          settlementAmount: form.settlementAmount ? Number(form.settlementAmount) : undefined,
        }),
      });
      onNotice('Exit record created; the employee has been marked as exited.');
      setShow(false);
      onChanged();
    } catch (e) {
      onError(loadError(e, 'Failed to record exit'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>Exits / offboarding</h3>
        {can.create && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'Record exit'}</Button>}
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
          <div style={labelStyle}><label>Exit type</label>
            <select style={selectStyle} value={form.exitType} onChange={(e) => set('exitType', e.target.value)}>
              {EXIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Input label="Effective date" type="date" value={form.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} />
          <Input label="Last working date" type="date" value={form.lastWorkingDate} onChange={(e) => set('lastWorkingDate', e.target.value)} />
          <Input label="Reason" value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          <div style={labelStyle}><label>No-due status</label>
            <select style={selectStyle} value={form.noDueStatus} onChange={(e) => set('noDueStatus', e.target.value)}>
              {NO_DUE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <Input label="Settlement amount" type="number" value={form.settlementAmount} onChange={(e) => set('settlementAmount', e.target.value)} />
          <Button onClick={submit} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Save'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Type</th><th style={thStyle}>Effective</th><th style={thStyle}>Last day</th>
            <th style={thStyle}>No-due</th><th style={thStyle}>Settlement</th><th style={thStyle}>Reason</th>
          </tr>
        </thead>
        <tbody>
          {exits.map((x) => (
            <tr key={x.id}>
              <td style={tdStyle}>{x.exitType}</td>
              <td style={tdStyle}>{fmtDate(x.effectiveDate)}</td>
              <td style={tdStyle}>{fmtDate(x.lastWorkingDate)}</td>
              <td style={tdStyle}><Badge value={x.noDueStatus} /></td>
              <td style={tdStyle}>{money(x.settlementAmount)}</td>
              <td style={tdStyle}>{x.reason ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {exits.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No exit records.</p>}
    </Card>
  );
}

function DocumentsSection({
  employeeId,
  documents,
  can,
  onError,
  onNotice,
}: {
  employeeId: string;
  documents: EmployeeDocumentDto[];
  can: Permissions;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ documentType: 'OTHER', title: '' });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async () => {
    if (!file) {
      onError('Please choose a file first.');
      return;
    }
    setBusy(true);
    try {
      const prepared = await requestUpload(employeeId, {
        documentType: form.documentType,
        title: form.title || undefined,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
      });
      const sizeBytes = await uploadToUrl(prepared.uploadUrl, file);
      await apiFetch(`/hr/documents/${prepared.document.id}/confirm`, { method: 'POST', body: JSON.stringify({ sizeBytes }) });
      onNotice('Document uploaded.');
      setFile(null);
      setForm((f) => ({ ...f, title: '' }));
      setShow(false);
    } catch (e) {
      onError(loadError(e, 'Upload failed'));
    } finally {
      setBusy(false);
    }
  };

  const toggleVerify = async (doc: EmployeeDocumentDto) => {
    try {
      await apiFetch(`/hr/documents/${doc.id}/verify`, { method: 'POST', body: JSON.stringify({ verified: !doc.isVerified }) });
      onNotice('Document verification updated.');
      window.dispatchEvent(new Event('hr-reload'));
    } catch (e) {
      onError(loadError(e, 'Failed to update document'));
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>Documents</h3>
        {can.create && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'Upload'}</Button>}
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 10 }}>
          <div style={labelStyle}><label>Type</label>
            <select style={selectStyle} value={form.documentType} onChange={(e) => setForm((f) => ({ ...f, documentType: e.target.value }))}>
              {DOCUMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Input label="Title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          <Input label="File" type="file" accept="*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <Button onClick={upload} disabled={busy} style={{ alignSelf: 'flex-end' }}>{busy ? 'Uploading…' : 'Upload'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Type</th><th style={thStyle}>Title</th><th style={thStyle}>Size</th>
            <th style={thStyle}>Verified</th><th style={thStyle}>Uploaded</th><th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((d) => (
            <tr key={d.id}>
              <td style={tdStyle}><Badge value={d.documentType} /></td>
              <td style={tdStyle}>{d.title ?? d.fileName ?? '—'}</td>
              <td style={tdStyle}>{d.sizeBytes ? `${(d.sizeBytes / 1024).toFixed(1)} KB` : '—'}</td>
              <td style={tdStyle}>{d.isVerified ? 'Yes' : 'No'}</td>
              <td style={tdStyle}>{fmtDate(d.createdAt)}</td>
              <td style={tdStyle}>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      await downloadDocument(d.id);
                      onNotice('Signed download URL generated.');
                    } catch (e) {
                      onError(loadError(e, 'Failed to download'));
                    }
                  }}
                >
                  Download
                </Button>
                {can.update && (
                  <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => toggleVerify(d)}>
                    {d.isVerified ? 'Unverify' : 'Verify'}
                  </Button>
                )}
                {can.del && (
                  <Button
                    variant="secondary"
                    style={{ marginLeft: 6 }}
                    onClick={async () => {
                      try {
                        await apiFetch(`/hr/documents/${d.id}`, { method: 'DELETE' });
                        onNotice('Document deleted.');
                        window.dispatchEvent(new Event('hr-reload'));
                      } catch (e) {
                        onError(loadError(e, 'Failed to delete document'));
                      }
                    }}
                  >
                    Delete
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {documents.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No documents.</p>}
    </Card>
  );
}

function WorkloadSection({
  employeeId,
  workloads,
  lookups,
  can,
  onError,
  onNotice,
  onChanged,
}: {
  employeeId: string;
  workloads: FacultyWorkloadDto[];
  lookups: HrLookupState;
  can: Permissions;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onChanged: () => void;
}) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ workloadType: 'TEACHING', title: '', description: '', hoursPerWeek: '', termId: '', effectiveFrom: '', effectiveTo: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch('/hr/workloads', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          workloadType: form.workloadType,
          title: form.title,
          description: form.description || undefined,
          hoursPerWeek: form.hoursPerWeek ? Number(form.hoursPerWeek) : undefined,
          termId: form.termId || undefined,
          effectiveFrom: form.effectiveFrom || undefined,
          effectiveTo: form.effectiveTo || undefined,
        }),
      });
      onNotice('Workload created.');
      setShow(false);
      onChanged();
    } catch (e) {
      onError(loadError(e, 'Failed to create workload'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>Faculty workload</h3>
        {can.create && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'Add'}</Button>}
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
          <div style={labelStyle}><label>Type</label>
            <select style={selectStyle} value={form.workloadType} onChange={(e) => set('workloadType', e.target.value)}>
              {WORKLOAD_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Input label="Title *" value={form.title} onChange={(e) => set('title', e.target.value)} />
          <Input label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} />
          <Input label="Hours / week" type="number" value={form.hoursPerWeek} onChange={(e) => set('hoursPerWeek', e.target.value)} />
          <div style={labelStyle}><label>Term</label>
            <select style={selectStyle} value={form.termId} onChange={(e) => set('termId', e.target.value)}>
              <option value="">—</option>
              {lookups.terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <Input label="From" type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
          <Input label="To" type="date" value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
          <Button onClick={submit} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Save'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Type</th><th style={thStyle}>Title</th><th style={thStyle}>Term</th>
            <th style={thStyle}>Hrs/wk</th><th style={thStyle}>Active</th>
          </tr>
        </thead>
        <tbody>
          {workloads.map((w) => (
            <tr key={w.id}>
              <td style={tdStyle}><Badge value={w.workloadType} /></td>
              <td style={tdStyle}>{w.title}</td>
              <td style={tdStyle}>{w.term?.name ?? '—'}</td>
              <td style={tdStyle}>{w.hoursPerWeek ?? 0}</td>
              <td style={tdStyle}>{w.isActive ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {workloads.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No workload allocations.</p>}
    </Card>
  );
}

function SalarySection({
  employeeId,
  structures,
  can,
  onError,
  onNotice,
  onChanged,
}: {
  employeeId: string;
  structures: SalaryStructureDto[];
  can: Permissions;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
  onChanged: () => void;
}) {
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ basicAmount: '', hraAmount: '', effectiveFrom: '', effectiveTo: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch('/hr/salary-structures', {
        method: 'POST',
        body: JSON.stringify({
          employeeId,
          basicAmount: Number(form.basicAmount),
          hraAmount: form.hraAmount ? Number(form.hraAmount) : undefined,
          effectiveFrom: form.effectiveFrom || undefined,
          effectiveTo: form.effectiveTo || undefined,
        }),
      });
      onNotice('Salary structure created.');
      setShow(false);
      onChanged();
    } catch (e) {
      onError(loadError(e, 'Failed to create salary structure'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>Salary structures</h3>
        {can.manage && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'Add'}</Button>}
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
          <Input label="Basic amount *" type="number" value={form.basicAmount} onChange={(e) => set('basicAmount', e.target.value)} />
          <Input label="HRA" type="number" value={form.hraAmount} onChange={(e) => set('hraAmount', e.target.value)} />
          <Input label="Effective from" type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
          <Input label="Effective to" type="date" value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
          <Button onClick={submit} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Save'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>From</th><th style={thStyle}>To</th><th style={thStyle}>Basic</th>
            <th style={thStyle}>HRA</th><th style={thStyle}>Gross</th><th style={thStyle}>Net</th><th style={thStyle}>Active</th>
          </tr>
        </thead>
        <tbody>
          {structures.map((s) => (
            <tr key={s.id}>
              <td style={tdStyle}>{fmtDate(s.effectiveFrom)}</td>
              <td style={tdStyle}>{fmtDate(s.effectiveTo)}</td>
              <td style={tdStyle}>{money(s.basicAmount)}</td>
              <td style={tdStyle}>{money(s.hraAmount)}</td>
              <td style={tdStyle}>{money(s.grossAmount)}</td>
              <td style={tdStyle}>{money(s.netAmount)}</td>
              <td style={tdStyle}>{s.isActive ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {structures.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No salary structures.</p>}
    </Card>
  );
}

function SmallLeavesSection({ applications }: { applications: unknown }) {
  const list = (applications ?? []) as LeaveApplicationDto[];
  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Leave applications</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Type</th><th style={thStyle}>From</th><th style={thStyle}>To</th><th style={thStyle}>Days</th><th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((a) => (
            <tr key={a.id}>
              <td style={tdStyle}>{a.leaveType?.name ?? '—'}</td>
              <td style={tdStyle}>{fmtDate(a.fromDate)}</td>
              <td style={tdStyle}>{fmtDate(a.toDate)}</td>
              <td style={tdStyle}>{a.durationDays}</td>
              <td style={tdStyle}><Badge value={a.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <p style={{ color: '#9ca3af' }}>No leave applications.</p>}
    </Card>
  );
}

function SmallReviewsSection({ reviews }: { reviews: unknown }) {
  const list = (reviews ?? []) as PerformanceReviewDto[];
  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Performance reviews</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Type</th><th style={thStyle}>Period</th><th style={thStyle}>Score</th><th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle}>{r.reviewType ?? '—'}</td>
              <td style={tdStyle}>{r.reviewPeriodStart ? `${fmtDate(r.reviewPeriodStart)} → ${fmtDate(r.reviewPeriodEnd)}` : '—'}</td>
              <td style={tdStyle}>{r.score ?? '—'}</td>
              <td style={tdStyle}><Badge value={r.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length === 0 && <p style={{ color: '#9ca3af' }}>No performance reviews.</p>}
    </Card>
  );
}

function TimetableAndAttendanceSection({
  employeeId,
  onError,
}: {
  employeeId: string;
  onError: (msg: string) => void;
}) {
  const [view, setView] = useState<'none' | 'timetable' | 'attendance'>('none');
  const [rows, setRows] = useState<unknown[]>([]);

  const open = async (kind: 'timetable' | 'attendance') => {
    setView(kind);
    setRows([]);
    try {
      const res = await apiFetch<unknown[]>(`/hr/employees/${employeeId}/${kind === 'timetable' ? 'timetable' : 'attendance'}`);
      setRows(res);
    } catch (e) {
      onError(loadError(e, `Failed to load ${kind}`));
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>Timetable &amp; attendance</h3>
        <Button variant="secondary" onClick={() => open('timetable')}>Timetable</Button>
        <Button variant="secondary" onClick={() => open('attendance')}>Attendance</Button>
      </div>
      {view !== 'none' && (
        <pre style={{ fontSize: '0.8rem', whiteSpace: 'pre-wrap', background: '#f9fafb', padding: 12, borderRadius: 8, marginTop: 8, maxHeight: 300, overflowY: 'auto' }}>
          {rows.length === 0 ? 'No rows.' : JSON.stringify(rows, null, 2)}
        </pre>
      )}
    </Card>
  );
}

// ── Leave ───────────────────────────────────────────────────────────────────

function LeaveTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [section, setSection] = useState<'types' | 'balances' | 'applications'>('applications');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" onClick={() => setSection('types')}>Leave types</Button>
        <Button variant="secondary" onClick={() => setSection('balances')}>Balances</Button>
        <Button variant="secondary" onClick={() => setSection('applications')}>Applications</Button>
      </div>
      {section === 'types' && <LeaveTypesTab can={can} reload={reload} onReload={onReload} onError={onError} onNotice={onNotice} />}
      {section === 'balances' && <LeaveBalancesTab can={can} reload={reload} onReload={onReload} onError={onError} onNotice={onNotice} />}
      {section === 'applications' && <LeaveApplicationsTab can={can} reload={reload} onReload={onReload} onError={onError} onNotice={onNotice} />}
    </div>
  );
}

function LeaveTypesTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<LeaveTypeDto[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', category: 'CASUAL', color: '#3b82f6', maxDaysPerYear: '', isPaid: 'true', requiresApproval: 'true' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let mounted = true;
    apiFetch<LeaveTypeDto[]>('/hr/leave-types')
      .then((res) => mounted && setRows(res))
      .catch((e) => onError(loadError(e, 'Failed to load leave types')));
    return () => {
      mounted = false;
    };
  }, [reload, onError]);

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch('/hr/leave-types', {
        method: 'POST',
        body: JSON.stringify({
          code: form.code,
          name: form.name,
          category: form.category,
          color: form.color,
          maxDaysPerYear: form.maxDaysPerYear ? Number(form.maxDaysPerYear) : undefined,
          isPaid: form.isPaid === 'true',
          requiresApproval: form.requiresApproval === 'true',
        }),
      });
      onNotice('Leave type created.');
      setShow(false);
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to create leave type'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (t: LeaveTypeDto) => {
    try {
      await apiFetch(`/hr/leave-types/${t.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: !t.isActive }) });
      onNotice('Leave type updated.');
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to update leave type'));
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>Leave types</h3>
        {can.create && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'New type'}</Button>}
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 10 }}>
          <Input label="Code *" value={form.code} onChange={(e) => set('code', e.target.value)} />
          <Input label="Name *" value={form.name} onChange={(e) => set('name', e.target.value)} />
          <div style={labelStyle}><label>Category</label>
            <select style={selectStyle} value={form.category} onChange={(e) => set('category', e.target.value)}>
              {LEAVE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <Input label="Color" type="color" value={form.color} onChange={(e) => set('color', e.target.value)} />
          <Input label="Max days / year" type="number" value={form.maxDaysPerYear} onChange={(e) => set('maxDaysPerYear', e.target.value)} />
          <div style={labelStyle}><label>Paid</label>
            <select style={selectStyle} value={form.isPaid} onChange={(e) => set('isPaid', e.target.value)}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>
          </div>
          <div style={labelStyle}><label>Requires approval</label>
            <select style={selectStyle} value={form.requiresApproval} onChange={(e) => set('requiresApproval', e.target.value)}>
              <option value="true">Yes</option><option value="false">No</option>
            </select>
          </div>
          <Button onClick={submit} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Save'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Code</th><th style={thStyle}>Name</th><th style={thStyle}>Category</th>
            <th style={thStyle}>Max days</th><th style={thStyle}>Paid</th><th style={thStyle}>Active</th><th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.id}>
              <td style={tdStyle}>{t.code}</td>
              <td style={tdStyle}>{t.name}</td>
              <td style={tdStyle}>{t.category}</td>
              <td style={tdStyle}>{t.maxDaysPerYear ?? '—'}</td>
              <td style={tdStyle}>{t.isPaid ? 'Yes' : 'No'}</td>
              <td style={tdStyle}>{t.isActive ? 'Yes' : 'No'}</td>
              <td style={tdStyle}>
                {can.update && <Button variant="secondary" onClick={() => toggle(t)}>{t.isActive ? 'Deactivate' : 'Activate'}</Button>}
                {can.del && (
                  <Button
                    variant="secondary"
                    style={{ marginLeft: 6 }}
                    onClick={async () => {
                      try {
                        await apiFetch(`/hr/leave-types/${t.id}`, { method: 'DELETE' });
                        onNotice('Leave type deleted.');
                        onReload();
                      } catch (e) {
                        onError(loadError(e, 'Failed to delete leave type'));
                      }
                    }}
                  >
                    Delete
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No leave types.</p>}
    </Card>
  );
}

function LeaveBalancesTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const lookups = useHrLookups();
  const [rows, setRows] = useState<LeaveBalanceDto[]>([]);
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [employeeId, setEmployeeId] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const [form, setForm] = useState({ employeeId: '', leaveTypeId: '', year: String(new Date().getFullYear()), openingBalance: '', creditedDays: '', availedDays: '', adjustedDays: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
    if (year) params.set('year', year);
    if (employeeId) params.set('employeeId', employeeId);
    apiFetch<{ data: LeaveBalanceDto[]; total: number }>(`/hr/leave-balances?${params.toString()}`)
      .then((res) => mounted && setRows(res.data))
      .catch((e) => onError(loadError(e, 'Failed to load leave balances')));
    return () => {
      mounted = false;
    };
  }, [year, employeeId, reload, onError]);

  const submit = async () => {
    setSaving(true);
    try {
      await apiFetch('/hr/leave-balances/adjust', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: form.employeeId,
          leaveTypeId: form.leaveTypeId,
          year: Number(form.year),
          openingBalance: form.openingBalance ? Number(form.openingBalance) : undefined,
          creditedDays: form.creditedDays ? Number(form.creditedDays) : undefined,
          availedDays: form.availedDays ? Number(form.availedDays) : undefined,
          adjustedDays: form.adjustedDays ? Number(form.adjustedDays) : undefined,
        }),
      });
      onNotice('Leave balance adjusted.');
      setAdjusting(false);
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to adjust balance'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: '0.9rem' }}>Leave balances</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <input style={selectStyle} type="number" value={year} min={2000} max={2200} placeholder="Year" onChange={(e) => setYear(e.target.value)} />
          <input style={selectStyle} value={employeeId} placeholder="Employee ID" onChange={(e) => setEmployeeId(e.target.value)} />
          {can.update && <Button variant="secondary" onClick={() => setAdjusting((v) => !v)}>{adjusting ? 'Cancel' : 'Adjust'}</Button>}
        </div>
      </div>
      {adjusting && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 10 }}>
          <div style={labelStyle}><label>Employee ID *</label>
            <input style={inputStyle} value={adjusting ? form.employeeId : ''} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} placeholder="EMP-0001" />
          </div>
          <div style={labelStyle}><label>Leave type *</label>
            <select style={selectStyle} value={adjusting ? form.leaveTypeId : ''} onChange={(e) => setForm((f) => ({ ...f, leaveTypeId: e.target.value }))}>
              <option value="">Select type</option>
              {lookups?.leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <Input label="Year" type="number" value={form.year} onChange={(e) => setForm((f) => ({ ...f, year: e.target.value }))} />
          <Input label="Opening" type="number" value={form.openingBalance} onChange={(e) => setForm((f) => ({ ...f, openingBalance: e.target.value }))} />
          <Input label="Credited" type="number" value={form.creditedDays} onChange={(e) => setForm((f) => ({ ...f, creditedDays: e.target.value }))} />
          <Input label="Availed" type="number" value={form.availedDays} onChange={(e) => setForm((f) => ({ ...f, availedDays: e.target.value }))} />
          <Input label="Adjusted" type="number" value={form.adjustedDays} onChange={(e) => setForm((f) => ({ ...f, adjustedDays: e.target.value }))} />
          <Button onClick={submit} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Adjust'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Leave type</th><th style={thStyle}>Year</th><th style={thStyle}>Opening</th>
            <th style={thStyle}>Credited</th><th style={thStyle}>Availed</th><th style={thStyle}>Adjusted</th><th style={thStyle}>Closing</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td style={tdStyle}>{b.leaveType?.name ?? '—'}</td>
              <td style={tdStyle}>{b.year}</td>
              <td style={tdStyle}>{b.openingBalance}</td>
              <td style={tdStyle}>{b.creditedDays}</td>
              <td style={tdStyle}>{b.availedDays}</td>
              <td style={tdStyle}>{b.adjustedDays}</td>
              <td style={tdStyle}><b>{b.closingBalance}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No balances for this filter.</p>}
    </Card>
  );
}

function LeaveApplicationsTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const lookups = useHrLookups();
  const [rows, setRows] = useState<LeaveApplicationDto[]>([]);
  const [status, setStatus] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ employeeId: '', leaveTypeId: '', fromDate: '', toDate: '', halfDayOption: '', reason: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
  if (status) params.set('status', status);

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: LeaveApplicationDto[]; total: number }>(`/hr/leave-applications?${params.toString()}`)
      .then((res) => mounted && setRows(res.data))
      .catch((e) => onError(loadError(e, 'Failed to load leave applications')));
    return () => {
      mounted = false;
    };
  }, [status, reload, onError]);

  const apply = async () => {
    setSaving(true);
    try {
      await apiFetch('/hr/leave-applications', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: form.employeeId,
          leaveTypeId: form.leaveTypeId,
          fromDate: form.fromDate,
          toDate: form.toDate || form.fromDate,
          halfDayOption: form.halfDayOption || undefined,
          reason: form.reason || undefined,
        }),
      });
      onNotice('Leave application submitted.');
      setShow(false);
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to apply'));
    } finally {
      setSaving(false);
    }
  };

  const decide = async (id: string, action: 'approve' | 'reject' | 'cancel') => {
    try {
      if (action === 'cancel') {
        await apiFetch(`/hr/leave-applications/${id}/cancel`, { method: 'POST' });
      } else {
        await apiFetch(`/hr/leave-applications/${id}/${action}`, { method: 'POST', body: JSON.stringify({ remarks: undefined }) });
      }
      onNotice(`Application ${action}ed.`);
      onReload();
    } catch (e) {
      onError(loadError(e, `Failed to ${action}`));
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: '0.9rem' }}>Leave applications</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {LEAVE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {can.view && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'Apply'}</Button>}
        </div>
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginTop: 10 }}>
          <div style={labelStyle}><label>Employee id *</label>
            <input style={inputStyle} value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)} />
          </div>
          <div style={labelStyle}><label>Leave type *</label>
            <select style={selectStyle} value={form.leaveTypeId} onChange={(e) => set('leaveTypeId', e.target.value)}>
              <option value="">Select type</option>
              {lookups?.leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <Input label="From *" type="date" value={form.fromDate} onChange={(e) => set('fromDate', e.target.value)} />
          <Input label="To" type="date" value={form.toDate} onChange={(e) => set('toDate', e.target.value)} />
          <div style={labelStyle}><label>Half day</label>
            <select style={selectStyle} value={form.halfDayOption} onChange={(e) => set('halfDayOption', e.target.value)}>
              <option value="">—</option>
              {HALF_DAY_OPTIONS.map((h) => <option key={h} value={h}>{h}</option>)}
            </select>
          </div>
          <Input label="Reason" value={form.reason} onChange={(e) => set('reason', e.target.value)} />
          <Button onClick={apply} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Submit'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Employee</th><th style={thStyle}>Type</th><th style={thStyle}>Dates</th>
            <th style={thStyle}>Days</th><th style={thStyle}>Status</th><th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td style={tdStyle}>{a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : a.employeeId}</td>
              <td style={tdStyle}>{a.leaveType?.name ?? '—'}</td>
              <td style={tdStyle}>{fmtDate(a.fromDate)} → {fmtDate(a.toDate)}</td>
              <td style={tdStyle}>{a.durationDays}</td>
              <td style={tdStyle}><Badge value={a.status} /></td>
              <td style={tdStyle}>
                {a.status === 'PENDING' && can.update && (
                  <>
                    <Button variant="secondary" onClick={() => decide(a.id, 'approve')}>Approve</Button>
                    <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => decide(a.id, 'reject')}>Reject</Button>
                    <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => decide(a.id, 'cancel')}>Cancel</Button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No applications.</p>}
    </Card>
  );
}

// ── Performance ─────────────────────────────────────────────────────────────

function PerformanceTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<PerformanceReviewDto[]>([]);
  const [status, setStatus] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ employeeId: '', reviewType: 'SELF', score: '', reviewPeriodStart: '', reviewPeriodEnd: '', achievements: '', areasForImprovement: '', overallComments: '', reviewerUserId: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
  if (status) params.set('status', status);

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: PerformanceReviewDto[]; total: number }>(`/hr/performance-reviews?${params.toString()}`)
      .then((res) => mounted && setRows(res.data))
      .catch((e) => onError(loadError(e, 'Failed to load reviews')));
    return () => {
      mounted = false;
    };
  }, [status, reload, onError]);

  const create = async () => {
    setSaving(true);
    try {
      await apiFetch('/hr/performance-reviews', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: form.employeeId,
          reviewType: form.reviewType,
          score: form.score ? Number(form.score) : undefined,
          reviewPeriodStart: form.reviewPeriodStart || undefined,
          reviewPeriodEnd: form.reviewPeriodEnd || undefined,
          achievements: form.achievements || undefined,
          areasForImprovement: form.areasForImprovement || undefined,
          overallComments: form.overallComments || undefined,
          reviewerUserId: form.reviewerUserId || undefined,
        }),
      });
      onNotice('Review created.');
      setShow(false);
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to create review'));
    } finally {
      setSaving(false);
    }
  };

  const action = async (id: string, verb: 'submit' | 'approve' | 'reject' | 'complete') => {
    try {
      await apiFetch(`/hr/performance-reviews/${id}/${verb}`, { method: 'POST' });
      onNotice(`Review ${verb}ed.`);
      onReload();
    } catch (e) {
      onError(loadError(e, `Failed to ${verb}`));
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: '0.9rem' }}>Performance reviews</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {REVIEW_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {can.create && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'Start review'}</Button>}
        </div>
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
          <Input label="Employee id *" value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)} />
          <div style={labelStyle}><label>Type</label>
            <select style={selectStyle} value={form.reviewType} onChange={(e) => set('reviewType', e.target.value)}>
              {REVIEW_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Input label="Score (0–9.99)" type="number" min={0} max={9.99} step={0.01} value={form.score} onChange={(e) => set('score', e.target.value)} />
          <Input label="Period from" type="date" value={form.reviewPeriodStart} onChange={(e) => set('reviewPeriodStart', e.target.value)} />
          <Input label="Period to" type="date" value={form.reviewPeriodEnd} onChange={(e) => set('reviewPeriodEnd', e.target.value)} />
          <Input label="Reviewer user id" value={form.reviewerUserId} onChange={(e) => set('reviewerUserId', e.target.value)} />
          <Input label="Achievements" value={form.achievements} onChange={(e) => set('achievements', e.target.value)} />
          <Input label="Areas for improvement" value={form.areasForImprovement} onChange={(e) => set('areasForImprovement', e.target.value)} />
          <Input label="Overall comments" value={form.overallComments} onChange={(e) => set('overallComments', e.target.value)} />
          <Button onClick={create} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Create'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Employee</th><th style={thStyle}>Type</th><th style={thStyle}>Period</th>
            <th style={thStyle}>Score</th><th style={thStyle}>Status</th><th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle}>{r.employeeId}</td>
              <td style={tdStyle}>{r.reviewType ?? '—'}</td>
              <td style={tdStyle}>{r.reviewPeriodStart ? `${fmtDate(r.reviewPeriodStart)} → ${fmtDate(r.reviewPeriodEnd)}` : '—'}</td>
              <td style={tdStyle}>{r.score ?? '—'}</td>
              <td style={tdStyle}><Badge value={r.status} /></td>
              <td style={tdStyle}>
                {r.status === 'DRAFT' && can.update && <Button variant="secondary" onClick={() => action(r.id, 'submit')}>Submit</Button>}
                {r.status === 'SUBMITTED' && can.update && (
                  <>
                    <Button variant="secondary" onClick={() => action(r.id, 'approve')}>Approve</Button>
                    <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => action(r.id, 'reject')}>Reject</Button>
                  </>
                )}
                {r.status === 'APPROVED' && can.update && <Button variant="secondary" onClick={() => action(r.id, 'complete')}>Complete</Button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No reviews.</p>}
    </Card>
  );
}

// ── Payroll ─────────────────────────────────────────────────────────────────

function PayrollTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [section, setSection] = useState<'mine' | 'structures' | 'runs'>('runs');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" onClick={() => setSection('mine')}>My payslips</Button>
        <Button variant="secondary" onClick={() => setSection('structures')}>Salary structures</Button>
        <Button variant="secondary" onClick={() => setSection('runs')}>Payroll runs</Button>
      </div>
      {section === 'mine' && <MyPayslipsTab onError={onError} />}
      {section === 'structures' && <SalaryStructuresTab can={can} reload={reload} onReload={onReload} onError={onError} onNotice={onNotice} />}
      {section === 'runs' && <PayrollRunsTab can={can} reload={reload} onReload={onReload} onError={onError} onNotice={onNotice} />}
    </div>
  );
}

function MyPayslipsTab({ onError }: { onError: (msg: string) => void }) {
  const [rows, setRows] = useState<PayslipDto[]>([]);
  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: PayslipDto[]; total: number }>('/hr/payslips/mine')
      .then((res) => mounted && setRows(res.data))
      .catch((e) => onError(loadError(e, 'Failed to load payslips')));
    return () => {
      mounted = false;
    };
  }, [onError]);

  return (
    <Card>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>My payslips</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={thStyle}>Period</th><th style={thStyle}>Title</th><th style={thStyle}>Status</th><th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => (
            <tr key={p.id}>
              <td style={tdStyle}>{p.run.month}/{p.run.year}</td>
              <td style={tdStyle}>{p.run.title ?? '—'}</td>
              <td style={tdStyle}><Badge value={p.run.status} /></td>
              <td style={tdStyle}>
                <Button
                  variant="secondary"
                  onClick={async () => {
                    try {
                      if (!p.payslipDocument?.id) return;
                      await downloadDocument(p.payslipDocument.id);
                      onError('');
                    } catch (e) {
                      onError(loadError(e, 'Failed to download payslip'));
                    }
                  }}
                >
                  Download
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No payslips available yet.</p>}
    </Card>
  );
}

function SalaryStructuresTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<SalaryStructureDto[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ employeeId: '', basicAmount: '', hraAmount: '', effectiveFrom: '', effectiveTo: '' });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: SalaryStructureDto[]; total: number }>(`/hr/salary-structures?skip=0&take=${TAKE}`)
      .then((res) => mounted && setRows(res.data))
      .catch((e) => onError(loadError(e, 'Failed to load salary structures')));
    return () => {
      mounted = false;
    };
  }, [reload, onError]);

  const create = async () => {
    setSaving(true);
    try {
      await apiFetch('/hr/salary-structures', {
        method: 'POST',
        body: JSON.stringify({
          employeeId: form.employeeId,
          basicAmount: Number(form.basicAmount),
          hraAmount: form.hraAmount ? Number(form.hraAmount) : undefined,
          effectiveFrom: form.effectiveFrom || undefined,
          effectiveTo: form.effectiveTo || undefined,
        }),
      });
      onNotice('Salary structure created.');
      setShow(false);
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to create salary structure'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ fontSize: '0.9rem' }}>Salary structures</h3>
        {can.manage && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'New structure'}</Button>}
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginTop: 10 }}>
          <Input label="Employee id *" value={form.employeeId} onChange={(e) => set('employeeId', e.target.value)} />
          <Input label="Basic amount *" type="number" value={form.basicAmount} onChange={(e) => set('basicAmount', e.target.value)} />
          <Input label="HRA" type="number" value={form.hraAmount} onChange={(e) => set('hraAmount', e.target.value)} />
          <Input label="Effective from" type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} />
          <Input label="Effective to" type="date" value={form.effectiveTo} onChange={(e) => set('effectiveTo', e.target.value)} />
          <Button onClick={create} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Create'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Employee</th><th style={thStyle}>From</th><th style={thStyle}>Basic</th>
            <th style={thStyle}>HRA</th><th style={thStyle}>Gross</th><th style={thStyle}>Net</th><th style={thStyle}>Active</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id}>
              <td style={tdStyle}>{s.employeeId}</td>
              <td style={tdStyle}>{fmtDate(s.effectiveFrom)}</td>
              <td style={tdStyle}>{money(s.basicAmount)}</td>
              <td style={tdStyle}>{money(s.hraAmount)}</td>
              <td style={tdStyle}>{money(s.grossAmount)}</td>
              <td style={tdStyle}>{money(s.netAmount)}</td>
              <td style={tdStyle}>{s.isActive ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No salary structures.</p>}
    </Card>
  );
}

function PayrollRunsTab({
  can,
  reload,
  onReload,
  onError,
  onNotice,
}: {
  can: Permissions;
  reload: number;
  onReload: () => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const [rows, setRows] = useState<PayrollRunDto[]>([]);
  const [status, setStatus] = useState('');
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ month: String(new Date().getMonth() + 1), year: String(new Date().getFullYear()), title: '' });
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<PayrollRunDetailDto | null>(null);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const params = new URLSearchParams({ skip: '0', take: String(TAKE) });
  if (status) params.set('status', status);

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: PayrollRunDto[]; total: number }>(`/hr/payroll-runs?${params.toString()}`)
      .then((res) => mounted && setRows(res.data))
      .catch((e) => onError(loadError(e, 'Failed to load payroll runs')));
    return () => {
      mounted = false;
    };
  }, [status, reload, onError]);

  const create = async () => {
    setSaving(true);
    try {
      await apiFetch('/hr/payroll-runs', {
        method: 'POST',
        body: JSON.stringify({ month: Number(form.month), year: Number(form.year), title: form.title || undefined }),
      });
      onNotice('Payroll run created.');
      setShow(false);
      onReload();
    } catch (e) {
      onError(loadError(e, 'Failed to create payroll run'));
    } finally {
      setSaving(false);
    }
  };

  const act = async (id: string, verb: 'process' | 'approve' | 'cancel' | 'pay') => {
    try {
      const body = verb === 'pay' ? JSON.stringify({ referenceNumber: undefined }) : undefined;
      await apiFetch(`/hr/payroll-runs/${id}/${verb}`, { method: 'POST', body });
      onNotice(`Run ${verb}ed.`);
      onReload();
      if (detail?.id === id) loadRun(id);
    } catch (e) {
      onError(loadError(e, `Failed to ${verb}`));
    }
  };

  const loadRun = async (id: string) => {
    try {
      const res = await apiFetch<PayrollRunDetailDto>(`/hr/payroll-runs/${id}`);
      setDetail(res);
    } catch (e) {
      onError(loadError(e, 'Failed to load run'));
    }
  };

  const linkPayslip = async (lineId: string, file: File) => {
    try {
      const prepared = await apiFetch<{ document: EmployeeDocumentDto; uploadUrl: string }>(`/hr/payroll-lines/${lineId}/payslip`, {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, mimeType: file.type || 'application/octet-stream', title: `Payslip ${file.name}` }),
      });
      await uploadToUrl(prepared.uploadUrl, file);
      await apiFetch(`/hr/documents/${prepared.document.id}/confirm`, { method: 'POST', body: JSON.stringify({ sizeBytes: file.size }) });
      onNotice('Payslip linked.');
      if (detail) await loadRun(detail.id);
    } catch (e) {
      onError(loadError(e, 'Failed to link payslip'));
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: '0.9rem' }}>Payroll runs</h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={selectStyle} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {PAYROLL_RUN_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          {can.manage && <Button variant="secondary" onClick={() => setShow((v) => !v)}>{show ? 'Cancel' : 'New run'}</Button>}
        </div>
      </div>
      {show && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10, marginTop: 10 }}>
          <Input label="Month *" type="number" min={1} max={12} value={form.month} onChange={(e) => set('month', e.target.value)} />
          <Input label="Year *" type="number" min={2000} max={2200} value={form.year} onChange={(e) => set('year', e.target.value)} />
          <Input label="Title" value={form.title} onChange={(e) => set('title', e.target.value)} />
          <Button onClick={create} disabled={saving} style={{ alignSelf: 'flex-end' }}>{saving ? '…' : 'Create'}</Button>
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Title</th><th style={thStyle}>Month / Year</th><th style={thStyle}>Status</th><th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle}>{r.title ?? '—'}</td>
              <td style={tdStyle}>{r.month}/{r.year}</td>
              <td style={tdStyle}><Badge value={r.status} /></td>
              <td style={tdStyle}>
                <Button variant="secondary" onClick={() => loadRun(r.id)}>View</Button>
                {can.manage && r.status === 'DRAFT' && <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => act(r.id, 'process')}>Process</Button>}
                {can.manage && r.status === 'PROCESSED' && <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => act(r.id, 'approve')}>Approve</Button>}
                {can.manage && r.status === 'APPROVED' && <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => act(r.id, 'pay')}>Pay</Button>}
                {can.manage && (r.status === 'DRAFT' || r.status === 'PROCESSED') && (
                  <Button variant="secondary" style={{ marginLeft: 6 }} onClick={() => act(r.id, 'cancel')}>Cancel</Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No payroll runs.</p>}

      {detail && (
        <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ fontSize: '0.95rem' }}>
              Run {detail.month}/{detail.year} — <Badge value={detail.status} />
            </h3>
            <Button variant="secondary" onClick={() => setDetail(null)}>Close</Button>
          </div>
          <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '4px 0 8px' }}>
            Totals — gross {money(detail.totals.gross)} · deductions {money(detail.totals.deductions)} · net {money(detail.totals.net)}
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Employee</th><th style={thStyle}>Gross</th><th style={thStyle}>Net</th><th style={thStyle}>Status</th><th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {detail.lines.map((l) => (
                <tr key={l.id}>
                  <td style={tdStyle}>{l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : l.employeeId}</td>
                  <td style={tdStyle}>{money(l.grossAmount)}</td>
                  <td style={tdStyle}>{money(l.netAmount)}</td>
                  <td style={tdStyle}><Badge value={l.status} /></td>
                  <td style={tdStyle}>
                    {can.manage && l.status === 'PROCESSED' && (
                      <label style={{ fontSize: '0.8rem', color: '#4b5563', display: 'flex', alignItems: 'center', gap: 6 }}>
                        Payslip file
                        <input
                          type="file"
                          style={{ maxWidth: 220 }}
                          onChange={async (e) => {
                            const f = e.target.files?.[0];
                            if (f) await linkPayslip(l.id, f);
                          }}
                        />
                      </label>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {detail.lines.length === 0 && <p style={{ color: '#9ca3af', marginTop: 8 }}>No lines yet — process the run to generate them.</p>}
        </div>
      )}
    </Card>
  );
}