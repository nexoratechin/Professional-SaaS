import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';
import {
  TRANSPORT_CREATE_PERMISSION,
  TRANSPORT_DELETE_PERMISSION,
  TRANSPORT_MANAGE_PERMISSION,
  TRANSPORT_UPDATE_PERMISSION,
  TRANSPORT_VIEW_PERMISSION,
  type AlertsReport,
  type AlertRow,
  type ChargeRow,
  type DriverRow,
  type GpsConfigRow,
  type GpsPositionRow,
  type LookupsPayload,
  type MaintenanceRow,
  type Paged,
  type PassRow,
  type RouteLoadReportRow,
  type RouteRow,
  type StopRow,
  type TransportSummary,
  type TripRow,
  type TripStopRow,
  type VehicleDocumentRow,
  type VehicleRow,
  type VehicleUtilizationRow,
} from './transport-shared';

const EMPTY_LOOKUPS: LookupsPayload = {
  campuses: [],
  vehicles: [],
  drivers: [],
  routes: [],
  stops: [],
  feeHeads: [],
  vehicleTypes: ['BUS', 'VAN', 'MINIBUS', 'CAR', 'OTHER'],
  vehicleStatuses: ['ACTIVE', 'IN_SERVICE', 'OUT_OF_SERVICE', 'SCRAPPED'],
  documentTypes: ['REGISTRATION', 'INSURANCE', 'FITNESS', 'PERMIT', 'POLLUTION', 'TAX_RECEIPT', 'INSPECTION', 'OTHER'],
  documentStatuses: ['VALID', 'EXPIRED', 'EXPIRING_SOON', 'REVOKED'],
  routeStatuses: ['ACTIVE', 'INACTIVE', 'SUSPENDED'],
  stopTypes: ['PICKUP', 'DROP', 'PICKUP_AND_DROP'],
  driverStatuses: ['ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'INACTIVE'],
  tripStatuses: ['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'],
  maintenanceTypes: ['PREVENTIVE', 'CORRECTIVE', 'EMERGENCY', 'INSPECTION'],
  maintenanceStatuses: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  alertTypes: [
    'SPEEDING',
    'OFF_ROUTE',
    'GEOFENCE_EXIT',
    'GEOFENCE_ENTER',
    'UNPLANNED_STOP',
    'ENGINE',
    'FUEL_LOW',
    'DELAYED',
    'MAINTENANCE_DUE',
    'DOCUMENT_EXPIRING',
    'OTHER',
  ],
  alertSeverities: ['INFO', 'WARNING', 'CRITICAL'],
  passStatuses: ['ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'],
  feeStatuses: ['ISSUED', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'WAIVED', 'REFUNDED'],
};

export function TransportPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<'summary' | 'vehicles' | 'drivers' | 'routes' | 'passes' | 'charges' | 'trips' | 'maintenance' | 'alerts' | 'gps' | 'reports'>('summary');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canView = permissions.includes(TRANSPORT_VIEW_PERMISSION);
  const canCreate = permissions.includes(TRANSPORT_CREATE_PERMISSION);
  const canUpdate = permissions.includes(TRANSPORT_UPDATE_PERMISSION);
  const canDelete = permissions.includes(TRANSPORT_DELETE_PERMISSION);
  const canManage = permissions.includes(TRANSPORT_MANAGE_PERMISSION);

  if (!canView) {
    return <p style={{ color: '#9ca3af', padding: '2rem' }}>You do not have permission to view the transport module.</p>;
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'summary', label: 'Summary' },
    { key: 'vehicles', label: 'Vehicles' },
    { key: 'drivers', label: 'Drivers' },
    { key: 'routes', label: 'Routes' },
    { key: 'passes', label: 'Passes' },
    { key: 'charges', label: 'Charges' },
    { key: 'trips', label: 'Trips' },
    { key: 'maintenance', label: 'Maintenance' },
    { key: 'alerts', label: 'Alerts' },
    { key: 'gps', label: 'GPS' },
    { key: 'reports', label: 'Reports' },
  ];

  return (
    <div style={{ maxWidth: 1180, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Transport</h1>
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
      {tab === 'vehicles' && <VehiclesTab canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'drivers' && <DriversTab canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'routes' && <RoutesTab canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={setError} onNotice={setNotice} />}
      {tab === 'passes' && <PassesTab canCreate={canCreate} canUpdate={canUpdate} canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'charges' && <ChargesTab canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'trips' && <TripsTab canCreate={canCreate} canUpdate={canUpdate} onError={setError} onNotice={setNotice} />}
      {tab === 'maintenance' && <MaintenanceTab canCreate={canCreate} canUpdate={canUpdate} onError={setError} onNotice={setNotice} />}
      {tab === 'alerts' && <AlertsTab canCreate={canCreate} canUpdate={canUpdate} onError={setError} onNotice={setNotice} />}
      {tab === 'gps' && <GpsTab canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'reports' && <ReportsTab onError={setError} />}
    </div>
  );
}

// ── Shared helpers ──────────────────────────────────────────────────────────

function fmtCents(cents: number | null | undefined): string {
  return `₹${((cents ?? 0) / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function centsToRupees(cents: number | null | undefined): string {
  if (cents == null) return '';
  return String(cents / 100);
}

function rupeesToCents(rupees: string): number {
  const parsed = parseInt(rupees, 10);
  return Number.isFinite(parsed) ? parsed * 100 : 0;
}

function fmtTime(value?: string | null): string {
  if (!value) return '—';
  if (/^\d{2}:\d{2}$/.test(value)) return value;
  return value.slice(0, 5);
}

async function run<T>(action: () => Promise<T>, success: string, onNotice: (m: string | null) => void, onError: (m: string | null) => void, onDone?: () => void): Promise<T | undefined> {
  try {
    const result = await action();
    onNotice(success);
    onError(null);
    onDone?.();
    return result;
  } catch (err) {
    onError(err instanceof Error ? err.message : 'Operation failed.');
    return undefined;
  }
}

function useLookups(): LookupsPayload {
  const [lookups, setLookups] = useState<LookupsPayload>(EMPTY_LOOKUPS);
  useEffect(() => {
    let mounted = true;
    apiFetch<LookupsPayload>('/transport/lookups')
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
const inputStyle: React.CSSProperties = { padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db', minWidth: 150 };

function Opt({ options, value, onChange, style }: { options: string[]; value: string; onChange: (v: string) => void; style?: React.CSSProperties }) {
  return (
    <select style={style ?? selectStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o} value={o}>
          {o.replace(/_/g, ' ')}
        </option>
      ))}
    </select>
  );
}

function Pager({ skip, take, total, onChange }: { skip: number; take: number; total: number; onChange: (skip: number) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: '0.8rem' }}>
      <Button variant="secondary" disabled={skip <= 0} onClick={() => onChange(Math.max(0, skip - take))}>
        Prev
      </Button>
      <span>
        {total === 0 ? '0 rows' : `${Math.min(skip + 1, total)}–${Math.min(skip + take, total)} of ${total}`}
      </span>
      <Button variant="secondary" disabled={skip + take >= total} onClick={() => onChange(skip + take)}>
        Next
      </Button>
    </div>
  );
}

// ── Summary ─────────────────────────────────────────────────────────────────

function SummaryTab({ onError }: { onError: (m: string | null) => void }) {
  const [summary, setSummary] = useState<TransportSummary | null>(null);

  const load = useCallback(async () => {
    onError(null);
    try {
      setSummary(await apiFetch<TransportSummary>('/transport/reports/summary'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load transport summary.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const stat = (label: string, value: number, color = '#111827') => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: '1.5rem', fontWeight: 600, color }}>{value}</span>
      <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>{label}</span>
    </div>
  );

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1rem' }}>Transport summary</h2>
        <Button variant="secondary" onClick={() => void load()}>
          Refresh
        </Button>
      </div>
      {!summary ? (
        <p style={{ color: '#9ca3af' }}>Loading…</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginTop: 16 }}>
          {stat('Vehicles', summary.vehicles)}
          {stat('In service', summary.inServiceVehicles, '#15803d')}
          {stat('Drivers', summary.drivers)}
          {stat('Active routes', summary.routes)}
          {stat('Active passes', summary.activePasses)}
          {stat('Overdue documents', summary.overdueDocuments, summary.overdueDocuments ? '#b91c1c' : '#111827')}
          {stat('Scheduled trips', summary.scheduledTrips)}
          {stat('Ongoing trips', summary.ongoingTrips, '#b45309')}
          {stat('Open alerts', summary.openAlerts, summary.openAlerts ? '#b91c1c' : '#111827')}
          {stat('Open maintenance', summary.openMaintenance, summary.openMaintenance ? '#b45309' : '#111827')}
        </div>
      )}
    </Card>
  );
}

// ── Vehicles ────────────────────────────────────────────────────────────────

function VehiclesTab({
  canCreate,
  canUpdate: _canUpdate,
  canDelete,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canManage: boolean;
  onError: (m: string | null) => void;
  onNotice: (m: string | null) => void;
}) {
  const lookups = useLookups();
  const [rows, setRows] = useState<VehicleRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<VehicleRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (search.trim()) params.set('search', search.trim());
      if (status) params.set('status', status);
      const r = await apiFetch<Paged<VehicleRow>>(`/transport/vehicles?${params.toString()}`);
      setRows(r.data);
      setTotal(r.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load vehicles.');
    }
  }, [skip, search, status, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    const payload = {
      campusId: form.campusId || undefined,
      type: form.type || undefined,
      registrationNumber: form.registrationNumber,
      chassisNumber: form.chassisNumber || undefined,
      engineNumber: form.engineNumber || undefined,
      make: form.make || undefined,
      model: form.model || undefined,
      yearOfManufacture: form.yearOfManufacture ? Number(form.yearOfManufacture) : undefined,
      fuelType: form.fuelType || undefined,
      seatingCapacity: form.seatingCapacity ? Number(form.seatingCapacity) : undefined,
      standingCapacity: form.standingCapacity ? Number(form.standingCapacity) : undefined,
      isAc: form.isAc === 'true',
      gpsDeviceId: form.gpsDeviceId || undefined,
      status: form.status || undefined,
    };
    if (selected) {
      await run(() => apiFetch(`/transport/vehicles/${selected.id}`, { method: 'PATCH', body: JSON.stringify(payload) }), 'Vehicle updated.', onNotice, onError, () => setSelected(null));
    } else {
      await run(() => apiFetch('/transport/vehicles', { method: 'POST', body: JSON.stringify(payload) }), 'Vehicle created.', onNotice, onError, () => {
        setCreating(false);
        setForm({});
      });
    }
    setReload((r) => r + 1);
  };

  const vehicleForm = (
    <div style={formRowStyle}>
      <Field label="Registration no.*">
        <Input value={form.registrationNumber ?? ''} onChange={set('registrationNumber')} placeholder="KA01AB1234" style={inputStyle} />
      </Field>
      <Field label="Type">
        <Opt options={lookups.vehicleTypes} value={form.type ?? ''} onChange={(v) => setForm((f) => ({ ...f, type: v }))} />
      </Field>
      <Field label="Status">
        <Opt options={lookups.vehicleStatuses} value={form.status ?? ''} onChange={(v) => setForm((f) => ({ ...f, status: v }))} />
      </Field>
      <Field label="Make">
        <Input value={form.make ?? ''} onChange={set('make')} style={inputStyle} />
      </Field>
      <Field label="Model">
        <Input value={form.model ?? ''} onChange={set('model')} style={inputStyle} />
      </Field>
      <Field label="Year">
        <Input value={form.yearOfManufacture ?? ''} onChange={set('yearOfManufacture')} style={inputStyle} />
      </Field>
      <Field label="Fuel">
        <Input value={form.fuelType ?? ''} onChange={set('fuelType')} style={inputStyle} />
      </Field>
      <Field label="Seating">
        <Input value={form.seatingCapacity ?? ''} onChange={set('seatingCapacity')} style={inputStyle} />
      </Field>
      <Field label="Standing">
        <Input value={form.standingCapacity ?? ''} onChange={set('standingCapacity')} style={inputStyle} />
      </Field>
      <Field label="GPS device id">
        <Input value={form.gpsDeviceId ?? ''} onChange={set('gpsDeviceId')} style={inputStyle} />
      </Field>
      <Field label="Campus">
        <select style={selectStyle} value={form.campusId ?? ''} onChange={set('campusId')}>
          <option value="">—</option>
          {lookups.campuses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="AC">
        <select style={selectStyle} value={form.isAc ?? 'false'} onChange={set('isAc')}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </Field>
      <Button variant="primary" onClick={() => void save()}>
        {selected ? 'Update' : 'Create'}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setSelected(null);
          setCreating(false);
          setForm({});
        }}
      >
        Cancel
      </Button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Fleet</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search regno/make/model" style={inputStyle} />
            <Opt options={lookups.vehicleStatuses} value={status} onChange={setStatus} />
            {canCreate && (
              <Button variant="secondary" onClick={() => setCreating((c) => !c)}>
                New vehicle
              </Button>
            )}
          </div>
        </div>
        {(creating || selected) && <div style={{ marginTop: 12 }}>{vehicleForm}</div>}
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Registration</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Make / Model</th>
                <th style={thStyle}>Campus</th>
                <th style={thStyle}>Capacity</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Routes</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td style={tdStyle}>
                    {v.registrationNumber}
                    {v.gpsDeviceId && <span style={{ color: '#6b7280', fontSize: '0.72rem' }}> · GPS</span>}
                  </td>
                  <td style={tdStyle}>{v.type}</td>
                  <td style={tdStyle}>
                    {v.make ?? '—'} {v.model ?? ''}
                  </td>
                  <td style={tdStyle}>{v.campus?.name ?? '—'}</td>
                  <td style={tdStyle}>{v.seatingCapacity ?? '—'}</td>
                  <td style={tdStyle}>{v.status}</td>
                  <td style={tdStyle}>{v.routes?.map((r) => r.code).join(', ') || '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button
                        variant="secondary"
                        onClick={() =>
                          setSelected({
                            ...v,
                            campusId: v.campus?.id ?? null,
                            type: v.type,
                            registrationNumber: v.registrationNumber,
                            chassisNumber: v.chassisNumber,
                            engineNumber: v.engineNumber,
                            make: v.make,
                            model: v.model,
                            yearOfManufacture: v.yearOfManufacture,
                            fuelType: v.fuelType,
                            seatingCapacity: v.seatingCapacity,
                            standingCapacity: v.standingCapacity,
                            isAc: v.isAc,
                            gpsDeviceId: v.gpsDeviceId,
                            status: v.status,
                          })
                        }
                        onClickCapture={() => {
                          setForm((f) => ({ ...f, registrationNumber: v.registrationNumber, type: v.type, status: v.status, make: v.make ?? '', model: v.model ?? '', yearOfManufacture: v.yearOfManufacture ? String(v.yearOfManufacture) : '', fuelType: v.fuelType ?? '', seatingCapacity: v.seatingCapacity ? String(v.seatingCapacity) : '', standingCapacity: v.standingCapacity ? String(v.standingCapacity) : '', gpsDeviceId: v.gpsDeviceId ?? '', campusId: v.campus?.id ?? '', isAc: v.isAc ? 'true' : 'false' }))}
                        }
                      >
                        Edit
                      </Button>
                      {canManage && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(
                              () => apiFetch(`/transport/vehicles/${v.id}/status`, { method: 'POST', body: JSON.stringify({ status: v.status === 'IN_SERVICE' ? 'OUT_OF_SERVICE' : 'IN_SERVICE' }) }),
                              'Vehicle status updated.',
                              onNotice,
                              onError,
                              () => setReload((r) => r + 1),
                            )
                          }
                        >
                          Toggle
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/vehicles/${v.id}`, { method: 'DELETE' }), 'Vehicle deleted.', onNotice, onError, () => setReload((r) => r + 1))
                          }
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager skip={skip} take={50} total={total} onChange={setSkip} />
      </Card>
      {selected && <VehicleDetail vehicleId={selected.id} canManage={canManage} onError={onError} onNotice={onNotice} />}
    </div>
  );
}

