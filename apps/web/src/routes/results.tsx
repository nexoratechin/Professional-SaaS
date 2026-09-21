import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { selectStyle } from './academics-shared';
import { Paged } from './exams-shared';
import { GradeBand, GradingSchemeRow, PASS_MODES, WEIGHTING_MODES } from './results-shared';
import { SessionResultsTab } from './results-session';
import { StudentsTab } from './results-students';

export const VIEW_PERMISSION = 'results.view';
export const MANAGE_PERMISSION = 'results.manage';
export const PUBLISH_PERMISSION = 'results.publish';
export const EXPORT_PERMISSION = 'results.export';

type Tab = 'schemes' | 'session' | 'students';

const optNum = (s: string): number | undefined => (s === '' ? undefined : Number(s));
const numOrErr = (s: string): number | null => (s === '' || Number.isNaN(Number(s)) ? null : Number(s));

export function ResultsPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<Tab>('schemes');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canManage = permissions.includes(MANAGE_PERMISSION);
  const canPublish = permissions.includes(PUBLISH_PERMISSION);
  const canExport = permissions.includes(EXPORT_PERMISSION);

  return (
    <div style={{ maxWidth: 1150, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Results</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('schemes')}>Grading schemes</Button>
          <Button variant="secondary" onClick={() => setTab('session')}>Session results</Button>
          <Button variant="secondary" onClick={() => setTab('students')}>Student summaries</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'schemes' && <GradingSchemesTab canManage={canManage} onError={setError} onNotice={setNotice} />}
      {tab === 'session' && (
        <SessionResultsTab
          canManage={canManage}
          canPublish={canPublish}
          canExport={canExport}
          onError={setError}
          onNotice={setNotice}
        />
      )}
      {tab === 'students' && <StudentsTab onError={setError} onNotice={setNotice} />}
    </div>
  );
}

