import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { CurriculaTab } from './academics-curricula';
import { OfferingsTab, RegistrationsTab } from './academics-scheduling';
import { AdvisingTab, BacklogsTab, CalendarTab, ProgressionTab } from './academics-records';
import { COURSE_TYPES, CourseRow, selectStyle, useEntityList } from './academics-shared';

export const VIEW_PERMISSION = 'academics.view';
export const CREATE_PERMISSION = 'academics.create';
export const UPDATE_PERMISSION = 'academics.update';
export const DELETE_PERMISSION = 'academics.delete';
export const MANAGE_PERMISSION = 'academics.manage';

type Tab = 'courses' | 'curricula' | 'offerings' | 'registrations' | 'advising' | 'progression' | 'backlogs' | 'calendar';

export function AcademicsPage() {
  const { permissions } = useAuth();
  const [tab, setTab] = useState<Tab>('courses');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const canCreate = permissions.includes(CREATE_PERMISSION);
  const canManage = permissions.includes(MANAGE_PERMISSION);

  return (
    <div style={{ maxWidth: 1150, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>Academics</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setTab('courses')}>Courses</Button>
          <Button variant="secondary" onClick={() => setTab('curricula')}>Curricula</Button>
          <Button variant="secondary" onClick={() => setTab('offerings')}>Offerings</Button>
          <Button variant="secondary" onClick={() => setTab('registrations')}>Registrations</Button>
          <Button variant="secondary" onClick={() => setTab('advising')}>Advising</Button>
          <Button variant="secondary" onClick={() => setTab('progression')}>Progression</Button>
          <Button variant="secondary" onClick={() => setTab('backlogs')}>Backlogs</Button>
          <Button variant="secondary" onClick={() => setTab('calendar')}>Calendar</Button>
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      {tab === 'courses' && (
        <CoursesTab canCreate={canCreate} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'curricula' && (
        <CurriculaTab canCreate={canCreate} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'offerings' && (
        <OfferingsTab canCreate={canCreate} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'registrations' && (
        <RegistrationsTab canCreate={canCreate} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'advising' && (
        <AdvisingTab canCreate={canCreate} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'progression' && (
        <ProgressionTab canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'backlogs' && (
        <BacklogsTab canCreate={canCreate} onError={setError} onNotice={setNotice} />
      )}
      {tab === 'calendar' && (
        <CalendarTab canCreate={canCreate} canManage={canManage} onError={setError} onNotice={setNotice} />
      )}
    </div>
  );
}

// ── Courses & prerequisites ─────────────────────────────────────────────────

function CoursesTab({
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
  const [rows, setRows] = useState<CourseRow[]>([]);
  const [q, setQ] = useState('');
  const [courseType, setCourseType] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [selected, setSelected] = useState<CourseRow | null>(null);
  const departments = useEntityList('departments');

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [creditHours, setCreditHours] = useState('');
  const [type, setType] = useState<string>(COURSE_TYPES[0]);
  const [departmentId, setDepartmentId] = useState('');

  const [prereqCourseId, setPrereqCourseId] = useState('');
  const [prereqMinGrade, setPrereqMinGrade] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (q) p.set('search', q);
    if (courseType) p.set('courseType', courseType);
    return p.toString();
  }, [q, courseType]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: CourseRow[]; total: number }>(`/academics/courses?${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load courses.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshSelected = useCallback(async (id: string) => {
    try {
      setSelected(await apiFetch<CourseRow>(`/academics/courses/${id}`));
    } catch {
      // detail fetch is best-effort; the row may have been archived
    }
  }, []);

  const create = async () => {
    if (!code.trim() || !name.trim()) {
      onError('Code and name are required.');
      return;
    }
    try {
      await apiFetch('/academics/courses', {
        method: 'POST',
        body: JSON.stringify({
          code: code.trim(),
          name: name.trim(),
          creditHours: creditHours ? Number(creditHours) : undefined,
          courseType: type,
          departmentId: departmentId || undefined,
        }),
      });
      setShowForm(false);
      setCode('');
      setName('');
      setCreditHours('');
      setDepartmentId('');
      onNotice('Course created.');
      onError(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create course.');
    }
  };

  const archive = async (id: string) => {
    try {
      await apiFetch(`/academics/courses/${id}/archive`, { method: 'POST' });
      onNotice('Course archived.');
      onError(null);
      if (selected?.id === id) setSelected(null);
      void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to archive course.');
    }
  };

  const addPrereq = async () => {
    if (!selected || !prereqCourseId) {
      onError('Pick the required course.');
      return;
    }
    try {
      await apiFetch(`/academics/courses/${selected.id}/prerequisites`, {
        method: 'POST',
        body: JSON.stringify({ requiredCourseId: prereqCourseId, minGrade: prereqMinGrade || undefined }),
      });
      setPrereqCourseId('');
      setPrereqMinGrade('');
      onNotice('Prerequisite added.');
      onError(null);
      void refreshSelected(selected.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to add prerequisite.');
    }
  };

  const removePrereq = async (prerequisiteId: string) => {
    if (!selected) return;
    try {
      await apiFetch(`/academics/courses/${selected.id}/prerequisites/${prerequisiteId}`, { method: 'DELETE' });
      onNotice('Prerequisite removed.');
      onError(null);
      void refreshSelected(selected.id);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to remove prerequisite.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Course catalog</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code/name" style={{ minWidth: 220 }} />
            <select value={courseType} onChange={(e) => setCourseType(e.target.value)} style={selectStyle}>
              <option value="">All types</option>
              {COURSE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New course</Button>}
          </div>
        </div>

        {showForm && canCreate && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8 }}>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code" style={{ width: 140 }} />
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" style={{ flex: 1, minWidth: 200 }} />
            <Input value={creditHours} onChange={(e) => setCreditHours(e.target.value)} placeholder="Credits" type="number" style={{ width: 100 }} />
            <select value={type} onChange={(e) => setType(e.target.value)} style={selectStyle}>
              {COURSE_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} style={selectStyle}>
              <option value="">No department</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name ?? d.code}</option>
              ))}
            </select>
            <Button onClick={() => void create()}>Save</Button>
          </div>
        )}

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No courses yet.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Credits</th>
                <th style={{ padding: 8 }}>Type</th>
                <th style={{ padding: 8 }}>Department</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{c.code}</td>
                  <td style={{ padding: 8 }}>{c.name}</td>
                  <td style={{ padding: 8 }}>{c.creditHours ?? '—'}</td>
                  <td style={{ padding: 8 }}>{c.courseType}</td>
                  <td style={{ padding: 8 }}>{c.department?.name ?? c.department?.code ?? '—'}</td>
                  <td style={{ padding: 8, color: c.isActive ? '#15803d' : '#9ca3af' }}>{c.isActive ? 'Active' : 'Archived'}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void refreshSelected(c.id)}>
                      Prerequisites
                    </Button>
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
        <>
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ fontSize: '1rem' }}>
                {selected.code} — prerequisites
                <span style={{ marginLeft: 12, fontWeight: 400, fontSize: '0.85rem', color: '#6b7280' }}>Courses that must be cleared first</span>
              </h2>
              <Button variant="secondary" onClick={() => setSelected(null)}>Close</Button>
            </div>
            {(selected.prerequisites?.length ?? 0) === 0 && <p style={{ color: '#9ca3af' }}>No prerequisites.</p>}
            {(selected.prerequisites?.length ?? 0) > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: 8 }}>Required course</th>
                    <th style={{ padding: 8 }}>Min grade</th>
                    <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {selected.prerequisites?.map((p) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: 8 }}>{p.requiredCourse?.code} — {p.requiredCourse?.name}</td>
                      <td style={{ padding: 8 }}>{p.minGrade ?? '—'}</td>
                      <td style={{ padding: 8, textAlign: 'right' }}>
                        <Button variant="secondary" onClick={() => void removePrereq(p.id)}>Remove</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canManage && (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12, alignItems: 'center' }}>
                <select value={prereqCourseId} onChange={(e) => setPrereqCourseId(e.target.value)} style={{ ...selectStyle, minWidth: 240 }}>
                  <option value="">Pick required course…</option>
                  {rows
                    .filter((c) => c.id !== selected.id && !selected.prerequisites?.some((p) => p.requiredCourse?.id === c.id))
                    .map((c) => (
                      <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
                    ))}
                </select>
                <Input value={prereqMinGrade} onChange={(e) => setPrereqMinGrade(e.target.value)} placeholder="Min grade (optional)" style={{ width: 180 }} />
                <Button onClick={() => void addPrereq()}>Add prerequisite</Button>
              </div>
            )}
          </Card>

          {selected.requiredBy && selected.requiredBy.length > 0 && (
            <Card>
              <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Required by (downstream courses)</h2>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selected.requiredBy.map((p) => (
                  <li key={p.id}>{p.course?.code} — {p.course?.name}</li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}