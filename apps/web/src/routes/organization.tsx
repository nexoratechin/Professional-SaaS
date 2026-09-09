import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch, apiFetchPaged } from '../lib/http';

// ── Entity registry (mirrors the API's ENTITY_META; the server remains the source of truth) ──

interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'bool' | 'select';
  options?: string[];
  refEntity?: string;
}

interface EntityDef {
  label: string;
  viewKey: string;
  manageKey: string;
  fields: FieldDef[];
}

const ROOM_TYPES = ['CLASSROOM', 'LABORATORY', 'SEMINAR_HALL', 'AUDITORIUM', 'LIBRARY', 'OFFICE', 'OTHER'];
const DEGREE_LEVELS = ['DIPLOMA', 'BACHELORS', 'MASTERS', 'DOCTORATE', 'OTHER'];

const ORG_ENTITIES: Record<string, EntityDef> = {
  campus: {
    label: 'Campuses',
    viewKey: 'campuses.read',
    manageKey: 'campuses.manage',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'addressLine', label: 'Address line' },
      { key: 'city', label: 'City' },
      { key: 'state', label: 'State' },
      { key: 'country', label: 'Country' },
      { key: 'isActive', label: 'Active', type: 'bool' },
    ],
  },
  department: {
    label: 'Departments',
    viewKey: 'departments.read',
    manageKey: 'departments.manage',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'description', label: 'Description' },
      { key: 'campusId', label: 'Campus', refEntity: 'campus' },
      { key: 'isActive', label: 'Active', type: 'bool' },
    ],
  },
  program: {
    label: 'Programs',
    viewKey: 'programs.read',
    manageKey: 'programs.manage',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'degreeLevel', label: 'Degree level', type: 'select', options: DEGREE_LEVELS },
      { key: 'durationYears', label: 'Duration (years)', type: 'number' },
      { key: 'departmentId', label: 'Department', refEntity: 'department' },
      { key: 'isActive', label: 'Active', type: 'bool' },
    ],
  },
  academicYear: {
    label: 'Academic years',
    viewKey: 'academicYears.read',
    manageKey: 'academicYears.manage',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'startDate', label: 'Start date', type: 'date' },
      { key: 'endDate', label: 'End date', type: 'date' },
      { key: 'isCurrent', label: 'Current', type: 'bool' },
    ],
  },
  term: {
    label: 'Terms',
    viewKey: 'terms.read',
    manageKey: 'terms.manage',
    fields: [
      { key: 'academicYearId', label: 'Academic year', refEntity: 'academicYear' },
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'sequence', label: 'Sequence', type: 'number' },
      { key: 'startDate', label: 'Start date', type: 'date' },
      { key: 'endDate', label: 'End date', type: 'date' },
      { key: 'isCurrent', label: 'Current', type: 'bool' },
    ],
  },
  room: {
    label: 'Rooms',
    viewKey: 'rooms.read',
    manageKey: 'rooms.manage',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'campusId', label: 'Campus', refEntity: 'campus' },
      { key: 'buildingId', label: 'Building', refEntity: 'building' },
      { key: 'roomType', label: 'Type', type: 'select', options: ROOM_TYPES },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'floor', label: 'Floor', type: 'number' },
      { key: 'isActive', label: 'Active', type: 'bool' },
    ],
  },
  building: {
    label: 'Buildings',
    viewKey: 'buildings.read',
    manageKey: 'buildings.manage',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'campusId', label: 'Campus', refEntity: 'campus' },
      { key: 'addressLine', label: 'Address line' },
      { key: 'isActive', label: 'Active', type: 'bool' },
    ],
  },
  section: {
    label: 'Sections',
    viewKey: 'sections.read',
    manageKey: 'sections.manage',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'programId', label: 'Program', refEntity: 'program' },
      { key: 'academicYearId', label: 'Academic year', refEntity: 'academicYear' },
      { key: 'capacity', label: 'Capacity', type: 'number' },
      { key: 'isActive', label: 'Active', type: 'bool' },
    ],
  },
  batch: {
    label: 'Batches',
    viewKey: 'batches.read',
    manageKey: 'batches.manage',
    fields: [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Name' },
      { key: 'programId', label: 'Program', refEntity: 'program' },
      { key: 'academicYearId', label: 'Academic year', refEntity: 'academicYear' },
      { key: 'startDate', label: 'Start date', type: 'date' },
      { key: 'endDate', label: 'End date', type: 'date' },
      { key: 'isActive', label: 'Active', type: 'bool' },
    ],
  },
};

