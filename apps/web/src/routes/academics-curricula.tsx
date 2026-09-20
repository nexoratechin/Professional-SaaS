import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import { IdName, selectStyle, useEntityList } from './academics-shared';

interface CurriculumRow {
  id: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  program?: IdName | null;
  _count?: Record<string, number>;
}

interface VersionRow {
  id: string;
  versionNumber: number;
  name?: string | null;
  status: string;
  isCurrent: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  minTotalCredits?: number | null;
  courses?: VersionCourseRow[];
}

interface VersionCourseRow {
  id: string;
  semester: number;
  isCompulsory: boolean;
  creditOverride?: number | null;
  minGrade?: string | null;
  course?: IdName & { creditHours?: number | null };
}

interface ValidateReport {
  summary: { totalCredits: number; semesters: number; warnings: string[] };
  warnings: string[];
}

export function CurriculaTab({
  canCreate,
  canManage,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const programs = useEntityList('programs');
  const [rows, setRows] = useState<CurriculumRow[]>([]);
  const [selected, setSelected] = useState<CurriculumRow | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [openVersion, setOpenVersion] = useState<VersionRow | null>(null);
  const [validateReport, setValidateReport] = useState<ValidateReport | null>(null);

  const [showForm, setShowForm] = useState(false);
  const [programId, setProgramId] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  const [versionName, setVersionName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [minTotalCredits, setMinTotalCredits] = useState('');

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: CurriculumRow[]; total: number }>('/academics/curricula?take=100');
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load curricula.');
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadVersions = useCallback(
    async (curriculumId: string) => {
      try {
        setVersions(await apiFetch<VersionRow[]>(`/academics/curricula/${curriculumId}/versions`));
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load versions.');
      }
    },
    [onError],
  );

  const selectCurriculum = (c: CurriculumRow) => {
    setSelected(c);
    setOpenVersion(null);
    setValidateReport(null);
    void loadVersions(c.id);
  };

  const create = async () => {
    if (!programId || !code.trim() || !name.trim()) {
      onError('Program, code and name are required.');
      return;
    }
    try {
      await apiFetch('/academics/curricula', {
        method: 'POST',
        body: JSON.stringify({ programId, code: code.trim(), name: name.trim(), description: description || undefined }),
      });
      setShowForm(false);
      setProgramId('');
      setCode('');
      setName('');
      setDescription('');
      onNotice('Curriculum created.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create curriculum.');
    }
  };

  const archive = async (id: string) => {
    try {
      await apiFetch(`/academics/curricula/${id}/archive`, { method: 'POST' });
      onNotice('Curriculum archived.');
      onError(null);
      if (selected?.id === id) setSelected(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to archive curriculum.');
    }
  };

  const createVersion = async () => {
    if (!selected) return;
    try {
      await apiFetch(`/academics/curricula/${selected.id}/versions`, {
        method: 'POST',
        body: JSON.stringify({
          name: versionName || undefined,
          effectiveFrom: effectiveFrom || undefined,
          minTotalCredits: minTotalCredits ? Number(minTotalCredits) : undefined,
        }),
      });
      setVersionName('');
      setEffectiveFrom('');
      setMinTotalCredits('');
      onNotice('Version created.');
      onError(null);
      void loadVersions(selected.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create version.');
    }
  };

  const openVersionCourses = async (v: VersionRow) => {
    try {
      const full = await apiFetch<VersionRow>(`/academics/curriculum-versions/${v.id}`);
      setOpenVersion(full);
      setValidateReport(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load version.');
    }
  };

  const runVersion = async (v: VersionRow, action: 'activate' | 'archive', msg: string) => {
    try {
      await apiFetch(`/academics/curriculum-versions/${v.id}/${action}`, { method: 'POST' });
      onNotice(msg);
      onError(null);
      if (selected) void loadVersions(selected.id);
      if (openVersion?.id === v.id) setOpenVersion(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const validate = async (v: VersionRow) => {
    try {
      setValidateReport(await apiFetch<ValidateReport>(`/academics/curriculum-versions/${v.id}/validate`));
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Validation failed.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h2 style={{ fontSize: '1rem' }}>Curricula (per program)</h2>
          {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New curriculum</Button>}
        </div>

        {showForm && canCreate && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8, alignItems: 'center' }}>
            <select value={programId} onChange={(e) => setProgramId(e.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
              <option value="">Program…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name ?? p.code}</option>
              ))}
            </select>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" style={{ width: 120 }} />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ flex: 1, minWidth: 180 }} />
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Description" style={{ flex: 1, minWidth: 180 }} />
            <Button onClick={() => void create()}>Save</Button>
          </div>
        )}

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No curricula yet.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Program</th>
                <th style={{ padding: 8 }}>Versions</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{c.code}</td>
                  <td style={{ padding: 8 }}>{c.name}</td>
                  <td style={{ padding: 8 }}>{c.program?.name ?? c.program?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>{c._count?.versions ?? '—'}</td>
                  <td style={{ padding: 8, color: c.isActive ? '#15803d' : '#9ca3af' }}>{c.isActive ? 'Active' : 'Archived'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => selectCurriculum(c)}>Versions</Button>
                    {canManage && c.isActive && (
                      <Button variant="secondary" onClick={() => void archive(c.id)}>Archive</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {selected && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>{selected.code} — versions</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Input value={versionName} onChange={(e) => setVersionName(e.target.value)} placeholder="Version name (optional)" style={{ width: 180 }} />
              <Input value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} placeholder="Effective from (date)" style={{ width: 180 }} />
              <Input value={minTotalCredits} onChange={(e) => setMinTotalCredits(e.target.value)} placeholder="Min credits" type="number" style={{ width: 110 }} />
              {canCreate && <Button onClick={() => void createVersion()}>New version</Button>}
              <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </div>

          {versions.length === 0 && <p style={{ color: '#9ca3af' }}>No versions yet.</p>}
          {versions.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: 8 }}>Version</th>
                  <th style={{ padding: 8 }}>Name</th>
                  <th style={{ padding: 8 }}>Effective</th>
                  <th style={{ padding: 8 }}>Min credits</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((v) => (
                  <tr key={v.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>v{v.versionNumber}</td>
                    <td style={{ padding: 8 }}>{v.name ?? '—'}</td>
                    <td style={{ padding: 8 }}>
                      {v.effectiveFrom
                        ? `${v.effectiveFrom.slice(0, 10)}${v.effectiveTo ? ` → ${v.effectiveTo.slice(0, 10)}` : ''}`
                        : '—'}
                    </td>
                    <td style={{ padding: 8 }}>{v.minTotalCredits ?? '—'}</td>
                    <td style={{ padding: 8 }}>{v.status}{v.isCurrent ? ' (current)' : ''}</td>
                    <td style={{ padding: 8, textAlign: 'right' }}>
                      <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void openVersionCourses(v)}>Courses</Button>
                      <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void validate(v)}>Validate</Button>
                      {canManage && v.status === 'DRAFT' && (
                        <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void runVersion(v, 'activate', 'Version activated.')}>
                          Activate
                        </Button>
                      )}
                      {canManage && v.status === 'DRAFT' && (
                        <Button variant="secondary" onClick={() => void runVersion(v, 'archive', 'Version archived.')}>Archive</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {validateReport && (
            <div style={{ marginTop: 12, padding: 12, background: '#f9fafb', borderRadius: 8, fontSize: '0.9rem' }}>
              <p>
                <strong>Total credits:</strong> {validateReport.summary.totalCredits} · <strong>Semesters:</strong>{' '}
                {validateReport.summary.semesters}
              </p>
              {validateReport.warnings.length === 0 ? (
                <p style={{ color: '#15803d' }}>No warnings — version looks healthy.</p>
              ) : (
                <ul style={{ color: '#b45309' }}>
                  {validateReport.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}

      {openVersion && <VersionCourses version={openVersion} canManage={canManage} onError={onError} onNotice={onNotice} />}
    </>
  );
}

function VersionCourses({
  version,
  canManage,
  onError,
  onNotice,
}: {
  version: VersionRow;
  canManage: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [available, setAvailable] = useState<IdName[]>([]);
  const [targets, setTargets] = useState(() =>
    (version.courses ?? []).map((cc) => ({
      courseId: cc.course?.id ?? '',
      semester: cc.semester,
      isCompulsory: cc.isCompulsory,
      creditOverride: cc.creditOverride ?? null,
      minGrade: cc.minGrade ?? '',
    })),
  );
  const [courseId, setCourseId] = useState('');
  const [semester, setSemester] = useState('1');
  const [compulsory, setCompulsory] = useState(true);

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: IdName[]; total: number }>('/academics/courses?take=300')
      .then((res) => {
        if (mounted) setAvailable(res.data);
      })
      .catch(() => {
        if (mounted) setAvailable([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const save = async () => {
    const payload = targets.filter((t) => t.courseId);
    try {
      await apiFetch(`/academics/curriculum-versions/${version.id}/courses`, {
        method: 'PUT',
        body: JSON.stringify({
          courses: payload.map((t) => ({
            courseId: t.courseId,
            semester: Number(t.semester),
            isCompulsory: t.isCompulsory,
            creditOverride: t.creditOverride ? Number(t.creditOverride) : undefined,
            minGrade: t.minGrade || undefined,
          })),
        }),
      });
      onNotice('Curriculum courses saved.');
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to save curriculum courses.');
    }
  };

  const addRow = () => {
    if (!courseId) {
      onError('Pick a course to add.');
      return;
    }
    setTargets((prev) => [...prev, { courseId, semester: Number(semester) || 1, isCompulsory: compulsory, creditOverride: null, minGrade: '' }]);
    setCourseId('');
    setSemester('1');
    setCompulsory(true);
  };

  const updateRow = (i: number, patch: Partial<(typeof targets)[number]>) => {
    setTargets((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  };

  const removeRow = (i: number) => {
    setTargets((prev) => prev.filter((_, idx) => idx !== i));
  };

  const sorted = [...targets].sort((a, b) => a.semester - b.semester);

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>v{version.versionNumber} — course map</h2>
      {sorted.length === 0 && <p style={{ color: '#9ca3af' }}>No courses mapped yet.</p>}
      {sorted.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem', marginBottom: 12 }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Semester</th>
              <th style={{ padding: 8 }}>Course</th>
              <th style={{ padding: 8 }}>Compulsory</th>
              <th style={{ padding: 8 }}>Credits</th>
              <th style={{ padding: 8 }}>Min grade</th>
              <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const label = available.find((c) => c.id === t.courseId);
              return (
                <tr key={i} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>
                    <Input
                      type="number"
                      value={String(t.semester)}
                      onChange={(e) => updateRow(i, { semester: Number(e.target.value) || 1 })}
                      style={{ width: 70 }}
                    />
                  </td>
                  <td style={{ padding: 8 }}>{label?.code ? `${label.code} — ${label.name}` : t.courseId}</td>
                  <td style={{ padding: 8 }}>
                    <input type="checkbox" checked={t.isCompulsory} onChange={(e) => updateRow(i, { isCompulsory: e.target.checked })} />
                  </td>
                  <td style={{ padding: 8 }}>
                    <Input
                      type="number"
                      value={t.creditOverride ? String(t.creditOverride) : ''}
                      onChange={(e) => updateRow(i, { creditOverride: e.target.value ? Number(e.target.value) : null })}
                      placeholder="—"
                      style={{ width: 70 }}
                    />
                  </td>
                  <td style={{ padding: 8 }}>
                    <Input value={t.minGrade} onChange={(e) => updateRow(i, { minGrade: e.target.value })} placeholder="—" style={{ width: 70 }} />
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" onClick={() => removeRow(i)}>Remove</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {canManage && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12, background: '#f9fafb', borderRadius: 8 }}>
          <select value={courseId} onChange={(e) => setCourseId(e.target.value)} style={{ ...selectStyle, minWidth: 240 }}>
            <option value="">Pick course…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
            ))}
          </select>
          <Input type="number" value={semester} onChange={(e) => setSemester(e.target.value)} style={{ width: 90 }} />
          <label style={{ fontSize: '0.85rem' }}>
            <input type="checkbox" checked={compulsory} onChange={(e) => setCompulsory(e.target.checked)} /> Compulsory
          </label>
          <Button variant="secondary" onClick={addRow}>Add</Button>
          <Button onClick={() => void save()}>Save course map</Button>
        </div>
      )}
    </Card>
  );
}