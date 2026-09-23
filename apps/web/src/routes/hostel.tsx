import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';
import {
  HOSTEL_CREATE_PERMISSION,
  HOSTEL_DELETE_PERMISSION,
  HOSTEL_MANAGE_PERMISSION,
  HOSTEL_UPDATE_PERMISSION,
  HOSTEL_VIEW_PERMISSION,
  type BedRow,
  type BookingRow,
  type BuildingRow,
  type ChargeRow,
  type ComplaintsReport,
  type ComplaintRow,
  type DuesReport,
  type FloorRow,
  type HostelRow,
  type HostelSummary,
  type HostelWardenRow,
  type LookupsPayload,
  type OccupancyReport,
  type Paged,
  type RoomRow,
  type SearchableStudent,
  type SearchableUser,
  type SummaryPerHostel,
  type VacancyReport,
  type VisitorRow,
} from './hostel-shared';

const EMPTY_LOOKUPS: LookupsPayload = {
  campuses: [],
  hostels: [],
  buildings: [],
  floors: [],
  rooms: [],
  beds: [],
  feeHeads: [],
  genderTypes: ['BOYS', 'GIRLS', 'COED'],
  roomSharing: ['SINGLE', 'DOUBLE', 'TRIPLE', 'FOUR', 'DORM'],
  bedStatuses: ['AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE'],
  wardenRoles: ['WARDEN', 'ASSISTANT'],
  complaintCategories: ['MAINTENANCE', 'ELECTRICAL', 'PLUMBING', 'CLEANING', 'INFRASTRUCTURE', 'NOISE', 'FOOD', 'SECURITY', 'OTHER'],
  complaintStatuses: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  visitorStatuses: ['INSIDE', 'EXITED'],
  bookingStatuses: ['REQUESTED', 'ALLOCATED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED'],
  feeStatuses: ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED'],
};