type Row = Record<string, unknown> & { id: string; code?: string; name?: string; isActive?: boolean };

const TAKE = 20;

export function OrganizationPage() {
  const { permissions } = useAuth();
  const [entity, setEntity] = useState('campus');
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [isActive, setIsActive] = useState('');
  const [skip, setSkip] = useState(0);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [showHierarchy, setShowHierarchy] = useState(false);

  const def = ORG_ENTITIES[entity] as EntityDef;
  const canView = permissions.includes(def.viewKey);
  const canManage = permissions.includes(def.manageKey);

  const refFields = useMemo(() => def.fields.filter((f) => f.refEntity), [def]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ skip: String(skip), take: String(TAKE) });
      if (q) params.set('q', q);
      if (isActive) params.set('isActive', isActive);
      const { data, total: t } = await apiFetchPaged<Row[]>(`/organization/${entity}?${params.toString()}`);
      setRows(data);
      setTotal(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [entity, q, isActive, skip]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canView) {
    return (
      <div style={{ maxWidth: 720, margin: '2rem auto' }}>
        <Card>
          <p style={{ color: '#9ca3af' }}>You don't have permission to view this organization data.</p>
        </Card>
      </div>
    );
  }

  const reload = () => {
    setSkip(0);
    void load();
  };

  const goEntity = (e: string) => {
    setEntity(e);
    setSkip(0);
    setQ('');
    setIsActive('');
    setEditing(null);
    setCreating(false);
    setShowHierarchy(false);
  };

  const save = async (payload: Record<string, unknown>) => {
    setError(null);
    setNotice(null);
    try {
      if (editing) {
        await apiFetch(`/organization/${entity}/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setNotice(`Updated ${label(entity)}.`);
      } else {
        await apiFetch(`/organization/${entity}`, { method: 'POST', body: JSON.stringify(payload) });
        setNotice(`Created ${label(entity)}.`);
      }
      setEditing(null);
      setCreating(false);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  const archive = async (row: Row) => {
    if (!window.confirm(`Archive "${row.name ?? row.code}"?`)) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/organization/${entity}/${row.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed.');
    }
  };

  const exportCsv = async () => {
    setError(null);
    setNotice(null);
    try {
      const params = new URLSearchParams({ entity });
      if (q) params.set('q', q);
      if (isActive) params.set('isActive', isActive);
      const res = await apiFetch<{ csv: string; count: number; filename: string }>(
        `/organization/export?${params.toString()}`,
      );
      const blob = new Blob([res.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${res.count} row(s) to ${res.filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  return (
    <div style={{ maxWidth: 960, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Organization</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setShowHierarchy((s) => !s)}>Hierarchy</Button>
          <Button variant="secondary" onClick={() => void exportCsv()}>Export CSV</Button>
          {/* The API is JSON-only; CSV import is available to managers */}
          {canManage && <Button onClick={() => setCreating(true)}>New {label(entity)}</Button>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {Object.entries(ORG_ENTITIES).map(([key, d]) => (
          <Button
            key={key}
            variant={key === entity ? 'primary' : 'secondary'}
            onClick={() => goEntity(key)}
            disabled={!permissions.includes(d.viewKey)}
          >
            {d.label}
          </Button>
        ))}
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {showHierarchy && <HierarchyView onClose={() => setShowHierarchy(false)} />}

      {(creating || editing) && canManage && (
        <EntityForm
          entity={entity}
          fields={def.fields}
          refFields={refFields}
          initial={editing}
          onSave={save}
          onCancel={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      <Card>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', marginBottom: 12, flexWrap: 'wrap' }}>
          <div style={{ width: 240 }}>
            <Input label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="code, name…" />
          </div>
          <div style={{ width: 160 }}>
            <label style={{ display: 'block', fontSize: '0.85rem', color: '#374151', marginBottom: 4 }}>Active</label>
            <select
              value={isActive}
              onChange={(e) => setIsActive(e.target.value)}
              style={{ width: '100%', padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
            >
              <option value="">All</option>
              <option value="true">Active</option>
              <option value="false">Archived</option>
            </select>
          </div>
          <Button variant="secondary" onClick={() => void load()}>Apply</Button>
          <span style={{ marginLeft: 'auto', fontSize: '0.85rem', color: '#6b7280' }}>{total} row(s)</span>
        </div>

        {loading && <p>Loading…</p>}

        {!loading && rows.length === 0 && <p style={{ color: '#9ca3af' }}>No {def.label.toLowerCase()} found.</p>}

        {!loading && rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{row.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>{row.name ?? '—'}</td>
                  <td style={{ padding: 8 }}>{row.isActive === false ? 'Archived' : 'Active'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {canManage && (
                      <Button variant="secondary" onClick={() => setEditing(row)} style={{ marginRight: 8 }}>
                        Edit
                      </Button>
                    )}
                    {canManage && (
                      <Button variant="secondary" onClick={() => void archive(row)}>Archive</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, alignItems: 'center' }}>
          <Button variant="secondary" disabled={skip === 0 || loading} onClick={() => setSkip(Math.max(0, skip - TAKE))}>
            Previous
          </Button>
          <span style={{ fontSize: '0.85rem', color: '#6b7280' }}>
            {skip + 1}–{Math.min(skip + TAKE, total)} of {total}
          </span>
          <Button variant="secondary" disabled={skip + TAKE >= total || loading} onClick={() => setSkip(skip + TAKE)}>
            Next
          </Button>
        </div>
      </Card>

      {canManage && <ImportPanel entity={entity} label={def.label} onDone={reload} onError={setError} onNotice={setNotice} />}
    </div>
  );
}

// ── Form ─────────────────────────────────────────────────────────────────────

function EntityForm({
  entity,
  fields,
  refFields,
  initial,
  onSave,
  onCancel,
}: {
  entity: string;
  fields: FieldDef[];
  refFields: FieldDef[];
  initial: Row | null;
  onSave: (payload: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const v: Record<string, unknown> = {};
    for (const f of fields) {
      const existing = initial?.[f.key];
      if (existing !== undefined && existing !== null) {
        v[f.key] = f.type === 'date' && existing instanceof Date ? existing.toISOString().slice(0, 10) : existing;
      } else if (f.type === 'bool') {
        v[f.key] = initial ? (existing ?? false) : true;
      }
    }
    return v;
  });
  const [options, setOptions] = useState<Record<string, Array<{ value: string; label: string }>>>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: Record<string, Array<{ value: string; label: string }>> = {};
      for (const f of refFields) {
        try {
          const data = await apiFetchPaged<Row[]>(`/organization/${f.refEntity}?skip=0&take=500`);
          next[f.key] = data.data.map((r) => ({ value: r.id, label: `${r.code ?? ''} — ${r.name ?? ''}` }));
        } catch {
          next[f.key] = [];
        }
      }
      if (!cancelled) setOptions(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [refFields]);

  const submit = async () => {
    setBusy(true);
    try {
      await onSave(values);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>{initial ? `Edit ${label(entity)}` : `New ${label(entity)}`}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {fields.map((f) => {
          if (f.refEntity) {
            return (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.85rem', color: '#374151' }}>{f.label}</span>
                <select
                  value={(values[f.key] as string) ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value || null }))}
                  style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
                >
                  <option value="">— none —</option>
                  {(options[f.key] ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
            );
          }
          if (f.type === 'bool') {
            return (
              <label key={f.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={values[f.key] === true}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.checked }))}
                />
                {f.label}
              </label>
            );
          }
          if (f.type === 'select') {
            return (
              <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: '0.85rem', color: '#374151' }}>{f.label}</span>
                <select
                  value={(values[f.key] as string) ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.key]: e.target.value || null }))}
                  style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
                >
                  <option value="">— none —</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </label>
            );
          }
          return (
            <Input
              key={f.key}
              label={f.label}
              type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
              value={(values[f.key] as string) ?? ''}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  [f.key]: f.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value,
                }))
              }
            />
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <Button onClick={() => void submit()} disabled={busy}>Save</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </Card>
  );
}

// ── Import panel ─────────────────────────────────────────────────────────────

function ImportPanel({
  entity,
  label: entityLabel,
  onDone,
  onError,
  onNotice,
}: {
  entity: string;
  label: string;
  onDone: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [csv, setCsv] = useState('');
  const [mode, setMode] = useState<'validate' | 'upsert'>('upsert');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    total: number;
    valid: number;
    inserted: number;
    updated: number;
    errors: Array<{ row: number; code: string; error?: string }>;
  } | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    onError(null);
    onNotice(null);
    try {
      const res = await apiFetch<{
        total: number;
        valid: number;
        inserted: number;
        updated: number;
        errors: Array<{ row: number; code: string; error?: string }>;
      }>('/organization/import', {
        method: 'POST',
        body: JSON.stringify({ entity, csv, mode }),
      });
      setResult(res);
      onNotice(`Import (${mode}): ${res.inserted} inserted, ${res.updated} updated, ${res.errors.length} error(s).`);
      if (mode === 'upsert' && res.errors.length === 0) onDone();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Import {entityLabel} CSV</h2>
      <p style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: 8 }}>
        Paste rows with a header line. Parent references (like campus, program) are matched by their code.
      </p>
      <textarea
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        placeholder={'code,name,isActive\nC1,Main Campus,true\nC2,North Campus,false'}
        rows={5}
        style={{ width: '100%', boxSizing: 'border-box', padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db', fontFamily: 'monospace', fontSize: '0.85rem' }}
      />
      <div style={{ display: 'flex', gap: 12, marginTop: 8, alignItems: 'center' }}>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as 'validate' | 'upsert')}
          style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
        >
          <option value="upsert">Upsert (insert or update)</option>
          <option value="validate">Validate only (dry run)</option>
        </select>
        <Button onClick={() => void run()} disabled={busy || csv.trim() === ''}>Run import</Button>
      </div>
      {result && (
        <div style={{ marginTop: 12, fontSize: '0.9rem' }}>
          <p>Rows: {result.total} · Valid: {result.valid} · Inserted: {result.inserted} · Updated: {result.updated} · Errors: {result.errors.length}</p>
          {result.errors.length > 0 && (
            <ul style={{ fontSize: '0.85rem', color: '#b91c1c' }}>
              {result.errors.slice(0, 10).map((e, i) => (
                <li key={i}>Row {e.row} ({e.code || '?'}): {e.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Hierarchy ────────────────────────────────────────────────────────────────

function HierarchyView({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<{
    campuses: Array<{
      code?: string;
      name?: string;
      buildings?: Array<{ code?: string; name?: string }>;
      rooms?: Array<{ code?: string; name?: string }>;
      departments?: Array<{
        code?: string;
        name?: string;
        programs?: Array<{
          code?: string;
          name?: string;
          sections?: Array<{ code?: string; name?: string }>;
          batches?: Array<{ code?: string; name?: string }>;
        }>;
      }>;
    }>;
    academicYears: Array<{ code?: string; name?: string; terms?: Array<{ code?: string; name?: string }> }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await apiFetch('/organization/hierarchy'));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load hierarchy.');
      }
    })();
  }, []);

  if (error) return <Card><p style={{ color: '#b91c1c' }}>{error}</p></Card>;
  if (!data) return <Card><p>Loading hierarchy…</p></Card>;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ fontSize: '1rem' }}>Organization hierarchy</h2>
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 12, fontSize: '0.9rem' }}>
        <div>
          <p style={{ fontWeight: 600 }}>Campuses (academic tree)</p>
          <ul>{data.campuses.map((c) => (
            <li key={c.code}>
              {c.name} ({c.code})
              <ul>
                {c.buildings?.map((b) => <li key={b.code}>Building: {b.name} ({b.code})</li>)}
                {c.rooms?.map((r) => <li key={r.code}>Room: {r.name} ({r.code})</li>)}
                {c.departments?.map((d) => (
                  <li key={d.code}>
                    {d.name} ({d.code})
                    <ul>
                      {d.programs?.map((p) => (
                        <li key={p.code}>
                          {p.name} ({p.code})
                          <ul>
                            {p.sections?.map((s) => <li key={s.code}>Section: {s.name} ({s.code})</li>)}
                            {p.batches?.map((s) => <li key={s.code}>Batch: {s.name} ({s.code})</li>)}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          </ul>
        </div>
        <div>
          <p style={{ fontWeight: 600 }}>Academic years (terms)</p>
          <ul>{data.academicYears.map((y) => (
            <li key={y.code}>
              {y.name} ({y.code})
              <ul>
                {y.terms?.map((t) => <li key={t.code}>{t.name} ({t.code})</li>)}
              </ul>
            </li>
          ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

function label(entity: string): string {
  return ORG_ENTITIES[entity]?.label.replace(/s$/, '') ?? entity;
}