function GradingSchemesTab({
  canManage,
  onError,
  onNotice,
}: {
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [rows, setRows] = useState<GradingSchemeRow[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<GradingSchemeRow | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<Paged<GradingSchemeRow>>('/results/grading-schemes?take=100');
      setRows(res.items);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load grading schemes.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const bootstrap = async () => {
    try {
      await apiFetch<GradingSchemeRow>('/results/grading-schemes/default');
      onNotice('Default grading scheme ensured.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to ensure default scheme.');
    }
  };

  const create = async () => {
    if (!code.trim() || !name.trim()) {
      onError('Code and name are required.');
      return;
    }
    try {
      await apiFetch('/results/grading-schemes', {
        method: 'POST',
        body: JSON.stringify({ code: code.trim(), name: name.trim() }),
      });
      setShowForm(false);
      setCode('');
      setName('');
      onNotice('Grading scheme created.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create scheme.');
    }
  };

  const openEditor = async (id: string) => {
    try {
      setEditing(await apiFetch<GradingSchemeRow>(`/results/grading-schemes/${id}`));
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load scheme.');
    }
  };

  const makeDefault = async (id: string) => {
    try {
      await apiFetch(`/results/grading-schemes/${id}/default`, { method: 'POST', body: JSON.stringify({}) });
      onNotice('Scheme set as default.');
      onError(null);
      void load();
      if (editing?.id === id) setEditing(await apiFetch<GradingSchemeRow>(`/results/grading-schemes/${id}`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to set default scheme.');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Delete this grading scheme?')) return;
    try {
      await apiFetch(`/results/grading-schemes/${id}`, { method: 'DELETE' });
      onNotice('Grading scheme deleted.');
      onError(null);
      if (editing?.id === id) setEditing(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to delete scheme.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Grading schemes</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {canManage && <Button variant="secondary" onClick={() => void bootstrap()}>Ensure default</Button>}
            {canManage && <Button onClick={() => setShowForm((s) => !s)}>New scheme</Button>}
          </div>
        </div>

        {showForm && canManage && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" style={{ width: 140 }} />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ flex: 1, minWidth: 200 }} />
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              style={{ flex: 1, minWidth: 200 }}
            />
            <Button onClick={() => void create()}>Save</Button>
          </div>
        )}

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No grading schemes yet — run “Ensure default” to bootstrap one.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Mode</th>
                <th style={{ padding: 8 }}>Pass</th>
                <th style={{ padding: 8 }}>Bands</th>
                <th style={{ padding: 8 }}>Default</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{s.code}</td>
                  <td style={{ padding: 8 }}>{s.name}</td>
                  <td style={{ padding: 8 }}>{s.passMode} / {s.weightingMode}</td>
                  <td style={{ padding: 8 }}>
                    {s.passMode === 'PERCENTAGE' ? `${s.minPassPercent ?? '—'}%` : s.minPassGradePoint ?? '—'}
                  </td>
                  <td style={{ padding: 8 }}>{s.gradeScale?.length ?? 0}</td>
                  <td style={{ padding: 8 }}>{s.isDefault ? 'Yes' : '—'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void openEditor(s.id)}>Edit</Button>
                    {!s.isDefault && canManage && (
                      <>
                        <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void makeDefault(s.id)}>Set default</Button>
                        <Button variant="secondary" onClick={() => void remove(s.id)}>Delete</Button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editing && (
        <SchemeEditor
          scheme={editing}
          canManage={canManage}
          onClose={() => setEditing(null)}
          onChanged={() => void load()}
          onError={onError}
          onNotice={onNotice}
        />
      )}
    </>
  );
}

function SchemeEditor({
  scheme,
  canManage,
  onClose,
  onChanged,
  onError,
  onNotice,
}: {
  scheme: GradingSchemeRow;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [name, setName] = useState(scheme.name);
  const [description, setDescription] = useState(scheme.description ?? '');
  const [passMode, setPassMode] = useState<string>(scheme.passMode ?? 'PERCENTAGE');
  const [minPassPercent, setMinPassPercent] = useState(scheme.minPassPercent == null ? '' : String(scheme.minPassPercent));
  const [minPassGradePoint, setMinPassGradePoint] = useState(scheme.minPassGradePoint == null ? '' : String(scheme.minPassGradePoint));
  const [weightingMode, setWeightingMode] = useState<string>(scheme.weightingMode ?? 'CREDIT_WEIGHTED');
  const [gpaMax, setGpaMax] = useState(String(scheme.gpaMax ?? 10));
  const [graceEnabled, setGraceEnabled] = useState(scheme.graceEnabled);
  const [maxGraceMarks, setMaxGraceMarks] = useState(String(scheme.maxGraceMarks ?? 0));
  const [graceToPassDiff, setGraceToPassDiff] = useState(String(scheme.graceToPassDiff ?? 0));
  const [roundingDecimals, setRoundingDecimals] = useState(String(scheme.roundingDecimals ?? 2));
  const [isActive, setIsActive] = useState(scheme.isActive);
  const [bands, setBands] = useState<GradeBand[]>(scheme.gradeScale ?? []);

  const updateBand = (index: number, patch: Partial<GradeBand>) => {
    setBands((cur) => cur.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  };

  const save = async () => {
    try {
      await apiFetch(`/results/grading-schemes/${scheme.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: name.trim() || undefined,
          description: description.trim() || undefined,
          passMode,
          minPassPercent: optNum(minPassPercent),
          minPassGradePoint: optNum(minPassGradePoint),
          weightingMode,
          gpaMax: optNum(gpaMax) ?? 10,
          graceEnabled,
          maxGraceMarks: optNum(maxGraceMarks) ?? 0,
          graceToPassDiff: optNum(graceToPassDiff) ?? 0,
          roundingDecimals: numOrErr(roundingDecimals) ?? 2,
          isActive,
        }),
      });
      onNotice('Grading scheme updated.');
      onError(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to update scheme.');
    }
  };

  const saveScale = async () => {
    const items = bands
      .filter((b) => b.grade.trim() !== '')
      .map((b) => ({
        grade: b.grade.trim(),
        minPercent: b.minPercent,
        maxPercent: b.maxPercent,
        gradePoint: b.gradePoint,
        gradeDescription: b.gradeDescription?.trim() || undefined,
      }));
    if (items.length === 0) {
      onError('Add at least one grade band.');
      return;
    }
    try {
      await apiFetch(`/results/grading-schemes/${scheme.id}/scale`, {
        method: 'PUT',
        body: JSON.stringify({ items }),
      });
      onNotice('Grade scale replaced.');
      onError(null);
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save grade scale.');
    }
  };

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <h2 style={{ fontSize: '1rem' }}>{scheme.code} — {scheme.name}</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          {canManage && <Button onClick={() => void save()}>Save scheme</Button>}
          {canManage && <Button variant="secondary" onClick={() => void saveScale()}>Save scale</Button>}
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ flex: 1, minWidth: 180 }} />
        <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" style={{ flex: 1, minWidth: 180 }} />
        <select value={passMode} onChange={(e) => setPassMode(e.target.value)} style={selectStyle}>
          {PASS_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <Input value={minPassPercent} onChange={(e) => setMinPassPercent(e.target.value)} placeholder="Min pass %" type="number" style={{ width: 110 }} />
        <Input value={minPassGradePoint} onChange={(e) => setMinPassGradePoint(e.target.value)} placeholder="Min pass GP" type="number" style={{ width: 110 }} />
        <select value={weightingMode} onChange={(e) => setWeightingMode(e.target.value)} style={selectStyle}>
          {WEIGHTING_MODES.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
        <Input value={gpaMax} onChange={(e) => setGpaMax(e.target.value)} placeholder="GPA max" type="number" style={{ width: 90 }} />
        <Input value={roundingDecimals} onChange={(e) => setRoundingDecimals(e.target.value)} placeholder="Decimals" type="number" style={{ width: 90 }} />
      </div>

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12, fontSize: '0.9rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={graceEnabled} onChange={(e) => setGraceEnabled(e.target.checked)} />
          Grace enabled
        </label>
        <Input value={maxGraceMarks} onChange={(e) => setMaxGraceMarks(e.target.value)} placeholder="Max grace" type="number" style={{ width: 100 }} />
        <Input value={graceToPassDiff} onChange={(e) => setGraceToPassDiff(e.target.value)} placeholder="Grace diff" type="number" style={{ width: 100 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Active
        </label>
      </div>

      <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Grade scale</h3>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: 8 }}>Grade</th>
            <th style={{ padding: 8 }}>Min %</th>
            <th style={{ padding: 8 }}>Max %</th>
            <th style={{ padding: 8 }}>Point</th>
            <th style={{ padding: 8 }}>Description</th>
            {canManage && <th style={{ padding: 8, textAlign: 'right' }}></th>}
          </tr>
        </thead>
        <tbody>
          {bands.map((b, i) => (
            <tr key={b.id || i} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: 6 }}>
                <Input value={b.grade} disabled={!canManage} onChange={(e) => updateBand(i, { grade: e.target.value })} style={{ width: 80 }} />
              </td>
              <td style={{ padding: 6 }}>
                <Input
                  value={b.minPercent}
                  disabled={!canManage}
                  type="number"
                  onChange={(e) => updateBand(i, { minPercent: Number(e.target.value) })}
                  style={{ width: 90 }}
                />
              </td>
              <td style={{ padding: 6 }}>
                <Input
                  value={b.maxPercent}
                  disabled={!canManage}
                  type="number"
                  onChange={(e) => updateBand(i, { maxPercent: Number(e.target.value) })}
                  style={{ width: 90 }}
                />
              </td>
              <td style={{ padding: 6 }}>
                <Input
                  value={b.gradePoint}
                  disabled={!canManage}
                  type="number"
                  onChange={(e) => updateBand(i, { gradePoint: Number(e.target.value) })}
                  style={{ width: 90 }}
                />
              </td>
              <td style={{ padding: 6 }}>
                <Input
                  value={b.gradeDescription ?? ''}
                  disabled={!canManage}
                  onChange={(e) => updateBand(i, { gradeDescription: e.target.value })}
                  style={{ width: 180 }}
                />
              </td>
              {canManage && (
                <td style={{ padding: 6, textAlign: 'right' }}>
                  <Button variant="secondary" onClick={() => setBands((cur) => cur.filter((_, x) => x !== i))}>Remove</Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {canManage && (
        <Button
          variant="secondary"
          style={{ marginTop: 8 }}
          onClick={() =>
            setBands((cur) => [
              ...cur,
              { id: `band-${cur.length}-${Date.now()}`, grade: '', minPercent: 0, maxPercent: 100, gradePoint: 0, gradeDescription: '' },
            ])
          }
        >
          Add band
        </Button>
      )}
    </Card>
  );
}