export function HostelPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<'summary' | 'setup' | 'wardens' | 'bookings' | 'charges' | 'complaints' | 'visitors' | 'reports'>('summary');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canView = permissions.includes(HOSTEL_VIEW_PERMISSION);
  const canCreate = permissions.includes(HOSTEL_CREATE_PERMISSION);
  const canUpdate = permissions.includes(HOSTEL_UPDATE_PERMISSION);
  const canDelete = permissions.includes(HOSTEL_DELETE_PERMISSION);
  const canManage = permissions.includes(HOSTEL_MANAGE_PERMISSION);

  if (!canView) {
    return <p style={{ color: '#9ca3af', padding: '2rem' }}>You do not have permission to view the hostel module.</p>;
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'setup', label: 'Setup' },
    { key: 'wardens', label: 'Wardens' },
    { key: 'bookings', label: 'Bookings' },
    { key: 'charges', label: 'Charges' },
    { key: 'complaints', label: 'Complaints' },
    { key: 'visitors', label: 'Visitors' },
    { key: 'reports', label: 'Reports' },
  ];

  return (
    <div style={{ maxWidth: 1180, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Hostel</h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {tabs.map((t) => (
            <Button key={t.key} variant={tab === t.key ? 'primary' : 'secondary'} onClick={() => setTab(t.key)}>
              {t.label}
            </Button>
          ))}
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'summary' && <SummaryTab onError={setError} />}
      {tab === 'setup' && <SetupTab canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'wardens' && <WardensTab canCreate={canManage} canUpdate={canManage} canDelete={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'bookings' && <BookingsTab canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'charges' && <ChargesTab canCreate={canManage} canUpdate={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'complaints' && <ComplaintsTab canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'visitors' && <VisitorsTab canCreate={canCreate} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'reports' && <ReportsTab onError={setError} />}
    </div>
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function fmtCents(cents: number | null | undefined): string {
  return `₹${((cents ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rupeeToCents(rupees: string): number {
  const parsed = parseInt(rupees, 10);
  return Number.isFinite(parsed) ? parsed * 100 : 0;
}

async function run(action: () => Promise<unknown>, success: string, onNotice: (m: string | null) => void, onError: (m: string | null) => void) {
  try {
    await action();
    onNotice(success);
    onError(null);
  } catch (err) {
    onError(err instanceof Error ? err.message : 'Operation failed.');
  }
}

function useLookups(): LookupsPayload {
  const [lookups, setLookups] = useState<LookupsPayload>(EMPTY_LOOKUPS);
  useEffect(() => {
    let mounted = true;
    apiFetch<LookupsPayload>('/hostel/lookups')
      .then((l) => {
        if (mounted) setLookups(l);
      })
      .catch(() => {
        if (mounted) setLookups(EMPTY_LOOKUPS);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return lookups;
}

function useSearchableUsers(): SearchableUser[] {
  const [users, setUsers] = useState<SearchableUser[]>([]);
  useEffect(() => {
    let mounted = true;
    apiFetch<SearchableUser[]>('/hostel/users')
      .then((rows) => {
        if (mounted) setUsers(rows);
      })
      .catch(() => {
        if (mounted) setUsers([]);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return users;
}

function useSearchableStudents(): SearchableStudent[] {
  const [students, setStudents] = useState<SearchableStudent[]>([]);
  useEffect(() => {
    let mounted = true;
    apiFetch<SearchableStudent[]>('/hostel/students')
      .then((rows) => {
        if (mounted) setStudents(rows);
      })
      .catch(() => {
        if (mounted) setStudents([]);
      });
    return () => {
      mounted = false;
    };
  }, []);
  return students;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.8rem', color: '#4b5563' }}>
      {label}
      {children}
    </label>
  );
}

const formRowStyle: React.CSSProperties = { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e5e7eb', color: '#6b7280' };
const tdStyle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'top' };

// ── Summary ─────────────────────────────────────────────────────────────────

function SummaryTab({ onError }: { onError: (m: string | null) => void }) {
  const [summary, setSummary] = useState<HostelSummary | null>(null);
  const [dues, setDues] = useState<DuesReport | null>(null);
  const [complaints, setComplaints] = useState<ComplaintsReport | null>(null);
  const lookups = useLookups();

  const load = useCallback(async () => {
    onError(null);
    try {
      const [s, d, c] = await Promise.all([
        apiFetch<HostelSummary>('/hostel/reports/summary'),
        apiFetch<DuesReport>('/hostel/reports/dues'),
        apiFetch<ComplaintsReport>('/hostel/reports/complaints'),
      ]);
      setSummary(s);
      setDues(d);
      setComplaints(c);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load hostel summary.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = summary?.totals;
  const campusName = (id: string) => lookups.campuses.find((c) => c.id === id)?.name ?? '—';
  const diff = (r: SummaryPerHostel) => (
    <td style={tdStyle}>
      {r.totalBeds - r.availableBeds}/{r.totalBeds}
      <span style={{ color: '#9ca3af' }}> ({r.occupancyRate}%)</span>
    </td>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem' }}>Hostel occupancy summary</h2>
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Hostel</th>
              <th style={thStyle}>Campus</th>
              <th style={thStyle}>Rooms</th>
              <th style={thStyle}>Occupied/Total (rate)</th>
              <th style={thStyle}>Active bookings</th>
              <th style={thStyle}>Open complaints</th>
              <th style={thStyle}>Visitors in</th>
            </tr>
          </thead>
          <tbody>
            {summary?.hostels.map((h) => (
              <tr key={h.hostelId}>
                <td style={tdStyle}>
                  {h.name} <span style={{ color: '#9ca3af' }}>({h.code})</span>
                </td>
                <td style={tdStyle}>{campusName(h.campusId)}</td>
                <td style={tdStyle}>{h.totalRooms}</td>
                {diff(h)}
                <td style={tdStyle}>{h.activeBookings}</td>
                <td style={tdStyle}>{h.openComplaints}</td>
                <td style={tdStyle}>{h.visitorsInside}</td>
              </tr>
            ))}
            {total && (
              <tr style={{ background: '#f9fafb', fontWeight: 600 }}>
                <td style={tdStyle}>All hostels</td>
                <td style={tdStyle}>—</td>
                <td style={tdStyle}>{total.totalRooms}</td>
                {diff(total)}
                <td style={tdStyle}>{total.activeBookings}</td>
                <td style={tdStyle}>{total.openComplaints}</td>
                <td style={tdStyle}>{total.visitorsInside}</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Open dues</h2>
        {dues && dues.data.length === 0 && <p style={{ color: '#9ca3af' }}>No open hostel dues.</p>}
        {dues && dues.data.length > 0 && (
          <>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Student</th>
                  <th style={thStyle}>Hostel</th>
                  <th style={thStyle}>Room · Bed</th>
                  <th style={thStyle}>Head</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Paid</th>
                  <th style={thStyle}>Due</th>
                </tr>
              </thead>
              <tbody>
                {dues.data.map((d) => (
                  <tr key={d.id}>
                    <td style={tdStyle}>{d.student.fullName}</td>
                    <td style={tdStyle}>{d.hostelBooking?.hostel?.name ?? '—'}</td>
                    <td style={tdStyle}>
                      {d.hostelBooking?.roomNumber ?? '—'}
                      {d.hostelBooking?.bedNumber ? ` · ${d.hostelBooking.bedNumber}` : ''}
                    </td>
                    <td style={tdStyle}>{d.headName}</td>
                    <td style={tdStyle}>{fmtCents(d.amountCents)}</td>
                    <td style={tdStyle}>{fmtCents(d.paidCents)}</td>
                    <td style={tdStyle}>{fmtCents(Math.max(0, d.amountCents - d.paidCents - d.waivedCents))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontWeight: 600 }}>Total open dues: {fmtCents(dues.totalDueCents)}</p>
          </>
        )}
      </Card>

      {complaints && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>
            Complaints <span style={{ color: '#9ca3af' }}>— {complaints.total} total</span>
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(['byStatus', 'byCategory', 'byPriority'] as const).map((key) => (
              <div key={key}>
                <span style={{ fontWeight: 600 }}>{key.slice(2)}: </span>
                {complaints[key].map((e) => (
                  <span key={e.status} style={{ marginRight: 10 }}>
                    {e.status} ({e.count})
                  </span>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Setup (hostels → buildings → floors → rooms → beds) ─────────────────────

function SetupTab({
  canCreate,
  canUpdate,
  canDelete,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const lookups = useLookups();
  const [hostels, setHostels] = useState<HostelRow[]>([]);

  const loadHostels = useCallback(async () => {
    onError(null);
    try {
      setHostels(await apiFetch<HostelRow[]>('/hostel/hostels?includeInactive=true'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load hostels.');
    }
  }, [onError]);

  useEffect(() => {
    void loadHostels();
  }, [loadHostels]);

  const onCreateHostel = async (dto: { campusId: string; code: string; name: string; genderType: string; chargeRentOnCheckIn: boolean }) => {
    await apiFetch('/hostel/hostels', { method: 'POST', body: JSON.stringify(dto) });
    await loadHostels();
  };
  const onUpdateHostel = async (id: string, dto: Record<string, unknown>) => {
    await apiFetch(`/hostel/hostels/${id}`, { method: 'PATCH', body: JSON.stringify(dto) });
    await loadHostels();
  };
  const onDeleteHostel = async (id: string) => {
    await apiFetch(`/hostel/hostels/${id}`, { method: 'DELETE' });
    await loadHostels();
  };
  const onBuildingsChanged = () => void loadHostels();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <HostelEditor
        lookups={lookups}
        hostels={hostels}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canDelete={canDelete}
        onCreate={onCreateHostel}
        onUpdate={onUpdateHostel}
        onDelete={onDeleteHostel}
        onError={onError}
        onNotice={onNotice}
      />
      <CascadeEditor lookups={lookups} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onChanged={onBuildingsChanged} onError={onError} onNotice={onNotice} />
    </div>
  );
}

function HostelEditor(props: {
  lookups: LookupsPayload;
  hostels: HostelRow[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onCreate: (dto: { campusId: string; code: string; name: string; genderType: string; chargeRentOnCheckIn: boolean }) => Promise<void>;
  onUpdate: (id: string, dto: Record<string, unknown>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [campusId, setCampusId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [genderType, setGenderType] = useState('COED');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editGender, setEditGender] = useState('COED');

  const submit = () => {
    if (!campusId || !code.trim() || !name.trim()) {
      props.onError('Campus, code and name are required.');
      return;
    }
    run(() => props.onCreate({ campusId, code: code.trim(), name: name.trim(), genderType, chargeRentOnCheckIn: true }), 'Hostel created.', props.onNotice, props.onError);
    setCode('');
    setName('');
  };

  const campusName = (id: string) => props.lookups.campuses.find((c) => c.id === id)?.name ?? '—';

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Hostels</h2>
      {props.canCreate && (
        <div style={formRowStyle}>
          <Field label="Campus">
            <select value={campusId} onChange={(e) => setCampusId(e.target.value)} style={selectStyle}>
              <option value="">Select campus…</option>
              {props.lookups.campuses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. ALPHA" style={{ minWidth: 120 }} />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hostel name" style={{ minWidth: 180 }} />
          </Field>
          <Field label="Gender">
            <select value={genderType} onChange={(e) => setGenderType(e.target.value)} style={selectStyle}>
              {props.lookups.genderTypes.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={submit}>Add hostel</Button>
        </div>
      )}
      <table style={{ ...tableStyle, marginTop: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Code</th>
            <th style={thStyle}>Campus</th>
            <th style={thStyle}>Gender</th>
            <th style={thStyle}>Buildings</th>
            <th style={thStyle}>Active</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {props.hostels.map((h) => (
            <tr key={h.id}>
              {editing === h.id ? (
                <>
                  <td style={tdStyle}>
                    <Input value={editName} onChange={(e) => setEditName(e.target.value)} style={{ minWidth: 160 }} />
                  </td>
                  <td style={tdStyle}>({h.code})</td>
                  <td style={tdStyle}>{campusName(h.campusId)}</td>
                  <td style={tdStyle}>
                    <select value={editGender} onChange={(e) => setEditGender(e.target.value)} style={selectStyle}>
                      {props.lookups.genderTypes.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={tdStyle}>{h._count?.buildings ?? 0}</td>
                  <td style={tdStyle}>
                    <select
                      value={h.isActive ? 'true' : 'false'}
                      onChange={(e) => {
                        const val = e.target.value === 'true';
                        void run(() => props.onUpdate(h.id, { isActive: val }), 'Hostel updated.', props.onNotice, props.onError);
                      }}
                      style={selectStyle}
                    >
                      <option value="true">Yes</option>
                      <option value="false">No</option>
                    </select>
                  </td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {props.canUpdate && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            if (editing === h.id) {
                              void run(() => props.onUpdate(h.id, { name: editName, genderType: editGender }), 'Hostel updated.', props.onNotice, props.onError);
                              setEditing(null);
                            } else {
                              setEditing(h.id);
                              setEditName(h.name);
                              setEditGender(h.genderType);
                            }
                          }}
                        >
                          {editing === h.id ? 'Save' : 'Edit'}
                        </Button>
                      )}
                      {props.canDelete && (
                        <Button variant="secondary" onClick={() => void run(() => props.onDelete(h.id), 'Hostel deleted.', props.onNotice, props.onError)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </>
              ) : (
                <>
                  <td style={tdStyle}>{h.name}</td>
                  <td style={tdStyle}>{h.code}</td>
                  <td style={tdStyle}>{campusName(h.campusId)}</td>
                  <td style={tdStyle}>{h.genderType}</td>
                  <td style={tdStyle}>{h._count?.buildings ?? 0}</td>
                  <td style={tdStyle}>{h.isActive ? 'Yes' : 'No'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {props.canUpdate && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setEditing(h.id);
                            setEditName(h.name);
                            setEditGender(h.genderType);
                          }}
                        >
                          Edit
                        </Button>
                      )}
                      {props.canDelete && (
                        <Button variant="secondary" onClick={() => void run(() => props.onDelete(h.id), 'Hostel deleted.', props.onNotice, props.onError)}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function CascadeEditor({
  lookups,
  canCreate,
  canUpdate,
  canDelete,
  onChanged,
  onError,
  onNotice,
}: {
  lookups: LookupsPayload;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [hostelId, setHostelId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [floorId, setFloorId] = useState('');
  const [roomId, setRoomId] = useState('');

  const hostels = lookups.hostels;

  const resetBuilding = () => {
    setBuildingId('');
    setFloorId('');
    setRoomId('');
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Infrastructure</h2>
      <div style={formRowStyle}>
        <Field label="Hostel">
          <select value={hostelId} onChange={(e) => { setHostelId(e.target.value); resetBuilding(); }} style={{ minWidth: 220, ...selectStyle }}>
            <option value="">All hostels</option>
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <BuildingEditor lookups={lookups} hostelId={hostelId} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onChanged={onChanged} onError={onError} onNotice={onNotice} />
      <FloorEditor lookups={lookups} buildingId={buildingId} setBuildingId={setBuildingId} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onChanged={onChanged} onError={onError} onNotice={onNotice} />
      <RoomEditor lookups={lookups} floorId={floorId} setFloorId={setFloorId} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onChanged={onChanged} onError={onError} onNotice={onNotice} />
      <BedEditor lookups={lookups} roomId={roomId} setRoomId={setRoomId} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onChanged={onChanged} onError={onError} onNotice={onNotice} />
    </Card>
  );
}

function BuildingEditor({
  lookups,
  hostelId,
  canCreate,
  canUpdate,
  canDelete,
  onChanged: _onChanged,
  onError,
  onNotice,
}: {
  lookups: LookupsPayload;
  hostelId: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [selHostelId, setSelHostelId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<BuildingRow[]>([]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const q = hostelId ? `?hostelId=${hostelId}` : '';
      setRows(await apiFetch<BuildingRow[]>(`/hostel/buildings${q}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load buildings.');
    }
  }, [hostelId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = () => {
    if (!selHostelId || !code.trim() || !name.trim()) {
      onError('Hostel, code and name are required.');
      return;
    }
    void run(
      () =>
        apiFetch('/hostel/buildings', {
          method: 'POST',
          body: JSON.stringify({ hostelId: selHostelId, code: code.trim(), name: name.trim() }),
        }).then(() => load()),
      'Building created.',
      onNotice,
      onError,
    );
    setCode('');
    setName('');
  };

  return (
    <div style={{ marginTop: 8 }}>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Buildings</h3>
      {canCreate && (
        <div style={formRowStyle}>
          <Field label="Hostel">
            <select value={selHostelId} onChange={(e) => setSelHostelId(e.target.value)} style={{ minWidth: 200, ...selectStyle }}>
              <option value="">Select hostel…</option>
              {lookups.hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Code">
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. BLK-A" style={{ minWidth: 120 }} />
          </Field>
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Building name" style={{ minWidth: 160 }} />
          </Field>
          <Button onClick={submit}>Add building</Button>
        </div>
      )}
      <table style={{ ...tableStyle, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Code</th>
            <th style={thStyle}>Hostel</th>
            <th style={thStyle}>Floors</th>
            <th style={thStyle}>Active</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td style={tdStyle}>{b.name}</td>
              <td style={tdStyle}>{b.code}</td>
              <td style={tdStyle}>{b.hostel?.name ?? '—'}</td>
              <td style={tdStyle}>{b._count?.floors ?? 0}</td>
              <td style={tdStyle}>
                <select
                  value={b.isActive ? 'true' : 'false'}
                  onChange={(e) => {
                    const val = e.target.value === 'true';
                    void run(() => apiFetch(`/hostel/buildings/${b.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: val }) }).then(() => load()), 'Building updated.', onNotice, onError);
                  }}
                  style={selectStyle}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </td>
              <td style={tdStyle}>
                {canUpdate && (
                  <Button variant="secondary" onClick={() => void run(load, 'Reloaded.', onNotice, onError)}>
                    Refresh
                  </Button>
                )}
                {canDelete && (
                  <Button variant="secondary" onClick={() => void run(() => apiFetch(`/hostel/buildings/${b.id}`, { method: 'DELETE' }).then(() => load()), 'Building deleted.', onNotice, onError)}>
                    Delete
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FloorEditor({
  lookups,
  buildingId,
  setBuildingId,
  canCreate,
  canUpdate: _canUpdate,
  canDelete,
  onChanged: _onChanged,
  onError,
  onNotice,
}: {
  lookups: LookupsPayload;
  buildingId: string;
  setBuildingId: (id: string) => void;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [selBuildingId, setSelBuildingId] = useState('');
  const [floorNumber, setFloorNumber] = useState('');
  const [name, setName] = useState('');
  const [rows, setRows] = useState<FloorRow[]>([]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const q = buildingId ? `?buildingId=${buildingId}` : '';
      setRows(await apiFetch<FloorRow[]>(`/hostel/floors${q}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load floors.');
    }
  }, [buildingId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = () => {
    const num = parseInt(floorNumber, 10);
    if (!selBuildingId || !Number.isFinite(num)) {
      onError('Building and a numeric floor number are required.');
      return;
    }
    void run(
      () =>
        apiFetch('/hostel/floors', {
          method: 'POST',
          body: JSON.stringify({ buildingId: selBuildingId, floorNumber: num, name: name.trim() || undefined }),
        }).then(() => load()),
      'Floor created.',
      onNotice,
      onError,
    );
    setFloorNumber('');
    setName('');
  };

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Floors</h3>
      <div style={formRowStyle}>
        <Field label="Show building">
          <select value={buildingId} onChange={(e) => setBuildingId(e.target.value)} style={{ minWidth: 200, ...selectStyle }}>
            <option value="">All buildings</option>
            {lookups.buildings.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </Field>
        {canCreate && (
          <>
            <Field label="Building">
              <select value={selBuildingId} onChange={(e) => setSelBuildingId(e.target.value)} style={{ minWidth: 180, ...selectStyle }}>
                <option value="">Select building…</option>
                {lookups.buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Floor number">
              <Input value={floorNumber} onChange={(e) => setFloorNumber(e.target.value)} placeholder="e.g. 1" style={{ minWidth: 80 }} />
            </Field>
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ground" style={{ minWidth: 140 }} />
            </Field>
            <Button onClick={submit}>Add floor</Button>
          </>
        )}
      </div>
      <table style={{ ...tableStyle, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Floor</th>
            <th style={thStyle}>Building</th>
            <th style={thStyle}>Rooms</th>
            <th style={thStyle}>Active</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((f) => (
            <tr key={f.id}>
              <td style={tdStyle}>
                {f.name ?? `Floor ${f.floorNumber}`} <span style={{ color: '#9ca3af' }}>({f.floorNumber})</span>
              </td>
              <td style={tdStyle}>{f.building?.name ?? '—'}</td>
              <td style={tdStyle}>{f._count?.rooms ?? 0}</td>
              <td style={tdStyle}>
                <select
                  value={f.isActive ? 'true' : 'false'}
                  onChange={(e) => {
                    const val = e.target.value === 'true';
                    void run(() => apiFetch(`/hostel/floors/${f.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: val }) }).then(() => load()), 'Floor updated.', onNotice, onError);
                  }}
                  style={selectStyle}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </td>
              <td style={tdStyle}>
                {canDelete && (
                  <Button variant="secondary" onClick={() => void run(() => apiFetch(`/hostel/floors/${f.id}`, { method: 'DELETE' }).then(() => load()), 'Floor deleted.', onNotice, onError)}>
                    Delete
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoomEditor({
  lookups,
  floorId,
  setFloorId,
  canCreate,
  canUpdate: _canUpdate,
  canDelete,
  onChanged: _onChanged,
  onError,
  onNotice,
}: {
  lookups: LookupsPayload;
  floorId: string;
  setFloorId: (id: string) => void;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [selFloorId, setSelFloorId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [sharing, setSharing] = useState('SINGLE');
  const [cape, setCape] = useState('1');
  const [rent, setRent] = useState('');
  const [rows, setRows] = useState<RoomRow[]>([]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const q = floorId ? `?floorId=${floorId}` : '';
      setRows(await apiFetch<RoomRow[]>(`/hostel/rooms${q}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load rooms.');
    }
  }, [floorId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = () => {
    if (!selFloorId || !code.trim()) {
      onError('Floor and room code are required.');
      return;
    }
    void run(
      () =>
        apiFetch('/hostel/rooms', {
          method: 'POST',
          body: JSON.stringify({
            floorId: selFloorId,
            code: code.trim(),
            name: name.trim() || undefined,
            sharing,
            bedCapacity: parseInt(cape, 10) || 0,
            monthlyRentCents: rupeeToCents(rent),
          }),
        }).then(() => load()),
      'Room created.',
      onNotice,
      onError,
    );
    setCode('');
    setName('');
    setRent('');
  };

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Rooms</h3>
      <div style={formRowStyle}>
        <Field label="Show floor">
          <select value={floorId} onChange={(e) => setFloorId(e.target.value)} style={{ minWidth: 200, ...selectStyle }}>
            <option value="">All floors</option>
            {lookups.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name ?? `Floor ${f.floorNumber}`}
              </option>
            ))}
          </select>
        </Field>
        {canCreate && (
          <>
            <Field label="Floor">
              <select value={selFloorId} onChange={(e) => setSelFloorId(e.target.value)} style={{ minWidth: 160, ...selectStyle }}>
                <option value="">Select floor…</option>
                {lookups.floors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name ?? `Floor ${f.floorNumber}`}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Code">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 201" style={{ minWidth: 90 }} />
            </Field>
            <Field label="Sharing">
              <select value={sharing} onChange={(e) => setSharing(e.target.value)} style={selectStyle}>
                {lookups.roomSharing.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Capacity">
              <Input value={cape} onChange={(e) => setCape(e.target.value)} style={{ minWidth: 60 }} />
            </Field>
            <Field label="Monthly rent ₹">
              <Input value={rent} onChange={(e) => setRent(e.target.value)} style={{ minWidth: 90 }} />
            </Field>
            <Button onClick={submit}>Add room</Button>
          </>
        )}
      </div>
      <table style={{ ...tableStyle, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Room</th>
            <th style={thStyle}>Floor · Building</th>
            <th style={thStyle}>Sharing</th>
            <th style={thStyle}>Beds</th>
            <th style={thStyle}>Rent</th>
            <th style={thStyle}>Active</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td style={tdStyle}>{r.name ?? r.code}</td>
              <td style={tdStyle}>
                Floor {r.floor?.floorNumber} · {r.floor?.building?.name}
              </td>
              <td style={tdStyle}>{r.sharing}</td>
              <td style={tdStyle}>{r._count?.beds ?? 0}</td>
              <td style={tdStyle}>{fmtCents(r.monthlyRentCents)}</td>
              <td style={tdStyle}>
                <select
                  value={r.isActive ? 'true' : 'false'}
                  onChange={(e) => {
                    const val = e.target.value === 'true';
                    void run(() => apiFetch(`/hostel/rooms/${r.id}`, { method: 'PATCH', body: JSON.stringify({ isActive: val }) }).then(() => load()), 'Room updated.', onNotice, onError);
                  }}
                  style={selectStyle}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              </td>
              <td style={tdStyle}>
                {canDelete && (
                  <Button variant="secondary" onClick={() => void run(() => apiFetch(`/hostel/rooms/${r.id}`, { method: 'DELETE' }).then(() => load()), 'Room deleted.', onNotice, onError)}>
                    Delete
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BedEditor({
  lookups,
  roomId,
  setRoomId,
  canCreate,
  canUpdate: _canUpdate,
  canDelete,
  onChanged: _onChanged,
  onError,
  onNotice,
}: {
  lookups: LookupsPayload;
  roomId: string;
  setRoomId: (id: string) => void;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onChanged: () => void;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const [selRoomId, setSelRoomId] = useState('');
  const [codes, setCodes] = useState('');
  const [count, setCount] = useState('');
  const [rent, setRent] = useState('');
  const [status, setStatus] = useState('AVAILABLE');
  const [rows, setRows] = useState<BedRow[]>([]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const q = roomId ? `?roomId=${roomId}` : '';
      setRows(await apiFetch<BedRow[]>(`/hostel/beds${q}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load beds.');
    }
  }, [roomId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = () => {
    if (!selRoomId) {
      onError('A room is required to add beds.');
      return;
    }
    const parsedCodes = codes
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedCount = parseInt(count, 10);
    if (parsedCodes.length === 0 && !Number.isFinite(parsedCount)) {
      onError('Provide bed codes (comma separated) or a count.');
      return;
    }
    void run(
      () =>
        apiFetch(`/hostel/rooms/${selRoomId}/beds`, {
          method: 'POST',
          body: JSON.stringify({
            ...(parsedCodes.length ? { codes: parsedCodes } : {}),
            ...(Number.isFinite(parsedCount) ? { count: parsedCount } : {}),
            ...(rent ? { monthlyRentCents: rupeeToCents(rent) } : {}),
            ...(status !== 'AVAILABLE' ? { status } : {}),
          }),
        }).then(() => load()),
      'Beds added.',
      onNotice,
      onError,
    );
    setCodes('');
    setCount('');
    setRent('');
  };

  const setBedStatus = (id: string, next: string) => {
    void run(
      () => apiFetch(`/hostel/beds/${id}/status`, { method: 'POST', body: JSON.stringify({ status: next }) }).then(() => load()),
      'Bed status updated.',
      onNotice,
      onError,
    );
  };

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid #f3f4f6', paddingTop: 8 }}>
      <h3 style={{ fontSize: '0.9rem', marginBottom: 8 }}>Beds</h3>
      <div style={formRowStyle}>
        <Field label="Show room">
          <select value={roomId} onChange={(e) => setRoomId(e.target.value)} style={{ minWidth: 200, ...selectStyle }}>
            <option value="">All rooms</option>
            {lookups.rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code}
              </option>
            ))}
          </select>
        </Field>
        {canCreate && (
          <>
            <Field label="Room">
              <select value={selRoomId} onChange={(e) => setSelRoomId(e.target.value)} style={{ minWidth: 160, ...selectStyle }}>
                <option value="">Select room…</option>
                {lookups.rooms.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Codes">
              <Input value={codes} onChange={(e) => setCodes(e.target.value)} placeholder="B1, B2, B3" style={{ minWidth: 150 }} />
            </Field>
            <Field label="Count">
              <Input value={count} onChange={(e) => setCount(e.target.value)} placeholder="e.g. 4" style={{ minWidth: 60 }} />
            </Field>
            <Field label="Rent ₹/mo">
              <Input value={rent} onChange={(e) => setRent(e.target.value)} style={{ minWidth: 80 }} />
            </Field>
            <Field label="Status">
              <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
                {lookups.bedStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <Button onClick={submit}>Add beds</Button>
          </>
        )}
      </div>
      <table style={{ ...tableStyle, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>Bed</th>
            <th style={thStyle}>Room · Floor</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Rent</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id}>
              <td style={tdStyle}>{b.code}</td>
              <td style={tdStyle}>
                {b.room?.code} · Floor {b.room?.floor?.floorNumber}
              </td>
              <td style={tdStyle}>
                <select value={b.status} onChange={(e) => setBedStatus(b.id, e.target.value)} style={selectStyle}>
                  {lookups.bedStatuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>{fmtCents(b.monthlyRentCents)}</td>
              <td style={tdStyle}>
                {canDelete && (
                  <Button variant="secondary" onClick={() => void run(() => apiFetch(`/hostel/beds/${b.id}`, { method: 'DELETE' }).then(() => load()), 'Bed removed.', onNotice, onError)}>
                    Remove
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Wardens ─────────────────────────────────────────────────────────────────

function WardensTab({
  canCreate,
  canUpdate,
  canDelete,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const lookups = useLookups();
  const users = useSearchableUsers();
  const [rows, setRows] = useState<HostelWardenRow[]>([]);
  const [hostelId, setHostelId] = useState('');
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState('WARDEN');

  const load = useCallback(async () => {
    onError(null);
    try {
      setRows(await apiFetch<HostelWardenRow[]>('/hostel/wardens'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load wardens.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const assign = () => {
    if (!hostelId || !userId) {
      onError('Hostel and user are required.');
      return;
    }
    void run(() => apiFetch('/hostel/wardens', { method: 'POST', body: JSON.stringify({ hostelId, userId, role }) }).then(() => load()), 'Warden assigned.', onNotice, onError);
    setUserId('');
  };

  const userLabel = (id: string) => users.find((u) => u.id === id)?.fullName ?? id;

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Wardens</h2>
      {canCreate && users.length > 0 && (
        <div style={formRowStyle}>
          <Field label="Hostel">
            <select value={hostelId} onChange={(e) => setHostelId(e.target.value)} style={{ minWidth: 200, ...selectStyle }}>
              <option value="">Select hostel…</option>
              {lookups.hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="User">
            <select value={userId} onChange={(e) => setUserId(e.target.value)} style={{ minWidth: 200, ...selectStyle }}>
              <option value="">Select user…</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.email})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Role">
            <select value={role} onChange={(e) => setRole(e.target.value)} style={selectStyle}>
              {lookups.wardenRoles.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={assign}>Assign</Button>
        </div>
      )}
      <table style={{ ...tableStyle, marginTop: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Warden</th>
            <th style={thStyle}>Hostel</th>
            <th style={thStyle}>Role</th>
            <th style={thStyle}>Active</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id}>
              <td style={tdStyle}>{userLabel(w.userId)}</td>
              <td style={tdStyle}>{w.hostel.name}</td>
              <td style={tdStyle}>
                {canUpdate ? (
                  <select
                    value={w.role}
                    onChange={(e) => void run(() => apiFetch(`/hostel/wardens/${w.id}`, { method: 'PATCH', body: JSON.stringify({ role: e.target.value }) }).then(load), 'Warden updated.', onNotice, onError)}
                    style={selectStyle}
                  >
                    {lookups.wardenRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                ) : (
                  w.role
                )}
              </td>
              <td style={tdStyle}>{w.isActive ? 'Yes' : 'No'}</td>
              <td style={tdStyle}>
                {canDelete && (
                  <Button
                    variant="secondary"
                    onClick={() => void run(() => apiFetch(`/hostel/wardens/${w.id}`, { method: 'DELETE' }).then(load), 'Warden removed.', onNotice, onError)}
                  >
                    Remove
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Bookings ────────────────────────────────────────────────────────────────

function BookingsTab({
  canCreate,
  canUpdate: _canUpdate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const lookups = useLookups();
  const students = useSearchableStudents();
  const [rows, setRows] = useState<Paged<BookingRow>>({ data: [], total: 0 });
  const [hostelFilter, setHostelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [skip, setSkip] = useState(0);
  const [studentId, setStudentId] = useState('');
  const [bedId, setBedId] = useState('');
  const [createStatus, setCreateStatus] = useState('REQUESTED');
  const [rent, setRent] = useState('');

  const load = useCallback(async () => {
    onError(null);
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (hostelFilter) params.set('hostelId', hostelFilter);
      if (statusFilter) params.set('status', statusFilter);
      setRows(await apiFetch<Paged<BookingRow>>(`/hostel/bookings?${params.toString()}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load bookings.');
    }
  }, [hostelFilter, statusFilter, skip, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = () => {
    if (!studentId || !bedId) {
      onError('Student and bed are required.');
      return;
    }
    void run(
      () =>
        apiFetch('/hostel/bookings', {
          method: 'POST',
          body: JSON.stringify({
            studentId,
            bedId,
            status: createStatus,
            ...(rent ? { monthlyRentCents: rupeeToCents(rent) } : {}),
          }),
        }).then(() => load()),
      'Booking created.',
      onNotice,
      onError,
    );
    setStudentId('');
    setBedId('');
    setRent('');
  };

  const action = (method: string, path: string, body: Record<string, unknown>, success: string, id: string) => {
    void run(
      () =>
        apiFetch(path, {
          method,
          body: JSON.stringify(body),
        }).then(() => load()),
      success,
      onNotice,
      onError,
    );
    void id;
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Bookings</h2>
      {canCreate && students.length > 0 && (
        <div style={formRowStyle}>
          <Field label="Student">
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ minWidth: 220, ...selectStyle }}>
              <option value="">Select student…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({s.admissionNumber})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Bed">
            <select value={bedId} onChange={(e) => setBedId(e.target.value)} style={{ minWidth: 220, ...selectStyle }}>
              <option value="">Select bed…</option>
              {lookups.beds.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.code} — {b.name} ({b.status})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Start status">
            <select value={createStatus} onChange={(e) => setCreateStatus(e.target.value)} style={selectStyle}>
              {lookups.bookingStatuses.slice(0, 3).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Rent ₹/mo">
            <Input value={rent} onChange={(e) => setRent(e.target.value)} style={{ minWidth: 80 }} />
          </Field>
          <Button onClick={create}>Create booking</Button>
        </div>
      )}
      <div style={{ ...formRowStyle, marginTop: 12 }}>
        <Field label="Hostel">
          <select value={hostelFilter} onChange={(e) => { setHostelFilter(e.target.value); setSkip(0); }} style={{ minWidth: 200, ...selectStyle }}>
            <option value="">All hostels</option>
            {lookups.hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }} style={selectStyle}>
            <option value="">All statuses</option>
            {lookups.bookingStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <table style={{ ...tableStyle, marginTop: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Student</th>
            <th style={thStyle}>Hostel · Room · Bed</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Allocation</th>
            <th style={thStyle}>Check-in</th>
            <th style={thStyle}>Rent</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.data.map((b) => (
            <tr key={b.id}>
              <td style={tdStyle}>
                {b.student.fullName}
                <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                  {b.student.admissionNumber} · {b.student.program?.code}
                </div>
              </td>
              <td style={tdStyle}>
                {b.hostel?.name ?? b.hostelName}
                <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                  {b.roomNumber}
                  {b.bedNumber ? ` · ${b.bedNumber}` : ''}
                </div>
              </td>
              <td style={tdStyle}>{b.status}</td>
              <td style={tdStyle}>{fmtDate(b.allocationDate)}</td>
              <td style={tdStyle}>{fmtDate(b.checkInDate)}</td>
              <td style={tdStyle}>{fmtCents(b.monthlyRentCents)}</td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {canManage && b.status === 'REQUESTED' && (
                    <Button variant="secondary" onClick={() => action('POST', `/hostel/bookings/${b.id}/allocate`, {}, 'Booking allocated.', b.id)}>
                      Allocate
                    </Button>
                  )}
                  {canManage && (b.status === 'ALLOCATED' || b.status === 'REQUESTED') && (
                    <Button variant="secondary" onClick={() => action('POST', `/hostel/bookings/${b.id}/check-in`, { chargeFirstMonth: true }, 'Checked in.', b.id)}>
                      Check in
                    </Button>
                  )}
                  {canManage && (b.status === 'CHECKED_IN' || b.status === 'ALLOCATED') && (
                    <Button variant="secondary" onClick={() => action('POST', `/hostel/bookings/${b.id}/check-out`, {}, 'Checked out.', b.id)}>
                      Check out
                    </Button>
                  )}
                  {canManage && (b.status === 'ALLOCATED' || b.status === 'CHECKED_IN') && (
                    <Button variant="secondary" onClick={() => action('POST', `/hostel/bookings/${b.id}/cancel`, {}, 'Booking cancelled.', b.id)}>
                      Cancel
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 50))}>
          Prev
        </Button>
        <Button variant="secondary" disabled={skip + 50 >= rows.total} onClick={() => setSkip((s) => s + 50)}>
          Next
        </Button>
        <span style={{ color: '#9ca3af' }}>{rows.total} rows</span>
      </div>
    </Card>
  );
}

// ── Charges ─────────────────────────────────────────────────────────────────

function ChargesTab({
  canCreate,
  canUpdate,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const lookups = useLookups();
  const [rows, setRows] = useState<Paged<ChargeRow>>({ data: [], total: 0 });
  const [hostelFilter, setHostelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [skip, setSkip] = useState(0);
  const [bookingId, setBookingId] = useState('');
  const [monthCount, setMonthCount] = useState('1');
  const [amountRent, setAmountRent] = useState('');
  const [periodStart, setPeriodStart] = useState('');

  const load = useCallback(async () => {
    onError(null);
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (hostelFilter) params.set('hostelId', hostelFilter);
      if (statusFilter) params.set('status', statusFilter);
      setRows(await apiFetch<Paged<ChargeRow>>(`/hostel/charges?${params.toString()}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load charges.');
    }
  }, [hostelFilter, statusFilter, skip, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const [activeBookings, setActiveBookings] = useState<BookingRow[]>([]);
  const loadBookings = useCallback(async () => {
    try {
      const res = await apiFetch<Paged<BookingRow>>('/hostel/bookings?status=CHECKED_IN&take=200');
      setActiveBookings(res.data);
    } catch {
      setActiveBookings([]);
    }
  }, []);
  useEffect(() => {
    void loadBookings();
  }, [loadBookings]);

  const create = () => {
    if (!bookingId) {
      onError('A booking is required to create a rent charge.');
      return;
    }
    void run(
      () =>
        apiFetch(`/hostel/bookings/${bookingId}/charge`, {
          method: 'POST',
          body: JSON.stringify({
            monthCount: parseInt(monthCount, 10) || 1,
            ...(amountRent ? { amountCents: rupeeToCents(amountRent) } : {}),
            ...(periodStart ? { periodStart } : {}),
          }),
        }).then(() => load()),
      'Rent charge created.',
      onNotice,
      onError,
    );
    setBookingId('');
    setAmountRent('');
  };

  const waive = (id: string) => {
    void run(
      () => apiFetch(`/hostel/charges/${id}/waive`, { method: 'PATCH', body: JSON.stringify({ reason: 'Waived' }) }).then(() => load()),
      'Charge waived.',
      onNotice,
      onError,
    );
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Rent charges</h2>
      {canCreate && activeBookings.length > 0 && (
        <div style={formRowStyle}>
          <Field label="Booking">
            <select value={bookingId} onChange={(e) => setBookingId(e.target.value)} style={{ minWidth: 260, ...selectStyle }}>
              <option value="">Select checked-in booking…</option>
              {activeBookings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.student.fullName} — {b.roomNumber} ({b.monthlyRentCents != null ? fmtCents(b.monthlyRentCents) + '/mo' : 'no rent'})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Months">
            <Input value={monthCount} onChange={(e) => setMonthCount(e.target.value)} style={{ minWidth: 60 }} />
          </Field>
          <Field label="Override amount ₹">
            <Input value={amountRent} onChange={(e) => setAmountRent(e.target.value)} style={{ minWidth: 90 }} />
          </Field>
          <Field label="Period start">
            <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} style={{ minWidth: 140 }} />
          </Field>
          <Button onClick={create}>Create charge</Button>
        </div>
      )}
      <div style={{ ...formRowStyle, marginTop: 12 }}>
        <Field label="Hostel">
          <select value={hostelFilter} onChange={(e) => { setHostelFilter(e.target.value); setSkip(0); }} style={{ minWidth: 200, ...selectStyle }}>
            <option value="">All hostels</option>
            {lookups.hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }} style={selectStyle}>
            <option value="">All statuses</option>
            {lookups.feeStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <table style={{ ...tableStyle, marginTop: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Student</th>
            <th style={thStyle}>Hostel · Room</th>
            <th style={thStyle}>Head</th>
            <th style={thStyle}>Amount</th>
            <th style={thStyle}>Paid</th>
            <th style={thStyle}>Due</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {rows.data.map((c) => (
            <tr key={c.id}>
              <td style={tdStyle}>{c.student.fullName}</td>
              <td style={tdStyle}>
                {c.hostelBooking?.hostel?.name ?? '—'}
                <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{c.hostelBooking?.roomNumber ?? ''}</div>
              </td>
              <td style={tdStyle}>{c.headName}</td>
              <td style={tdStyle}>{fmtCents(c.amountCents)}</td>
              <td style={tdStyle}>{fmtCents(c.paidCents)}</td>
              <td style={tdStyle}>{fmtCents(Math.max(0, c.amountCents - c.paidCents - c.waivedCents))}</td>
              <td style={tdStyle}>{c.status}</td>
              <td style={tdStyle}>
                {canUpdate && c.status !== 'WAIVED' && c.status !== 'PAID' && (
                  <Button variant="secondary" onClick={() => waive(c.id)}>
                    Waive
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 50))}>
          Prev
        </Button>
        <Button variant="secondary" disabled={skip + 50 >= rows.total} onClick={() => setSkip((s) => s + 50)}>
          Next
        </Button>
        <span style={{ color: '#9ca3af' }}>{rows.total} rows</span>
      </div>
    </Card>
  );
}

// ── Complaints ──────────────────────────────────────────────────────────────

function ComplaintsTab({
  canCreate,
  canUpdate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canManage: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const lookups = useLookups();
  const users = useSearchableUsers();
  const [rows, setRows] = useState<Paged<ComplaintRow>>({ data: [], total: 0 });
  const [hostelFilter, setHostelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [skip, setSkip] = useState(0);

  const [hostelId, setHostelId] = useState('');
  const [category, setCategory] = useState('MAINTENANCE');
  const [priority, setPriority] = useState('MEDIUM');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    onError(null);
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (hostelFilter) params.set('hostelId', hostelFilter);
      if (statusFilter) params.set('status', statusFilter);
      setRows(await apiFetch<Paged<ComplaintRow>>(`/hostel/complaints?${params.toString()}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load complaints.');
    }
  }, [hostelFilter, statusFilter, skip, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = () => {
    if (!hostelId || !subject.trim() || !description.trim()) {
      onError('Hostel, subject and description are required.');
      return;
    }
    void run(
      () =>
        apiFetch('/hostel/complaints', {
          method: 'POST',
          body: JSON.stringify({ hostelId, category, priority, subject: subject.trim(), description: description.trim() }),
        }).then(() => load()),
      'Complaint logged.',
      onNotice,
      onError,
    );
    setSubject('');
    setDescription('');
  };

  const update = (id: string, body: Record<string, unknown>, success: string) => {
    // updates via generic patch path (category/priority/subject/description) use the same route
    void run(() => apiFetch(`/hostel/complaints/${id}`, { method: 'PATCH', body: JSON.stringify(body) }).then(load), success, onNotice, onError);
  };
  const manage = (path: string, body: Record<string, unknown>, success: string) => {
    void run(() => apiFetch(path, { method: 'POST', body: JSON.stringify(body) }).then(load), success, onNotice, onError);
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Complaints</h2>
      {canCreate && (
        <div style={formRowStyle}>
          <Field label="Hostel">
            <select value={hostelId} onChange={(e) => setHostelId(e.target.value)} style={{ minWidth: 200, ...selectStyle }}>
              <option value="">Select hostel…</option>
              {lookups.hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Category">
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={selectStyle}>
              {lookups.complaintCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={selectStyle}>
              {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject">
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} style={{ minWidth: 180 }} />
          </Field>
          <Field label="Description">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} style={{ minWidth: 220 }} />
          </Field>
          <Button onClick={create}>Log complaint</Button>
        </div>
      )}
      <div style={{ ...formRowStyle, marginTop: 12 }}>
        <Field label="Hostel">
          <select value={hostelFilter} onChange={(e) => { setHostelFilter(e.target.value); setSkip(0); }} style={{ minWidth: 200, ...selectStyle }}>
            <option value="">All hostels</option>
            {lookups.hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }} style={selectStyle}>
            <option value="">All statuses</option>
            {lookups.complaintStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <table style={{ ...tableStyle, marginTop: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Subject</th>
            <th style={thStyle}>Hostel</th>
            <th style={thStyle}>Category</th>
            <th style={thStyle}>Priority</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.data.map((c) => (
            <tr key={c.id}>
              <td style={tdStyle}>
                {c.subject}
                <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{c.student?.fullName ?? 'Anonymous'}</div>
              </td>
              <td style={tdStyle}>{c.hostel.name}</td>
              <td style={tdStyle}>{c.category}</td>
              <td style={tdStyle}>{c.priority}</td>
              <td style={tdStyle}>{c.status}</td>
              <td style={tdStyle}>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {canUpdate && (c.status === 'OPEN' || c.status === 'IN_PROGRESS') && (
                    <Button variant="secondary" onClick={() => update(c.id, { priority: c.priority }, 'Saved.')}>
                      Priority ⤴
                    </Button>
                  )}
                  {canUpdate && (c.status === 'OPEN' || c.status === 'IN_PROGRESS') && (
                    <Button variant="secondary" onClick={() => update(c.id, { category: c.category }, 'Saved.')}>
                      Category ⤴
                    </Button>
                  )}
                  {canManage && c.status === 'OPEN' && users.length > 0 && users[0] && (
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const assignee = users[0];
                        if (assignee) manage(`/hostel/complaints/${c.id}/assign`, { assignedToUserId: assignee.id }, 'Assigned.');
                      }}
                    >
                      Assign
                    </Button>
                  )}
                  {canManage && (c.status === 'OPEN' || c.status === 'IN_PROGRESS') && (
                    <Button variant="secondary" onClick={() => manage(`/hostel/complaints/${c.id}/resolve`, { resolutionNotes: undefined }, 'Resolved.')}>
                      Resolve
                    </Button>
                  )}
                  {canManage && (c.status === 'OPEN' || c.status === 'IN_PROGRESS' || c.status === 'RESOLVED') && (
                    <Button variant="secondary" onClick={() => manage(`/hostel/complaints/${c.id}/close`, {}, 'Closed.')}>
                      Close
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 50))}>
          Prev
        </Button>
        <Button variant="secondary" disabled={skip + 50 >= rows.total} onClick={() => setSkip((s) => s + 50)}>
          Next
        </Button>
        <span style={{ color: '#9ca3af' }}>{rows.total} rows</span>
      </div>
    </Card>
  );
}

// ── Visitors ────────────────────────────────────────────────────────────────

function VisitorsTab({
  canCreate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canManage: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const lookups = useLookups();
  const [rows, setRows] = useState<Paged<VisitorRow>>({ data: [], total: 0 });
  const [hostelFilter, setHostelFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [skip, setSkip] = useState(0);

  const [hostelId, setHostelId] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [phone, setPhone] = useState('');
  const [purpose, setPurpose] = useState('');
  const [visitorLabel, setVisitorLabel] = useState('');

  const load = useCallback(async () => {
    onError(null);
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (hostelFilter) params.set('hostelId', hostelFilter);
      if (statusFilter) params.set('status', statusFilter);
      setRows(await apiFetch<Paged<VisitorRow>>(`/hostel/visitors?${params.toString()}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load visitors.');
    }
  }, [hostelFilter, statusFilter, skip, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = () => {
    if (!hostelId || !visitorName.trim()) {
      onError('Hostel and visitor name are required.');
      return;
    }
    void run(
      () =>
        apiFetch('/hostel/visitors', {
          method: 'POST',
          body: JSON.stringify({
            hostelId,
            visitorName: visitorName.trim(),
            ...(phone ? { phone } : {}),
            ...(purpose ? { purpose } : {}),
            ...(visitorLabel ? { visitorLabel } : {}),
          }),
        }).then(() => load()),
      'Visitor checked in.',
      onNotice,
      onError,
    );
    setVisitorName('');
    setPhone('');
    setPurpose('');
  };

  const checkout = (id: string) => {
    void run(() => apiFetch(`/hostel/visitors/${id}/checkout`, { method: 'POST', body: JSON.stringify({}) }).then(load), 'Visitor checked out.', onNotice, onError);
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Visitor logbook</h2>
      {canCreate && (
        <div style={formRowStyle}>
          <Field label="Hostel">
            <select value={hostelId} onChange={(e) => setHostelId(e.target.value)} style={{ minWidth: 200, ...selectStyle }}>
              <option value="">Select hostel…</option>
              {lookups.hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Visitor name">
            <Input value={visitorName} onChange={(e) => setVisitorName(e.target.value)} style={{ minWidth: 160 }} />
          </Field>
          <Field label="Phone">
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} style={{ minWidth: 120 }} />
          </Field>
          <Field label="Purpose">
            <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} style={{ minWidth: 140 }} />
          </Field>
          <Field label="Visiting (free text)">
            <Input value={visitorLabel} onChange={(e) => setVisitorLabel(e.target.value)} placeholder="e.g. Room 204" style={{ minWidth: 140 }} />
          </Field>
          <Button onClick={create}>Check in</Button>
        </div>
      )}
      <div style={{ ...formRowStyle, marginTop: 12 }}>
        <Field label="Hostel">
          <select value={hostelFilter} onChange={(e) => { setHostelFilter(e.target.value); setSkip(0); }} style={{ minWidth: 200, ...selectStyle }}>
            <option value="">All hostels</option>
            {lookups.hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Status">
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setSkip(0); }} style={selectStyle}>
            <option value="">All statuses</option>
            {lookups.visitorStatuses.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <table style={{ ...tableStyle, marginTop: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}>Visitor</th>
            <th style={thStyle}>Hostel</th>
            <th style={thStyle}>Visiting</th>
            <th style={thStyle}>Purpose</th>
            <th style={thStyle}>Checked in</th>
            <th style={thStyle}>Status</th>
            <th style={thStyle} />
          </tr>
        </thead>
        <tbody>
          {rows.data.map((v) => (
            <tr key={v.id}>
              <td style={tdStyle}>{v.visitorName}</td>
              <td style={tdStyle}>{v.hostel.name}</td>
              <td style={tdStyle}>{v.student?.fullName ?? v.visitorLabel ?? '—'}</td>
              <td style={tdStyle}>{v.purpose ?? '—'}</td>
              <td style={tdStyle}>{fmtDate(v.checkInAt)}</td>
              <td style={tdStyle}>{v.status}</td>
              <td style={tdStyle}>
                {canManage && v.status === 'INSIDE' && (
                  <Button variant="secondary" onClick={() => checkout(v.id)}>
                    Check out
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <Button variant="secondary" disabled={skip === 0} onClick={() => setSkip((s) => Math.max(0, s - 50))}>
          Prev
        </Button>
        <Button variant="secondary" disabled={skip + 50 >= rows.total} onClick={() => setSkip((s) => s + 50)}>
          Next
        </Button>
        <span style={{ color: '#9ca3af' }}>{rows.total} rows</span>
      </div>
    </Card>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────

function ReportsTab({ onError }: { onError: (m: string | null) => void }) {
  const lookups = useLookups();
  const [hostelId, setHostelId] = useState('');
  const [occupancy, setOccupancy] = useState<OccupancyReport | null>(null);
  const [vacancy, setVacancy] = useState<VacancyReport | null>(null);
  const students = useSearchableStudents();
  const [studentId, setStudentId] = useState('');
  const [history, setHistory] = useState<BookingRow[] | null>(null);

  const load = useCallback(async () => {
    onError(null);
    try {
      const q = hostelId ? `?hostelId=${hostelId}` : '';
      const [o, v] = await Promise.all([
        apiFetch<OccupancyReport>(`/hostel/reports/occupancy${q}`),
        apiFetch<VacancyReport>(`/hostel/reports/vacancy${q}`),
      ]);
      setOccupancy(o);
      setVacancy(v);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load reports.');
    }
  }, [hostelId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadHistory = () => {
    if (!studentId) {
      onError('Select a student to load hostel history.');
      return;
    }
    void run(async () => {
      const res = await apiFetch<{ total: number; data: BookingRow[] }>(`/hostel/reports/students/${studentId}/history`);
      setHistory(res.data);
    }, 'History loaded.', () => void 0, onError);
  };

  const bedLabel = (roomLabel: string) => roomLabel;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ ...formRowStyle }}>
          <Field label="Hostel">
            <select value={hostelId} onChange={(e) => { setHostelId(e.target.value); }} style={{ minWidth: 220, ...selectStyle }}>
              <option value="">All hostels</option>
              {lookups.hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
          <Button variant="secondary" onClick={() => void load()}>
            Refresh
          </Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Occupied &amp; reserved beds</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Bed</th>
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Student</th>
              <th style={thStyle}>Checked in</th>
            </tr>
          </thead>
          <tbody>
            {occupancy?.beds.map((b) => {
              const booking = occupancy.bookings.find((bk) => bk.bedId === b.id);
              return (
                <tr key={b.id}>
                  <td style={tdStyle}>{b.code}</td>
                  <td style={tdStyle}>{bedLabel(b.room.code)} · Floor {b.room.floor.floorNumber}</td>
                  <td style={tdStyle}>{b.status}</td>
                  <td style={tdStyle}>{booking?.student.fullName ?? '—'}</td>
                  <td style={tdStyle}>{fmtDate(booking?.checkInDate)}</td>
                </tr>
              );
            })}
            {occupancy && occupancy.beds.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={5}>
                  No occupied or reserved beds.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Vacant beds</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Bed</th>
              <th style={thStyle}>Location</th>
              <th style={thStyle}>Sharing</th>
              <th style={thStyle}>Rent</th>
            </tr>
          </thead>
          <tbody>
            {vacancy?.data.map((b) => (
              <tr key={b.id}>
                <td style={tdStyle}>{b.code}</td>
                <td style={tdStyle}>
                  {b.room.floor.building.hostel.name} · {b.room.floor.building.name} · {b.room.code}
                </td>
                <td style={tdStyle}>{b.room.sharing}</td>
                <td style={tdStyle}>{fmtCents(b.monthlyRentCents)}</td>
              </tr>
            ))}
            {vacancy && vacancy.data.length === 0 && (
              <tr>
                <td style={tdStyle} colSpan={4}>
                  No vacant beds.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {vacancy && <p style={{ color: '#9ca3af' }}>{vacancy.total} vacant beds</p>}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Student hostel history</h2>
        <div style={formRowStyle}>
          <Field label="Student">
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ minWidth: 220, ...selectStyle }}>
              <option value="">Select student…</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName} ({s.admissionNumber})
                </option>
              ))}
            </select>
          </Field>
          <Button onClick={loadHistory}>Load history</Button>
        </div>
        {history && (
          <table style={{ ...tableStyle, marginTop: 12 }}>
            <thead>
              <tr>
                <th style={thStyle}>Hostel · Room</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Allocation</th>
                <th style={thStyle}>Check-in</th>
                <th style={thStyle}>Check-out</th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td style={tdStyle}>
                    {h.hostel?.name ?? h.hostelName} · {h.roomNumber}
                  </td>
                  <td style={tdStyle}>{h.status}</td>
                  <td style={tdStyle}>{fmtDate(h.allocationDate)}</td>
                  <td style={tdStyle}>{fmtDate(h.checkInDate)}</td>
                  <td style={tdStyle}>{fmtDate(h.checkOutDate)}</td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td style={tdStyle} colSpan={5}>
                    No hostel history for this student.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}