function VehicleDetail({ vehicleId, canManage, onError, onNotice }: { vehicleId: string; canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [vehicle, setVehicle] = useState<VehicleRow | null>(null);
  const [docs, setDocs] = useState<VehicleDocumentRow[]>([]);
  const [positions, setPositions] = useState<GpsPositionRow[]>([]);
  const [showDocs, setShowDocs] = useState(false);
  const [showPos, setShowPos] = useState(false);
  const [docForm, setDocForm] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const [v, d] = await Promise.all([apiFetch<VehicleRow>(`/transport/vehicles/${vehicleId}`), apiFetch<VehicleDocumentRow[]>(`/transport/vehicles/${vehicleId}/documents`)]);
      setVehicle(v);
      setDocs(d);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load vehicle detail.');
    }
  }, [vehicleId, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const setD = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setDocForm((f) => ({ ...f, [k]: e.target.value }));

  const addDoc = async () => {
    await run(
      () =>
        apiFetch(`/transport/vehicles/${vehicleId}/documents`, {
          method: 'POST',
          body: JSON.stringify({
            documentType: docForm.documentType,
            documentNumber: docForm.documentNumber || undefined,
            issueDate: docForm.issueDate || undefined,
            expiryDate: docForm.expiryDate || undefined,
            issuer: docForm.issuer || undefined,
            status: docForm.status || undefined,
          }),
        }),
      'Document added.',
      onNotice,
      onError,
      () => setDocForm({}),
    );
    setReload((r) => r + 1);
  };

  const loadPositions = async () => {
    try {
      setPositions(await apiFetch<{ data: GpsPositionRow[] }>(`/transport/vehicles/${vehicleId}/positions?limit=50`).then((r) => r.data));
      setShowPos(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load GPS positions (GPS entitlement may be disabled).');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>{vehicle?.registrationNumber} — detail</h3>
        {vehicle && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, fontSize: '0.85rem' }}>
            <div>Type: {vehicle.type}</div>
            <div>Make/Model: {vehicle.make ?? '—'} {vehicle.model ?? ''}</div>
            <div>Year: {vehicle.yearOfManufacture ?? '—'}</div>
            <div>Fuel: {vehicle.fuelType ?? '—'}</div>
            <div>Seating: {vehicle.seatingCapacity ?? '—'} / Standing: {vehicle.standingCapacity ?? '—'}</div>
            <div>AC: {vehicle.isAc ? 'Yes' : 'No'}</div>
            <div>Status: {vehicle.status}</div>
            <div>GPS device: {vehicle.gpsDeviceId ?? '—'}</div>
            {vehicle.latestPosition && (
              <div>
                Last fix: {vehicle.latestPosition.latitude.toFixed(5)}, {vehicle.latestPosition.longitude.toFixed(5)} at {fmtDate(vehicle.latestPosition.recordedAt)}
              </div>
            )}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <Button variant="secondary" onClick={() => setShowDocs((s) => !s)}>
            Documents ({docs.length})
          </Button>
          <Button variant="secondary" onClick={() => void loadPositions()}>
            Live positions
          </Button>
        </div>
        {showDocs && (
          <div style={{ marginTop: 12 }}>
            {canManage && (
              <div style={formRowStyle}>
                <Field label="Type">
                  <select style={selectStyle} value={docForm.documentType ?? ''} onChange={(e) => setDocForm((f) => ({ ...f, documentType: e.target.value }))}>
                    <option value="">—</option>
                    {lookups.documentTypes.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Number">
                  <Input value={docForm.documentNumber ?? ''} onChange={setD('documentNumber')} style={inputStyle} />
                </Field>
                <Field label="Issue date">
                  <Input type="date" value={docForm.issueDate ?? ''} onChange={setD('issueDate')} style={inputStyle} />
                </Field>
                <Field label="Expiry">
                  <Input type="date" value={docForm.expiryDate ?? ''} onChange={setD('expiryDate')} style={inputStyle} />
                </Field>
                <Field label="Issuer">
                  <Input value={docForm.issuer ?? ''} onChange={setD('issuer')} style={inputStyle} />
                </Field>
                <Field label="Status">
                  <select style={selectStyle} value={docForm.status ?? ''} onChange={(e) => setDocForm((f) => ({ ...f, status: e.target.value }))}>
                    <option value="">—</option>
                    {lookups.documentStatuses.map((t) => (
                      <option key={t} value={t}>
                        {t.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </Field>
                <Button variant="primary" onClick={() => void addDoc()}>
                  Add
                </Button>
              </div>
            )}
            <table style={{ ...tableStyle, marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Number</th>
                  <th style={thStyle}>Issued</th>
                  <th style={thStyle}>Expires</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id}>
                    <td style={tdStyle}>{d.documentType}</td>
                    <td style={tdStyle}>{d.documentNumber ?? '—'}</td>
                    <td style={tdStyle}>{fmtDate(d.issueDate)}</td>
                    <td style={tdStyle}>{fmtDate(d.expiryDate)}</td>
                    <td style={tdStyle}>{d.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showPos && (
          <div style={{ marginTop: 12 }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Recorded</th>
                  <th style={thStyle}>Latitude</th>
                  <th style={thStyle}>Longitude</th>
                  <th style={thStyle}>Speed (km/h)</th>
                  <th style={thStyle}>Source</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id}>
                    <td style={tdStyle}>{fmtDate(p.recordedAt)} {fmtTime(p.recordedAt)}</td>
                    <td style={tdStyle}>{p.latitude.toFixed(5)}</td>
                    <td style={tdStyle}>{p.longitude.toFixed(5)}</td>
                    <td style={tdStyle}>{p.speedKmh ?? '—'}</td>
                    <td style={tdStyle}>{p.source ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Drivers ─────────────────────────────────────────────────────────────────

function DriversTab({ canCreate, canUpdate, canDelete: _canDelete, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [rows, setRows] = useState<DriverRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50', includeInactive: 'true' });
      if (search.trim()) params.set('search', search.trim());
      const r = await apiFetch<Paged<DriverRow>>(`/transport/drivers?${params.toString()}`);
      setRows(r.data);
      setTotal(r.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load drivers.');
    }
  }, [skip, search, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    const payload = {
      name: form.name,
      licenseNumber: form.licenseNumber,
      phone: form.phone || undefined,
      alternatePhone: form.alternatePhone || undefined,
      email: form.email || undefined,
      licenseClass: form.licenseClass || undefined,
      licenseExpiry: form.licenseExpiry || undefined,
      joinedAt: form.joinedAt || undefined,
      status: form.status || undefined,
      notes: form.notes || undefined,
    };
    await run(() => apiFetch('/transport/drivers', { method: 'POST', body: JSON.stringify(payload) }), 'Driver created.', onNotice, onError, () => {
      setCreating(false);
      setForm({});
    });
    setReload((r) => r + 1);
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Drivers</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name/licence/phone" style={inputStyle} />
          {canCreate && (
            <Button variant="secondary" onClick={() => setCreating((c) => !c)}>
              New driver
            </Button>
          )}
        </div>
      </div>
      {creating && (
        <div style={formRowStyle}>
          <Field label="Name*">
            <Input value={form.name ?? ''} onChange={set('name')} style={inputStyle} />
          </Field>
          <Field label="Licence no.*">
            <Input value={form.licenseNumber ?? ''} onChange={set('licenseNumber')} style={inputStyle} />
          </Field>
          <Field label="Phone">
            <Input value={form.phone ?? ''} onChange={set('phone')} style={inputStyle} />
          </Field>
          <Field label="Alternate phone">
            <Input value={form.alternatePhone ?? ''} onChange={set('alternatePhone')} style={inputStyle} />
          </Field>
          <Field label="Email">
            <Input value={form.email ?? ''} onChange={set('email')} style={inputStyle} />
          </Field>
          <Field label="Licence class">
            <Input value={form.licenseClass ?? ''} onChange={set('licenseClass')} style={inputStyle} />
          </Field>
          <Field label="Licence expiry">
            <Input type="date" value={form.licenseExpiry ?? ''} onChange={set('licenseExpiry')} style={inputStyle} />
          </Field>
          <Field label="Status">
            <select style={selectStyle} value={form.status ?? 'ACTIVE'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {lookups.driverStatuses.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Button variant="primary" onClick={() => void save()}>
            Create
          </Button>
          <Button variant="secondary" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      )}
      <div style={{ marginTop: 12, overflowX: 'auto' }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Licence</th>
              <th style={thStyle}>Phone</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Assigned vehicle</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const active = d.assignments?.find((a) => a.isActive);
              return (
                <tr key={d.id}>
                  <td style={tdStyle}>{d.name}</td>
                  <td style={tdStyle}>{d.licenseNumber}</td>
                  <td style={tdStyle}>{d.phone ?? '—'}</td>
                  <td style={tdStyle}>{d.status}</td>
                  <td style={tdStyle}>{active?.vehicle?.registrationNumber ?? '—'}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>{canUpdate && <AssignRelease driver={d} lookups={lookups} onError={onError} onNotice={onNotice} onDone={() => setReload((r) => r + 1)} />}</div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager skip={skip} take={50} total={total} onChange={setSkip} />
    </Card>
  );
}

function AssignRelease({ driver, lookups, onError, onNotice, onDone }: { driver: DriverRow; lookups: LookupsPayload; onError: (m: string | null) => void; onNotice: (m: string | null) => void; onDone: () => void }) {
  const [vehicleId, setVehicleId] = useState('');
  return (
    <>
      <select style={selectStyle} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
        <option value="">Vehicle…</option>
        {lookups.vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.registrationNumber}
          </option>
        ))}
      </select>
      <Button
        variant="secondary"
        onClick={() => {
          if (!vehicleId) {
            onError('Select a vehicle.');
            return;
          }
          void run(
            () => apiFetch(`/transport/drivers/${driver.id}/assign`, { method: 'POST', body: JSON.stringify({ vehicleId }) }),
            'Driver assigned.',
            onNotice,
            onError,
            onDone,
          );
        }}
      >
        Assign
      </Button>
      {driver.assignments?.some((a) => a.isActive) && (
        <Button
          variant="secondary"
          onClick={() =>
            void run(
              () => apiFetch(`/transport/drivers/${driver.id}/release`, { method: 'POST', body: JSON.stringify({ vehicleId: vehicleId || driver.assignments!.find((a) => a.isActive)!.vehicle!.id }) }),
              'Driver released.',
              onNotice,
              onError,
              onDone,
            )
          }
        >
          Release
        </Button>
      )}
    </>
  );
}

// ── Routes & stops ──────────────────────────────────────────────────────────

function RoutesTab({ canCreate, canUpdate, canDelete, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; canDelete: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [rows, setRows] = useState<RouteRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [selectedRoute, setSelectedRoute] = useState<RouteRow | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<Paged<RouteRow>>(`/transport/routes?skip=${skip}&take=50&includeInactive=true&includeStops=false`);
      setRows(r.data);
      setTotal(r.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load routes.');
    }
  }, [skip, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    const payload = {
      code: form.code,
      name: form.name,
      campusId: form.campusId || undefined,
      status: form.status || undefined,
      distanceKm: form.distanceKm ? Number(form.distanceKm) : undefined,
      estimatedDurationMin: form.estimatedDurationMin ? Number(form.estimatedDurationMin) : undefined,
      monthlyFeeCents: form.monthlyFeeCents ? rupeesToCents(form.monthlyFeeCents) : undefined,
      description: form.description || undefined,
      vehicleId: form.vehicleId || undefined,
      isActive: form.isActive === 'false' ? false : true,
    };
    if (selectedRoute) {
      await run(() => apiFetch(`/transport/routes/${selectedRoute.id}`, { method: 'PATCH', body: JSON.stringify(payload) }), 'Route updated.', onNotice, onError, () => setSelectedRoute(null));
    } else {
      await run(() => apiFetch('/transport/routes', { method: 'POST', body: JSON.stringify(payload) }), 'Route created.', onNotice, onError, () => {
        setCreating(false);
        setForm({});
      });
    }
    setReload((r) => r + 1);
  };

  const routeForm = (
    <div style={formRowStyle}>
      <Field label="Code*">
        <Input value={form.code ?? ''} onChange={set('code')} style={inputStyle} />
      </Field>
      <Field label="Name*">
        <Input value={form.name ?? ''} onChange={set('name')} style={inputStyle} />
      </Field>
      <Field label="Campus">
        <select style={selectStyle} value={form.campusId ?? ''} onChange={(e) => setForm((f) => ({ ...f, campusId: e.target.value }))}>
          <option value="">—</option>
          {lookups.campuses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vehicle">
        <select style={selectStyle} value={form.vehicleId ?? ''} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}>
          <option value="">—</option>
          {lookups.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registrationNumber}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Status">
        <select style={selectStyle} value={form.status ?? 'ACTIVE'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
          {lookups.routeStatuses.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Distance (km)">
        <Input value={form.distanceKm ?? ''} onChange={set('distanceKm')} style={inputStyle} />
      </Field>
      <Field label="Duration (min)">
        <Input value={form.estimatedDurationMin ?? ''} onChange={set('estimatedDurationMin')} style={inputStyle} />
      </Field>
      <Field label="Monthly fee (₹)">
        <Input value={form.monthlyFeeCents ?? ''} onChange={set('monthlyFeeCents')} style={inputStyle} />
      </Field>
      <Field label="Active">
        <select style={selectStyle} value={form.isActive ?? 'true'} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.value }))}>
          <option value="true">Yes</option>
          <option value="false">No</option>
        </select>
      </Field>
      <Button variant="primary" onClick={() => void save()}>
        {selectedRoute ? 'Update' : 'Create'}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setSelectedRoute(null);
          setCreating(false);
          setForm({});
        }}
      >
        Cancel
      </Button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem' }}>Routes</h2>
          {canCreate && (
            <Button variant="secondary" onClick={() => setCreating((c) => !c)}>
              New route
            </Button>
          )}
        </div>
        {(creating || selectedRoute) && <div style={{ marginTop: 12 }}>{routeForm}</div>}
        <div style={{ marginTop: 12 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Code</th>
                <th style={thStyle}>Name</th>
                <th style={thStyle}>Campus</th>
                <th style={thStyle}>Vehicle</th>
                <th style={thStyle}>Fee</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Stops</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={tdStyle}>{r.code}</td>
                  <td style={tdStyle}>{r.name}</td>
                  <td style={tdStyle}>{r.campus?.name ?? '—'}</td>
                  <td style={tdStyle}>{r.vehicle?.registrationNumber ?? '—'}</td>
                  <td style={tdStyle}>{r.monthlyFeeCents != null ? fmtCents(r.monthlyFeeCents) : '—'}</td>
                  <td style={tdStyle}>{r.status}</td>
                  <td style={tdStyle}>{r._count?.stops ?? 0}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setSelectedRoute(r);
                          setForm((f) => ({ ...f, code: r.code, name: r.name, campusId: r.campusId ?? '', vehicleId: r.vehicleId ?? '', status: r.status, distanceKm: r.distanceKm ? String(r.distanceKm) : '', estimatedDurationMin: r.estimatedDurationMin ? String(r.estimatedDurationMin) : '', monthlyFeeCents: centsToRupees(r.monthlyFeeCents), isActive: r.isActive ? 'true' : 'false' }));
                        }}
                      >
                        Edit
                      </Button>
                      {canCreate && (
                        <Button variant="secondary" onClick={() => setSelectedRoute({ ...r })}>
                          Stops
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/routes/${r.id}`, { method: 'DELETE' }), 'Route deleted.', onNotice, onError, () => setReload((x) => x + 1))
                          }
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager skip={skip} take={50} total={total} onChange={setSkip} />
      </Card>
      {selectedRoute && <StopsPanel route={selectedRoute} canCreate={canCreate} canUpdate={canUpdate} canDelete={canDelete} onError={onError} onNotice={onNotice} />}
    </div>
  );
}

function StopsPanel({ route, canCreate, canUpdate, canDelete: _canDelete, onError, onNotice }: { route: RouteRow; canCreate: boolean; canUpdate: boolean; canDelete: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [stops, setStops] = useState<StopRow[]>([]);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const r = await apiFetch<RouteRow>(`/transport/routes/${route.id}`);
      setStops(r.stops ?? []);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load stops.');
    }
  }, [route.id, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addStop = async () => {
    await run(
      () =>
        apiFetch(`/transport/routes/${route.id}/stops`, {
          method: 'POST',
          body: JSON.stringify({
            name: form.name,
            order: form.order ? Number(form.order) : undefined,
            type: form.type || undefined,
            address: form.address || undefined,
            pickupTime: form.pickupTime || undefined,
            dropTime: form.dropTime || undefined,
            reachRadiusMeters: form.reachRadiusMeters ? Number(form.reachRadiusMeters) : undefined,
          }),
        }),
      'Stop added.',
      onNotice,
      onError,
      () => setForm({}),
    );
    setReload((r) => r + 1);
  };

  const move = async (stopId: string, dir: -1 | 1) => {
    const idx = stops.findIndex((s) => s.id === stopId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= stops.length) return;
    const next = stops.slice();
    const a = next[idx] as StopRow;
    const b = next[target] as StopRow;
    next[idx] = b;
    next[target] = a;
    await run(
      () => apiFetch(`/transport/routes/${route.id}/stops/reorder`, { method: 'POST', body: JSON.stringify({ order: next.map((s) => s.id) }) }),
      'Stop order updated.',
      onNotice,
      onError,
    );
    setStops(next);
  };

  return (
    <Card>
      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>
        {route.code} — stops ({stops.length})
      </h3>
      {canCreate && (
        <div style={formRowStyle}>
          <Field label="Name*">
            <Input value={form.name ?? ''} onChange={set('name')} style={inputStyle} />
          </Field>
          <Field label="Order">
            <Input value={form.order ?? ''} onChange={set('order')} style={inputStyle} />
          </Field>
          <Field label="Type">
            <select style={selectStyle} value={form.type ?? 'PICKUP'} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              {lookups.stopTypes.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Address">
            <Input value={form.address ?? ''} onChange={set('address')} style={inputStyle} />
          </Field>
          <Field label="Pickup time">
            <Input value={form.pickupTime ?? ''} onChange={set('pickupTime')} placeholder="07:30" style={inputStyle} />
          </Field>
          <Field label="Drop time">
            <Input value={form.dropTime ?? ''} onChange={set('dropTime')} placeholder="16:30" style={inputStyle} />
          </Field>
          <Field label="Radius (m)">
            <Input value={form.reachRadiusMeters ?? ''} onChange={set('reachRadiusMeters')} style={inputStyle} />
          </Field>
          <Button variant="primary" onClick={() => void addStop()}>
            Add
          </Button>
        </div>
      )}
      <table style={{ ...tableStyle, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            <th style={thStyle}>Name</th>
            <th style={thStyle}>Type</th>
            <th style={thStyle}>Address</th>
            <th style={thStyle}>Pickup / Drop</th>
            <th style={thStyle}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {stops.map((s) => (
            <tr key={s.id}>
              <td style={tdStyle}>{s.order}</td>
              <td style={tdStyle}>{s.name}</td>
              <td style={tdStyle}>{s.type}</td>
              <td style={tdStyle}>{s.address ?? '—'}</td>
              <td style={tdStyle}>
                {fmtTime(s.pickupTime)} / {fmtTime(s.dropTime)}
              </td>
              <td style={tdStyle}>
                {canUpdate && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <Button variant="secondary" onClick={() => void move(s.id, -1)}>
                      ↑
                    </Button>
                    <Button variant="secondary" onClick={() => void move(s.id, 1)}>
                      ↓
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        run(() => apiFetch(`/transport/routes/stops/${s.id}`, { method: 'DELETE' }), 'Stop deleted.', onNotice, onError, () => setReload((x) => x + 1))
                      }
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// ── Passes ──────────────────────────────────────────────────────────────────

function PassesTab({ canCreate, canUpdate, canManage: _canManage, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [rows, setRows] = useState<PassRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [status, setStatus] = useState('');
  const [routeId, setRouteId] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<PassRow | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (status) params.set('status', status);
      if (routeId) params.set('routeId', routeId);
      const r = await apiFetch<Paged<PassRow>>(`/transport/passes?${params.toString()}`);
      setRows(r.data);
      setTotal(r.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load passes.');
    }
  }, [skip, status, routeId, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const save = async () => {
    const payload = {
      studentId: form.studentId,
      routeId: form.routeId,
      stopId: form.stopId,
      dropStopId: form.dropStopId || undefined,
      vehicleId: form.vehicleId || undefined,
      driverId: form.driverId || undefined,
      periodStart: form.periodStart,
      amountCents: form.amountCents ? rupeesToCents(form.amountCents) : undefined,
      chargeFee: form.chargeFee === 'true',
      dailyPickupTime: form.dailyPickupTime || undefined,
      dailyDropTime: form.dailyDropTime || undefined,
      remarks: form.remarks || undefined,
    };
    if (selected) {
      await run(() => apiFetch(`/transport/passes/${selected.id}`, { method: 'PATCH', body: JSON.stringify(payload) }), 'Pass updated.', onNotice, onError, () => setSelected(null));
    } else {
      await run(() => apiFetch('/transport/passes', { method: 'POST', body: JSON.stringify(payload) }), 'Pass issued.', onNotice, onError, () => {
        setCreating(false);
        setForm({});
      });
    }
    setReload((r) => r + 1);
  };

  const passForm = (
    <div style={formRowStyle}>
      <Field label="Student id">
        <Input value={form.studentId ?? ''} onChange={(e) => setForm((f) => ({ ...f, studentId: e.target.value }))} placeholder="student id" style={inputStyle} />
      </Field>
      <Field label="Route*">
        <select style={selectStyle} value={form.routeId ?? ''} onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value }))}>
          <option value="">—</option>
          {lookups.routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Pickup stop*">
        <select style={selectStyle} value={form.stopId ?? ''} onChange={(e) => setForm((f) => ({ ...f, stopId: e.target.value }))}>
          <option value="">—</option>
          {lookups.stops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Drop stop">
        <select style={selectStyle} value={form.dropStopId ?? ''} onChange={(e) => setForm((f) => ({ ...f, dropStopId: e.target.value }))}>
          <option value="">—</option>
          {lookups.stops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Vehicle">
        <select style={selectStyle} value={form.vehicleId ?? ''} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}>
          <option value="">—</option>
          {lookups.vehicles.map((v) => (
            <option key={v.id} value={v.id}>
              {v.registrationNumber}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Driver">
        <select style={selectStyle} value={form.driverId ?? ''} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}>
          <option value="">—</option>
          {lookups.drivers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Period start*">
        <Input type="date" value={form.periodStart ?? ''} onChange={(e) => setForm((f) => ({ ...f, periodStart: e.target.value }))} style={inputStyle} />
      </Field>
      <Field label="Amount (₹)">
        <Input value={form.amountCents ?? ''} onChange={(e) => setForm((f) => ({ ...f, amountCents: e.target.value }))} style={inputStyle} />
      </Field>
      <Field label="Charge fee">
        <select style={selectStyle} value={form.chargeFee ?? 'false'} onChange={(e) => setForm((f) => ({ ...f, chargeFee: e.target.value }))}>
          <option value="false">No</option>
          <option value="true">Yes</option>
        </select>
      </Field>
      <Field label="Pickup time">
        <Input value={form.dailyPickupTime ?? ''} onChange={(e) => setForm((f) => ({ ...f, dailyPickupTime: e.target.value }))} placeholder="07:30" style={inputStyle} />
      </Field>
      <Field label="Drop time">
        <Input value={form.dailyDropTime ?? ''} onChange={(e) => setForm((f) => ({ ...f, dailyDropTime: e.target.value }))} placeholder="16:30" style={inputStyle} />
      </Field>
      <Field label="Remarks">
        <Input value={form.remarks ?? ''} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} style={inputStyle} />
      </Field>
      <Button variant="primary" onClick={() => void save()}>
        {selected ? 'Update' : 'Issue'}
      </Button>
      <Button
        variant="secondary"
        onClick={() => {
          setSelected(null);
          setCreating(false);
          setForm({});
        }}
      >
        Cancel
      </Button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Student passes</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Opt options={lookups.passStatuses} value={status} onChange={setStatus} />
            <select style={selectStyle} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">All routes</option>
              {lookups.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </select>
            {canCreate && (
              <Button variant="secondary" onClick={() => setCreating((c) => !c)}>
                Issue pass
              </Button>
            )}
          </div>
        </div>
        {(creating || selected) && <div style={{ marginTop: 12 }}>{passForm}</div>}
        <div style={{ marginTop: 12 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Student</th>
                <th style={thStyle}>Route</th>
                <th style={thStyle}>Board</th>
                <th style={thStyle}>Drop</th>
                <th style={thStyle}>Period</th>
                <th style={thStyle}>Amount</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>
                    {p.student?.fullName ?? '—'}
                    <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{p.student?.admissionNumber ?? ''}</div>
                  </td>
                  <td style={tdStyle}>
                    {p.routeCode}
                    <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{p.routeName}</div>
                  </td>
                  <td style={tdStyle}>{p.pickupPoint ?? '—'}</td>
                  <td style={tdStyle}>{p.dropPoint ?? '—'}</td>
                  <td style={tdStyle}>
                    {fmtDate(p.periodStart)} → {p.periodEnd ? fmtDate(p.periodEnd) : '∞'}
                  </td>
                  <td style={tdStyle}>{p.amountCents != null ? fmtCents(p.amountCents) : '—'}</td>
                  <td style={tdStyle}>{p.status}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {canUpdate && (
                        <Button
                          variant="secondary"
                          onClick={() => {
                            setSelected(p);
                            setForm((f) => ({ ...f, studentId: p.studentId, routeId: p.routeId, stopId: p.stopId ?? '', dropStopId: p.dropStopId ?? '', vehicleId: p.vehicleId ?? '', driverId: p.driverId ?? '', periodStart: p.periodStart.slice(0, 10), amountCents: centsToRupees(p.amountCents), dailyPickupTime: p.dailyPickupTime ?? '', dailyDropTime: p.dailyDropTime ?? '', remarks: p.remarks ?? '' }));
                          }}
                        >
                          Edit
                        </Button>
                      )}
                      {canCreate && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(
                              () => apiFetch(`/transport/passes/${p.id}/charge`, { method: 'POST', body: JSON.stringify({ monthCount: 1 }) }),
                              'Monthly charge raised.',
                              onNotice,
                              onError,
                              () => setReload((x) => x + 1),
                            )
                          }
                        >
                          Charge
                        </Button>
                      )}
                      {canUpdate && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(
                              () => apiFetch(`/transport/passes/${p.id}/status`, { method: 'POST', body: JSON.stringify({ status: p.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE', reason: 'Toggle via transport office' }) }),
                              'Pass status updated.',
                              onNotice,
                              onError,
                              () => setReload((x) => x + 1),
                            )
                          }
                        >
                          Toggle
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager skip={skip} take={50} total={total} onChange={setSkip} />
      </Card>
    </div>
  );
}

// ── Charges ─────────────────────────────────────────────────────────────────

function ChargesTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [rows, setRows] = useState<ChargeRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [status, setStatus] = useState('');
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (status) params.set('status', status);
      const r = await apiFetch<Paged<ChargeRow>>(`/transport/charges?${params.toString()}`);
      setRows(r.data);
      setTotal(r.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load charges.');
    }
  }, [skip, status, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Transport charges (shared fee ledger)</h2>
        <Opt options={lookups.feeStatuses} value={status} onChange={setStatus} />
      </div>
      <div style={{ marginTop: 12 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Student</th>
              <th style={thStyle}>Head</th>
              <th style={thStyle}>Route</th>
              <th style={thStyle}>Amount</th>
              <th style={thStyle}>Due</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Remarks</th>
              {canManage && <th style={thStyle}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td style={tdStyle}>{c.student?.fullName ?? '—'}</td>
                <td style={tdStyle}>{c.headName}</td>
                <td style={tdStyle}>{c.transportPass?.routeName ?? c.transportPass?.route?.code ?? '—'}</td>
                <td style={tdStyle}>{fmtCents(c.amountCents)}</td>
                <td style={tdStyle}>{fmtDate(c.dueDate)}</td>
                <td style={tdStyle}>{c.status}</td>
                <td style={tdStyle}>{c.remarks ?? '—'}</td>
                {canManage && (
                  <td style={tdStyle}>
                    {c.status !== 'PAID' && c.status !== 'WAIVED' && (
                      <Button
                        variant="secondary"
                        onClick={() =>
                          run(() => apiFetch(`/transport/charges/${c.id}/waive`, { method: 'POST', body: JSON.stringify({ reason: 'Waived by transport office' }) }), 'Charge waived.', onNotice, onError, () => setReload((x) => x + 1))
                        }
                      >
                        Waive
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager skip={skip} take={50} total={total} onChange={setSkip} />
    </Card>
  );
}

// ── Trips ───────────────────────────────────────────────────────────────────

function TripsTab({ canCreate, canUpdate, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [rows, setRows] = useState<TripRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [date, setDate] = useState('');
  const [status, setStatus] = useState('');
  const [routeId, setRouteId] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<TripRow | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (date) params.set('date', date);
      if (status) params.set('status', status);
      if (routeId) params.set('routeId', routeId);
      const r = await apiFetch<Paged<TripRow>>(`/transport/trips?${params.toString()}`);
      setRows(r.data);
      setTotal(r.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load trips.');
    }
  }, [skip, date, status, routeId, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const save = async () => {
    await run(
      () =>
        apiFetch('/transport/trips', {
          method: 'POST',
          body: JSON.stringify({
            routeId: form.routeId,
            vehicleId: form.vehicleId || undefined,
            driverId: form.driverId || undefined,
            date: form.date,
            scheduledDeparture: form.scheduledDeparture || undefined,
            scheduledArrival: form.scheduledArrival || undefined,
            remarks: form.remarks || undefined,
          }),
        }),
      'Trip scheduled.',
      onNotice,
      onError,
      () => {
        setCreating(false);
        setForm({});
      },
    );
    setReload((r) => r + 1);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Trips</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
            <Opt options={lookups.tripStatuses} value={status} onChange={setStatus} />
            <select style={selectStyle} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">All routes</option>
              {lookups.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </select>
            {canCreate && (
              <Button variant="secondary" onClick={() => setCreating((c) => !c)}>
                Schedule trip
              </Button>
            )}
          </div>
        </div>
        {creating && (
          <div style={formRowStyle}>
            <Field label="Route*">
              <select style={selectStyle} value={form.routeId ?? ''} onChange={(e) => setForm((f) => ({ ...f, routeId: e.target.value }))}>
                <option value="">—</option>
                {lookups.routes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.code} · {r.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vehicle">
              <select style={selectStyle} value={form.vehicleId ?? ''} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}>
                <option value="">—</option>
                {lookups.vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Driver">
              <select style={selectStyle} value={form.driverId ?? ''} onChange={(e) => setForm((f) => ({ ...f, driverId: e.target.value }))}>
                <option value="">—</option>
                {lookups.drivers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date*">
              <Input type="date" value={form.date ?? ''} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} style={inputStyle} />
            </Field>
            <Field label="Scheduled departure">
              <Input value={form.scheduledDeparture ?? ''} onChange={(e) => setForm((f) => ({ ...f, scheduledDeparture: e.target.value }))} placeholder="YYYY-MM-DDTHH:mm" style={inputStyle} />
            </Field>
            <Field label="Scheduled arrival">
              <Input value={form.scheduledArrival ?? ''} onChange={(e) => setForm((f) => ({ ...f, scheduledArrival: e.target.value }))} placeholder="YYYY-MM-DDTHH:mm" style={inputStyle} />
            </Field>
            <Button variant="primary" onClick={() => void save()}>
              Schedule
            </Button>
            <Button variant="secondary" onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Route</th>
                <th style={thStyle}>Vehicle</th>
                <th style={thStyle}>Driver</th>
                <th style={thStyle}>Departure</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td style={tdStyle}>{fmtDate(t.date)}</td>
                  <td style={tdStyle}>{t.route?.code ?? '—'}</td>
                  <td style={tdStyle}>{t.vehicle?.registrationNumber ?? '—'}</td>
                  <td style={tdStyle}>{t.driver?.name ?? '—'}</td>
                  <td style={tdStyle}>{t.actualDepartureAt ? `${fmtDate(t.actualDepartureAt)} ${fmtTime(t.actualDepartureAt)}` : '—'}</td>
                  <td style={tdStyle}>{t.status}</td>
                  <td style={tdStyle}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <Button variant="secondary" onClick={() => setSelected(t)}>
                        Detail
                      </Button>
                      {canUpdate && t.status === 'SCHEDULED' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/trips/${t.id}/start`, { method: 'POST' }), 'Trip started.', onNotice, onError, () => setReload((x) => x + 1))
                          }
                        >
                          Start
                        </Button>
                      )}
                      {canUpdate && t.status === 'ONGOING' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/trips/${t.id}/complete`, { method: 'POST' }), 'Trip completed.', onNotice, onError, () => setReload((x) => x + 1))
                          }
                        >
                          Complete
                        </Button>
                      )}
                      {canUpdate && (t.status === 'SCHEDULED' || t.status === 'ONGOING') && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/trips/${t.id}/cancel`, { method: 'POST', body: JSON.stringify({ reason: 'Cancelled from dashboard' }) }), 'Trip cancelled.', onNotice, onError, () => setReload((x) => x + 1))
                          }
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Pager skip={skip} take={50} total={total} onChange={setSkip} />
      </Card>
      {selected && <TripDetail trip={selected} canUpdate={canUpdate} onError={onError} onNotice={onNotice} />}
    </div>
  );
}

function TripDetail({ trip, canUpdate, onError, onNotice }: { trip: TripRow; canUpdate: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [detail, setDetail] = useState<TripRow | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      setDetail(await apiFetch<TripRow>(`/transport/trips/${trip.id}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load trip detail.');
    }
  }, [trip.id, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const checkpoint = async (ts: TripStopRow, field: string, value: string | boolean) => {
    await run(
      () => apiFetch(`/transport/trip-stops/${ts.id}/checkpoint`, { method: 'POST', body: JSON.stringify({ [field]: value }) }),
      'Checkpoint updated.',
      onNotice,
      onError,
      () => setReload((x) => x + 1),
    );
  };

  return (
    <Card>
      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>
        Trip {detail?.route?.code ?? ''} — {detail?.date ? fmtDate(detail.date) : ''}
      </h3>
      {detail && (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>#</th>
              <th style={thStyle}>Stop</th>
              <th style={thStyle}>Scheduled</th>
              <th style={thStyle}>Arrived</th>
              <th style={thStyle}>Departed</th>
              <th style={thStyle}>Boarded</th>
              <th style={thStyle}>Alighted</th>
              <th style={thStyle}>Skipped</th>
              {canUpdate && <th style={thStyle}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {(detail.tripStops ?? []).map((ts) => (
              <tr key={ts.id}>
                <td style={tdStyle}>{ts.order}</td>
                <td style={tdStyle}>{ts.stop?.name ?? ''}</td>
                <td style={tdStyle}>{ts.scheduledTime ? fmtTime(ts.scheduledTime) : '—'}</td>
                <td style={tdStyle}>{ts.actualArrivalAt ? fmtTime(ts.actualArrivalAt) : '—'}</td>
                <td style={tdStyle}>{ts.actualDepartureAt ? fmtTime(ts.actualDepartureAt) : '—'}</td>
                <td style={tdStyle}>{ts.studentsBoarded ?? '—'}</td>
                <td style={tdStyle}>{ts.studentsAlighted ?? '—'}</td>
                <td style={tdStyle}>{ts.skipped ? 'Yes' : 'No'}</td>
                {canUpdate && (
                  <td style={tdStyle}>
                    {detail.status === 'ONGOING' && (
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void checkpoint(ts, 'actualArrivalAt', new Date().toISOString())
                          }
                        >
                          Arrived
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void checkpoint(ts, 'actualDepartureAt', new Date().toISOString())}
                        >
                          Departed
                        </Button>
                        <Button variant="secondary" onClick={() => void checkpoint(ts, 'skipped', !ts.skipped)}>
                          {ts.skipped ? 'Unskip' : 'Skip'}
                        </Button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

// ── Maintenance ─────────────────────────────────────────────────────────────

function MaintenanceTab({ canCreate, canUpdate, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [rows, setRows] = useState<MaintenanceRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [status, setStatus] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50' });
      if (status) params.set('status', status);
      if (vehicleId) params.set('vehicleId', vehicleId);
      const r = await apiFetch<Paged<MaintenanceRow>>(`/transport/maintenance?${params.toString()}`);
      setRows(r.data);
      setTotal(r.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load maintenance records.');
    }
  }, [skip, status, vehicleId, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const save = async () => {
    await run(
      () =>
        apiFetch('/transport/maintenance', {
          method: 'POST',
          body: JSON.stringify({
            vehicleId: form.vehicleId,
            type: form.type,
            status: form.status || undefined,
            scheduledDate: form.scheduledDate || undefined,
            odometerKm: form.odometerKm ? Number(form.odometerKm) : undefined,
            description: form.description || undefined,
            vendor: form.vendor || undefined,
            costCents: form.costCents ? rupeesToCents(form.costCents) : undefined,
            performedBy: form.performedBy || undefined,
            notes: form.notes || undefined,
          }),
        }),
      'Maintenance record created.',
      onNotice,
      onError,
      () => {
        setCreating(false);
        setForm({});
      },
    );
    setReload((r) => r + 1);
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Maintenance</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select style={selectStyle} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">All vehicles</option>
            {lookups.vehicles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.registrationNumber}
              </option>
            ))}
          </select>
          <Opt options={lookups.maintenanceStatuses} value={status} onChange={setStatus} />
          {canCreate && (
            <Button variant="secondary" onClick={() => setCreating((c) => !c)}>
              New record
            </Button>
          )}
        </div>
      </div>
      {creating && (
        <div style={formRowStyle}>
          <Field label="Vehicle*">
            <select style={selectStyle} value={form.vehicleId ?? ''} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}>
              <option value="">—</option>
              {lookups.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type*">
            <select style={selectStyle} value={form.type ?? ''} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="">—</option>
              {lookups.maintenanceTypes.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Status">
            <select style={selectStyle} value={form.status ?? 'SCHEDULED'} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              {lookups.maintenanceStatuses.map((s) => (
                <option key={s} value={s}>
                  {s.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Scheduled date">
            <Input type="date" value={form.scheduledDate ?? ''} onChange={(e) => setForm((f) => ({ ...f, scheduledDate: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Odometer (km)">
            <Input value={form.odometerKm ?? ''} onChange={(e) => setForm((f) => ({ ...f, odometerKm: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Cost (₹)">
            <Input value={form.costCents ?? ''} onChange={(e) => setForm((f) => ({ ...f, costCents: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Vendor">
            <Input value={form.vendor ?? ''} onChange={(e) => setForm((f) => ({ ...f, vendor: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Performed by">
            <Input value={form.performedBy ?? ''} onChange={(e) => setForm((f) => ({ ...f, performedBy: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Description">
            <Input value={form.description ?? ''} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} style={inputStyle} />
          </Field>
          <Button variant="primary" onClick={() => void save()}>
            Create
          </Button>
          <Button variant="secondary" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Vehicle</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Scheduled</th>
              <th style={thStyle}>Odometer</th>
              <th style={thStyle}>Cost</th>
              <th style={thStyle}>Vendor</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td style={tdStyle}>
                  {m.vehicle?.registrationNumber ?? ''}
                  <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>
                    {m.vehicle?.make} {m.vehicle?.model}
                  </div>
                </td>
                <td style={tdStyle}>{m.type}</td>
                <td style={tdStyle}>{m.status}</td>
                <td style={tdStyle}>{fmtDate(m.scheduledDate)}</td>
                <td style={tdStyle}>{m.odometerKm ?? '—'}</td>
                <td style={tdStyle}>{m.costCents != null ? fmtCents(m.costCents) : '—'}</td>
                <td style={tdStyle}>{m.vendor ?? '—'}</td>
                <td style={tdStyle}>
                  {canUpdate && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {m.status === 'SCHEDULED' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/maintenance/${m.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'IN_PROGRESS' }) }), 'Marked in progress.', onNotice, onError, () => setReload((x) => x + 1))
                          }
                        >
                          Start
                        </Button>
                      )}
                      {m.status === 'IN_PROGRESS' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/maintenance/${m.id}/status`, { method: 'POST', body: JSON.stringify({ status: 'COMPLETED', notes: 'Completed on dashboards' }) }), 'Marked completed.', onNotice, onError, () => setReload((x) => x + 1))
                          }
                        >
                          Complete
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager skip={skip} take={50} total={total} onChange={setSkip} />
    </Card>
  );
}

// ── Alerts ──────────────────────────────────────────────────────────────────

function AlertsTab({ canCreate, canUpdate, onError, onNotice }: { canCreate: boolean; canUpdate: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const lookups = useLookups();
  const [rows, setRows] = useState<AlertRow[]>([]);
  const [total, setTotal] = useState(0);
  const [skip, setSkip] = useState(0);
  const [severity, setSeverity] = useState('');
  const [includeResolved, setIncludeResolved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ skip: String(skip), take: '50', includeResolved: includeResolved ? 'true' : 'false' });
      if (severity) params.set('severity', severity);
      const r = await apiFetch<Paged<AlertRow>>(`/transport/alerts?${params.toString()}`);
      setRows(r.data);
      setTotal(r.total);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load alerts.');
    }
  }, [skip, severity, includeResolved, onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const save = async () => {
    await run(
      () =>
        apiFetch('/transport/alerts', {
          method: 'POST',
          body: JSON.stringify({
            vehicleId: form.vehicleId || undefined,
            type: form.type,
            severity: form.severity,
            title: form.title,
            message: form.message,
          }),
        }),
      'Alert created.',
      onNotice,
      onError,
      () => {
        setCreating(false);
        setForm({});
      },
    );
    setReload((r) => r + 1);
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>Alerts</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <Opt options={lookups.alertSeverities} value={severity} onChange={setSeverity} />
          <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.8rem' }}>
            <input type="checkbox" checked={includeResolved} onChange={(e) => setIncludeResolved(e.target.checked)} />
            Include resolved
          </label>
          {canCreate && (
            <Button variant="secondary" onClick={() => setCreating((c) => !c)}>
              New alert
            </Button>
          )}
        </div>
      </div>
      {creating && (
        <div style={formRowStyle}>
          <Field label="Vehicle">
            <select style={selectStyle} value={form.vehicleId ?? ''} onChange={(e) => setForm((f) => ({ ...f, vehicleId: e.target.value }))}>
              <option value="">—</option>
              {lookups.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Type*">
            <select style={selectStyle} value={form.type ?? ''} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}>
              <option value="">—</option>
              {lookups.alertTypes.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Severity*">
            <select style={selectStyle} value={form.severity ?? ''} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
              <option value="">—</option>
              {lookups.alertSeverities.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title*">
            <Input value={form.title ?? ''} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} style={inputStyle} />
          </Field>
          <Field label="Message*">
            <Input value={form.message ?? ''} onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))} style={inputStyle} />
          </Field>
          <Button variant="primary" onClick={() => void save()}>
            Create
          </Button>
          <Button variant="secondary" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Created</th>
              <th style={thStyle}>Severity</th>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Title</th>
              <th style={thStyle}>Vehicle</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td style={tdStyle}>{fmtDate(a.createdAt)} {fmtTime(a.createdAt)}</td>
                <td style={tdStyle}><span style={{ fontWeight: a.severity === 'CRITICAL' ? 700 : undefined, color: a.severity === 'CRITICAL' ? '#b91c1c' : undefined }}>{a.severity}</span></td>
                <td style={tdStyle}>{a.type}</td>
                <td style={tdStyle}>
                  {a.title}
                  <div style={{ color: '#9ca3af', fontSize: '0.75rem' }}>{a.message}</div>
                </td>
                <td style={tdStyle}>{a.vehicle?.registrationNumber ?? '—'}</td>
                <td style={tdStyle}>{a.resolvedAt ? `Resolved ${fmtDate(a.resolvedAt)}` : a.acknowledgedAt ? 'Acknowledged' : 'Open'}</td>
                <td style={tdStyle}>
                  {canUpdate && (
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {!a.acknowledgedAt && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/alerts/${a.id}/acknowledge`, { method: 'POST', body: JSON.stringify({ note: 'Acknowledged on dashboard' }) }), 'Alert acknowledged.', onNotice, onError, () => setReload((x) => x + 1))
                          }
                        >
                          Ack
                        </Button>
                      )}
                      {!a.resolvedAt && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(() => apiFetch(`/transport/alerts/${a.id}/resolve`, { method: 'POST', body: JSON.stringify({ resolution: 'Resolved on dashboard' }) }), 'Alert resolved.', onNotice, onError, () => setReload((x) => x + 1))
                          }
                        >
                          Resolve
                        </Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pager skip={skip} take={50} total={total} onChange={setSkip} />
    </Card>
  );
}

// ── GPS ─────────────────────────────────────────────────────────────────────

function GpsTab({ canManage, onError, onNotice }: { canManage: boolean; onError: (m: string | null) => void; onNotice: (m: string | null) => void }) {
  const [config, setConfig] = useState<GpsConfigRow | null>(null);
  const [pollResult, setPollResult] = useState<{ written: number; providers: string[] } | null>(null);
  const [reload, setReload] = useState(0);

  const load = useCallback(async () => {
    try {
      setConfig(await apiFetch<GpsConfigRow>('/transport/gps/config'));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load GPS config (GPS entitlement may be disabled).');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load, reload]);

  const save = async () => {
    if (!config) return;
    await run(
      () =>
        apiFetch('/transport/gps/config', {
          method: 'PUT',
          body: JSON.stringify({
            provider: config.provider,
            enabled: config.enabled,
            pollEnabled: config.pollEnabled,
            pollIntervalSeconds: config.pollIntervalSeconds,
          }),
        }),
      'GPS config saved.',
      onNotice,
      onError,
      () => setReload((x) => x + 1),
    );
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>GPS tracking</h2>
      {!config ? (
        <p style={{ color: '#9ca3af' }}>Loading… (or GPS entitlement unavailable)</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={formRowStyle}>
            <Field label="Provider">
              <Input value={config.provider} onChange={(e) => setConfig((c) => (c ? { ...c, provider: e.target.value } : c))} style={inputStyle} />
            </Field>
            <Field label="Poll interval (s)">
              <Input
                type="number"
                value={String(config.pollIntervalSeconds)}
                onChange={(e) => setConfig((c) => (c ? { ...c, pollIntervalSeconds: Number(e.target.value) || 30 } : c))}
                style={inputStyle}
              />
            </Field>
            <Field label="Enabled">
              <select style={selectStyle} value={config.enabled ? 'true' : 'false'} onChange={(e) => setConfig((c) => (c ? { ...c, enabled: e.target.value === 'true' } : c))}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </Field>
            <Field label="Auto-poll">
              <select style={selectStyle} value={config.pollEnabled ? 'true' : 'false'} onChange={(e) => setConfig((c) => (c ? { ...c, pollEnabled: e.target.value === 'true' } : c))}>
                <option value="false">No</option>
                <option value="true">Yes</option>
              </select>
            </Field>
            {canManage && (
              <Button variant="primary" onClick={() => void save()}>
                Save
              </Button>
            )}
          </div>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
            Last poll: {config.lastPolledAt ? fmtDate(config.lastPolledAt) : 'Never'}
          </div>
          {canManage && (
            <div style={formRowStyle}>
              <Button
                variant="secondary"
                onClick={() =>
                  run(
                    () => apiFetch<{ written: number; providers: string[] }>('/transport/gps/poll', { method: 'POST' }),
                    'Poll complete.',
                    onNotice,
                    onError,
                    () => undefined,
                  ).then((r) => setPollResult(r ?? null))
                }
              >
                Poll now
              </Button>
              {pollResult && (
                <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                  Wrote {pollResult.written} fix(es) · providers: {pollResult.providers.join(', ')}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Reports ─────────────────────────────────────────────────────────────────

function ReportsTab({ onError }: { onError: (m: string | null) => void }) {
  const lookups = useLookups();
  const [routeLoad, setRouteLoad] = useState<RouteLoadReportRow[] | null>(null);
  const [utilization, setUtilization] = useState<VehicleUtilizationRow[] | null>(null);
  const [alerts, setAlerts] = useState<AlertsReport | null>(null);
  const [routeId, setRouteId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [date, setDate] = useState('');

  const loadAll = useCallback(async () => {
    onError(null);
    try {
      const [rl, vu, ar] = await Promise.all([
        apiFetch<RouteLoadReportRow[]>(`/transport/reports/route-load${date ? `?date=${date}` : ''}${routeId ? `${date ? '&' : '?'}routeId=${routeId}` : ''}`),
        apiFetch<VehicleUtilizationRow[]>(`/transport/reports/vehicle-utilization${vehicleId ? `?vehicleId=${vehicleId}` : ''}`),
        apiFetch<AlertsReport>('/transport/reports/alerts'),
      ]);
      setRouteLoad(rl);
      setUtilization(vu);
      setAlerts(ar);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load transport reports.');
    }
  }, [routeId, vehicleId, date, onError]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Transport reports</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
            <select style={selectStyle} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">All routes</option>
              {lookups.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code}
                </option>
              ))}
            </select>
            <select style={selectStyle} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              <option value="">All vehicles</option>
              {lookups.vehicles.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.registrationNumber}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => void loadAll()}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Route load</h3>
        {routeLoad && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Route</th>
                <th style={thStyle}>Allocated</th>
                <th style={thStyle}>Trips today</th>
                <th style={thStyle}>Trip statuses</th>
                <th style={thStyle}>Per stop</th>
              </tr>
            </thead>
            <tbody>
              {routeLoad.map((r) => (
                <tr key={r.routeId}>
                  <td style={tdStyle}>
                    {r.code} · {r.name}
                  </td>
                  <td style={tdStyle}>{r.allocated}</td>
                  <td style={tdStyle}>{r.tripsToday}</td>
                  <td style={tdStyle}>{Object.entries(r.tripStatuses).map(([k, v]) => `${k}: ${v}`).join(', ') || '—'}</td>
                  <td style={tdStyle}>{r.perStop.map((s) => `${s.name} (${s.allocated})`).join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Vehicle utilization</h3>
        {utilization && (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Vehicle</th>
                <th style={thStyle}>Type</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Trips</th>
                <th style={thStyle}>Completed</th>
                <th style={thStyle}>Maint. cost</th>
                <th style={thStyle}>GPS</th>
              </tr>
            </thead>
            <tbody>
              {utilization.map((v) => (
                <tr key={v.vehicleId}>
                  <td style={tdStyle}>{v.registrationNumber}</td>
                  <td style={tdStyle}>{v.type}</td>
                  <td style={tdStyle}>{v.status}</td>
                  <td style={tdStyle}>{v.trips}</td>
                  <td style={tdStyle}>{v.completedTrips}</td>
                  <td style={tdStyle}>{fmtCents(v.maintenanceCostCents)}</td>
                  <td style={tdStyle}>{v.gpsTracked ? 'Yes' : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Open alerts (by severity/type)</h3>
        {alerts && (
          <>
            <div style={formRowStyle}>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>By severity: </span>
                {alerts.bySeverity.map((s) => `${s.severity} (${s._count._all})`).join(', ') || 'None'}
              </div>
              <div>
                <span style={{ fontSize: '0.8rem', color: '#6b7280' }}>By type: </span>
                {alerts.byType.map((t) => `${t.type} (${t._count._all})`).join(', ') || 'None'}
              </div>
            </div>
            <table style={{ ...tableStyle, marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Severity</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Title</th>
                  <th style={thStyle}>Vehicle</th>
                </tr>
              </thead>
              <tbody>
                {alerts.recent.map((a) => (
                  <tr key={a.id}>
                    <td style={tdStyle}>{fmtDate(a.createdAt)} {fmtTime(a.createdAt)}</td>
                    <td style={tdStyle}>{a.severity}</td>
                    <td style={tdStyle}>{a.type}</td>
                    <td style={tdStyle}>{a.title}</td>
                    <td style={tdStyle}>{a.vehicle?.registrationNumber ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Card>
    </div>
  );
}