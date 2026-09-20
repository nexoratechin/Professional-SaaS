import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import {
  COURSE_OFFERING_STATUSES,
  COURSE_REGISTRATION_STATUSES,
  FACULTY_ASSIGNMENT_ROLES,
  IdName,
  selectStyle,
  useEntityList,
  useUsers,
  UserRow,
  UserIdField,
} from './academics-shared';

interface OfferingRow {
  id: string;
  code: string;
  status: string;
  capacity?: number | null;
  waitlistCapacity?: number | null;
  creditHours?: number | null;
  enrollmentStartAt?: string | null;
  enrollmentEndAt?: string | null;
  course?: IdName & { creditHours?: number | null; courseType?: string | null };
  term?: IdName | null;
  program?: IdName | null;
  section?: IdName | null;
  batch?: IdName | null;
  faculty?: { id: string; role: string; user?: UserRow }[];
  enrolledCount?: number;
  waitlistedCount?: number;
  seatsLeft?: number | null;
}

interface RegistrationRow {
  id: string;
  status: string;
  waitlistPosition?: number | null;
  student?: { id: string; fullName?: string | null; admissionNumber?: string | null; rollNumber?: string | null };
  courseOffering?: { id: string; code?: string | null; course?: IdName } | null;
  term?: IdName | null;
}

interface ReportRow {
  offeringId: string;
  code: string;
  courseCode: string;
  courseName: string;
  creditHours?: number | null;
  program?: string | null;
  section?: string | null;
  capacity?: number | null;
  enrolled: number;
  waitlisted: number;
  utilisation?: number | null;
}

interface StudentRow {
  id: string;
  fullName?: string | null;
  admissionNumber?: string | null;
  rollNumber?: string | null;
}

export function OfferingsTab({
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
  const courses = useEntityList('courses');
  const terms = useEntityList('terms');
  const programs = useEntityList('programs');
  const sections = useEntityList('sections');
  const batches = useEntityList('batches');
  const campuses = useEntityList('campuses');

  const [rows, setRows] = useState<OfferingRow[]>([]);
  const [myOfferings, setMyOfferings] = useState<OfferingRow[]>([]);
  const [showMine, setShowMine] = useState(false);
  const [termFilter, setTermFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [facultyFor, setFacultyFor] = useState<OfferingRow | null>(null);
  const users = useUsers();

  const [courseId, setCourseId] = useState('');
  const [termId, setTermId] = useState('');
  const [programId, setProgramId] = useState('');
  const [code, setCode] = useState('');
  const [capacity, setCapacity] = useState('');
  const [waitlistCapacity, setWaitlistCapacity] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [batchId, setBatchId] = useState('');
  const [campusId, setCampusId] = useState('');
  const [status, setStatus] = useState('PLANNED');

  const [assignUserId, setAssignUserId] = useState('');
  const [assignRole, setAssignRole] = useState<string>(FACULTY_ASSIGNMENT_ROLES[0]);
  const [assignAlloc, setAssignAlloc] = useState('');

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (q) p.set('search', q);
    if (termFilter) p.set('termId', termFilter);
    if (statusFilter) p.set('status', statusFilter);
    return p.toString();
  }, [q, termFilter, statusFilter]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: OfferingRow[]; total: number }>(`/academics/course-offerings?${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load course offerings.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const myOffCleanup = useCallback(async () => {
    try {
      setMyOfferings(await apiFetch<OfferingRow[]>('/academics/my-offerings'));
    } catch {
      setMyOfferings([]);
    }
  }, []);

  const create = async () => {
    if (!courseId || !termId || !programId || !code.trim()) {
      onError('Course, term, program and code are required.');
      return;
    }
    try {
      await apiFetch('/academics/course-offerings', {
        method: 'POST',
        body: JSON.stringify({
          courseId,
          termId,
          programId,
          sectionId: sectionId || undefined,
          batchId: batchId || undefined,
          campusId: campusId || undefined,
          code: code.trim(),
          status,
          capacity: capacity ? Number(capacity) : undefined,
          waitlistCapacity: waitlistCapacity ? Number(waitlistCapacity) : undefined,
        }),
      });
      setShowForm(false);
      setCourseId('');
      setTermId('');
      setProgramId('');
      setCode('');
      setCapacity('');
      setWaitlistCapacity('');
      setSectionId('');
      setBatchId('');
      setCampusId('');
      onNotice('Course offering created.');
      onError(null);
      void load();
      void myOffCleanup();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create offering.');
    }
  };

  const run = async (path: string, body?: Record<string, unknown>, msg?: string) => {
    try {
      await apiFetch(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
      if (msg) onNotice(msg);
      onError(null);
      void load();
      void myOffCleanup();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const assignFaculty = async (offeringId: string) => {
    if (!assignUserId) {
      onError('Pick a user to assign.');
      return;
    }
    try {
      await apiFetch(`/academics/course-offerings/${offeringId}/faculty`, {
        method: 'POST',
        body: JSON.stringify({
          userId: assignUserId,
          role: assignRole,
          allocationPercent: assignAlloc ? Number(assignAlloc) : undefined,
        }),
      });
      setAssignUserId('');
      setAssignAlloc('');
      setFacultyFor(null);
      onNotice('Faculty assigned.');
      onError(null);
      void load();
      void myOffCleanup();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to assign faculty.');
    }
  };

  const toggleMine = () => {
    if (!showMine) void myOffCleanup();
    setShowMine((s) => !s);
  };

  return (
    <>
      {showMine && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>My offerings (faculty assignments)</h2>
          {myOfferings.length === 0 && <p style={{ color: '#9ca3af' }}>You are not assigned to any offering.</p>}
          {myOfferings.map((o) => (
            <p key={o.id} style={{ fontSize: '0.9rem' }}>
              {o.code} — {o.course?.name} ({o.term?.name ?? o.term?.code ?? 'term'})
            </p>
          ))}
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Course offerings (per term)</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search code/course" style={{ minWidth: 200 }} />
            <select value={termFilter} onChange={(e) => setTermFilter(e.target.value)} style={selectStyle}>
              <option value="">All terms</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>{t.name ?? t.code}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
              <option value="">All statuses</option>
              {COURSE_OFFERING_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={toggleMine}>My offerings</Button>
            {canCreate && <Button onClick={() => setShowForm((s) => !s)}>New offering</Button>}
          </div>
        </div>

        {showForm && canCreate && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, padding: 12, background: '#f9fafb', borderRadius: 8, alignItems: 'center' }}>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} style={{ ...selectStyle, minWidth: 200 }}>
              <option value="">Course…</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.code} — {c.name}</option>
              ))}
            </select>
            <select value={termId} onChange={(e) => setTermId(e.target.value)} style={{ ...selectStyle, minWidth: 150 }}>
              <option value="">Term…</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>{t.name ?? t.code}</option>
              ))}
            </select>
            <select value={programId} onChange={(e) => setProgramId(e.target.value)} style={{ ...selectStyle, minWidth: 150 }}>
              <option value="">Program…</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>{p.name ?? p.code}</option>
              ))}
            </select>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Offering code" style={{ width: 140 }} />
            <Input value={capacity} onChange={(e) => setCapacity(e.target.value)} placeholder="Capacity" type="number" style={{ width: 90 }} />
            <Input value={waitlistCapacity} onChange={(e) => setWaitlistCapacity(e.target.value)} placeholder="Waitlist" type="number" style={{ width: 90 }} />
            <select value={sectionId} onChange={(e) => setSectionId(e.target.value)} style={selectStyle}>
              <option value="">Section…</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>{s.name ?? s.code}</option>
              ))}
            </select>
            <select value={batchId} onChange={(e) => setBatchId(e.target.value)} style={selectStyle}>
              <option value="">Batch…</option>
              {batches.map((b) => (
                <option key={b.id} value={b.id}>{b.name ?? b.code}</option>
              ))}
            </select>
            <select value={campusId} onChange={(e) => setCampusId(e.target.value)} style={selectStyle}>
              <option value="">Campus…</option>
              {campuses.map((c) => (
                <option key={c.id} value={c.id}>{c.name ?? c.code}</option>
              ))}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
              {COURSE_OFFERING_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Button onClick={() => void create()}>Save</Button>
          </div>
        )}

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No course offerings yet.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Course</th>
                <th style={{ padding: 8 }}>Term</th>
                <th style={{ padding: 8 }}>Program</th>
                <th style={{ padding: 8 }}>Section</th>
                <th style={{ padding: 8 }}>Seats</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={o.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{o.code}</td>
                  <td style={{ padding: 8 }}>{o.course?.code} — {o.course?.name}</td>
                  <td style={{ padding: 8 }}>{o.term?.name ?? o.term?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>{o.program?.name ?? o.program?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>{o.section?.name ?? o.section?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>
                    {o.enrolledCount != null ? `${o.enrolledCount}/${o.capacity ?? '∞'}${o.waitlistedCount ? ` (+${o.waitlistedCount} wl)` : ''}` : `${o.capacity ?? '∞'}`}
                  </td>
                  <td style={{ padding: 8 }}>{o.status}</td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {canManage && o.status !== 'CANCELLED' && (
                      <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void run(`/academics/course-offerings/${o.id}/cancel`, undefined, 'Offering cancelled.')}>
                        Cancel
                      </Button>
                    )}
                    {canManage && (
                      <Button variant="secondary" onClick={() => setFacultyFor(o)}>Faculty</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {facultyFor && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h2 style={{ fontSize: '1rem' }}>{facultyFor.code} — faculty assignments</h2>
            <Button variant="secondary" onClick={() => setFacultyFor(null)}>Close</Button>
          </div>
          {(facultyFor.faculty ?? []).length === 0 ? (
            <p style={{ color: '#9ca3af' }}>No faculty assigned.</p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
              {facultyFor.faculty?.map((f) => (
                <li key={f.id} style={{ fontSize: '0.9rem' }}>
                  {f.user?.fullName} ({f.user?.email}) — {f.role}
                </li>
              ))}
            </ul>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: 12, background: '#f9fafb', borderRadius: 8 }}>
            <UserIdField value={assignUserId} users={users} onChange={setAssignUserId} />
            <select value={assignRole} onChange={(e) => setAssignRole(e.target.value)} style={selectStyle}>
              {FACULTY_ASSIGNMENT_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
            <Input value={assignAlloc} onChange={(e) => setAssignAlloc(e.target.value)} placeholder="Allocation %" type="number" style={{ width: 110 }} />
            <Button onClick={() => void assignFaculty(facultyFor.id)}>Assign</Button>
          </div>
        </Card>
      )}
    </>
  );
}

export function RegistrationsTab({
  canCreate,
  onError,
  onNotice,
}: {
  canCreate: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const terms = useEntityList('terms');
  const [offerings, setOfferings] = useState<IdName[]>([]);
  const [rows, setRows] = useState<RegistrationRow[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [termFilter, setTermFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');

  const [offeringId, setOfferingId] = useState('');
  const [studentId, setStudentId] = useState('');
  const [bulkStudentIds, setBulkStudentIds] = useState<string[]>([]);
  const [bulkOfferingId, setBulkOfferingId] = useState('');
  const [showReport, setShowReport] = useState(false);
  const [reportTerm, setReportTerm] = useState('');
  const [reportRows, setReportRows] = useState<ReportRow[]>([]);
  const [reportSummary, setReportSummary] = useState<{ totalSeats: number; totalRegistered: number }>({ totalSeats: 0, totalRegistered: 0 });

  const params = useMemo(() => {
    const p = new URLSearchParams({ take: '100' });
    if (q) p.set('search', q);
    if (termFilter) p.set('termId', termFilter);
    if (statusFilter) p.set('status', statusFilter);
    return p.toString();
  }, [q, termFilter, statusFilter]);

  const load = useCallback(async () => {
    onError(null);
    try {
      const res = await apiFetch<{ data: RegistrationRow[]; total: number }>(`/academics/registrations?${params}`);
      setRows(res.data);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load registrations.');
    }
  }, [params, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: OfferingRow[]; total: number }>('/academics/course-offerings?take=200')
      .then((res) => {
        if (mounted)
          setOfferings(
            res.data.map((o) => ({ id: o.id, code: o.code, name: `${o.course?.code ?? ''} ${o.course?.name ?? ''}`.trim() })),
          );
      })
      .catch(() => {
        if (mounted) setOfferings([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    apiFetch<{ data: StudentRow[]; total: number }>('/students?take=200')
      .then((res) => {
        if (mounted) setStudents(res.data);
      })
      .catch(() => {
        if (mounted) setStudents([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const run = async (path: string, body?: Record<string, unknown>, msg?: string, refresh = true) => {
    try {
      await apiFetch(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
      if (msg) onNotice(msg);
      onError(null);
      if (refresh) void load();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Action failed.');
    }
  };

  const enrollSingle = async () => {
    if (!studentId || !offeringId) {
      onError('Pick a student and an offering.');
      return;
    }
    await run('/academics/registrations', { studentId, courseOfferingId: offeringId }, 'Registered.');
    setStudentId('');
    setOfferingId('');
  };

  const toggleBulkStudent = (id: string) => {
    setBulkStudentIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const bulkRegister = async () => {
    if (!bulkOfferingId || bulkStudentIds.length === 0) {
      onError('Pick an offering and at least one student.');
      return;
    }
    await run('/academics/registrations/bulk', { courseOfferingId: bulkOfferingId, studentIds: bulkStudentIds }, 'Bulk registration done.');
    setBulkStudentIds([]);
    setBulkOfferingId('');
  };

  const transition = async (row: RegistrationRow, target: string) => {
    await run(`/academics/registrations/${row.id}`, { status: target }, `Registration ${target.toLowerCase()}.`);
  };

  const openReport = async () => {
    if (!reportTerm) {
      onError('Pick a term for the report.');
      return;
    }
    try {
      const res = await apiFetch<{ summary: { totalSeats: number; totalRegistered: number }; rows: ReportRow[] }>(`/academics/registrations/report?termId=${reportTerm}`);
      setReportSummary(res.summary);
      setReportRows(res.rows);
      setShowReport(true);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load report.');
    }
  };

  return (
    <>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Course registrations</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student / course" style={{ minWidth: 200 }} />
            <select value={termFilter} onChange={(e) => setTermFilter(e.target.value)} style={selectStyle}>
              <option value="">All terms</option>
              {terms.map((t) => (
                <option key={t.id} value={t.id}>{t.name ?? t.code}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={selectStyle}>
              <option value="">All statuses</option>
              {COURSE_REGISTRATION_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => setShowReport((s) => !s)}>Report</Button>
          </div>
        </div>

        {rows.length === 0 && <p style={{ color: '#9ca3af' }}>No registrations yet.</p>}
        {rows.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Student</th>
                <th style={{ padding: 8 }}>Course</th>
                <th style={{ padding: 8 }}>Term</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>
                    {r.student?.fullName ?? '—'}
                    {r.student?.admissionNumber ? ` (${r.student.admissionNumber})` : ''}
                  </td>
                  <td style={{ padding: 8 }}>{r.courseOffering?.code} — {r.courseOffering?.course?.name}</td>
                  <td style={{ padding: 8 }}>{r.term?.name ?? r.term?.code ?? '—'}</td>
                  <td style={{ padding: 8 }}>
                    {r.status}
                    {r.status === 'WAITLISTED' && r.waitlistPosition != null ? ` (#${r.waitlistPosition})` : ''}
                  </td>
                  <td style={{ padding: 8, textAlign: 'right' }}>
                    {r.status === 'REGISTERED' && (
                      <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void transition(r, 'CONFIRMED')}>Confirm</Button>
                    )}
                    {r.status === 'WAITLISTED' && (
                      <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void transition(r, 'CONFIRMED')}>Promote</Button>
                    )}
                    {['REGISTERED', 'CONFIRMED', 'WAITLISTED'].includes(r.status) && (
                      <>
                        <Button variant="secondary" style={{ marginRight: 8 }} onClick={() => void transition(r, 'WITHDRAWN')}>Withdraw</Button>
                        <Button variant="secondary" onClick={() => void transition(r, 'DROPPED')}>Drop</Button>
                      </>
                    )}
                    {r.status === 'CONFIRMED' && (
                      <Button variant="secondary" style={{ marginLeft: 8 }} onClick={() => void transition(r, 'COMPLETED')}>Complete</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {canCreate && (
        <>
          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Single registration</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <select value={studentId} onChange={(e) => setStudentId(e.target.value)} style={{ ...selectStyle, minWidth: 260 }}>
                <option value="">Student…</option>
                {students.map((s) => (
                  <option key={s.id} value={s.id}>{s.fullName} ({s.admissionNumber ?? s.rollNumber ?? s.id.slice(0, 8)})</option>
                ))}
              </select>
              <select value={offeringId} onChange={(e) => setOfferingId(e.target.value)} style={{ ...selectStyle, minWidth: 260 }}>
                <option value="">Offering…</option>
                {offerings.map((o) => (
                  <option key={o.id} value={o.id}>{o.code} — {o.name}</option>
                ))}
              </select>
              <Button onClick={() => void enrollSingle()}>Register</Button>
            </div>
          </Card>

          <Card>
            <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Bulk registration</h2>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <select value={bulkOfferingId} onChange={(e) => setBulkOfferingId(e.target.value)} style={{ ...selectStyle, minWidth: 260 }}>
                <option value="">Offering…</option>
                {offerings.map((o) => (
                  <option key={o.id} value={o.id}>{o.code} — {o.name}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, margin: '12px 0' }}>
              {students.length === 0 && <p style={{ color: '#9ca3af', fontSize: '0.9rem' }}>No students to pick from.</p>}
              {students.map((s) => (
                <label key={s.id} style={{ fontSize: '0.9rem' }}>
                  <input type="checkbox" checked={bulkStudentIds.includes(s.id)} onChange={() => toggleBulkStudent(s.id)} />{' '}
                  {s.fullName} ({s.admissionNumber ?? s.rollNumber ?? s.id.slice(0, 8)})
                </label>
              ))}
            </div>
            {bulkStudentIds.length > 0 && <p style={{ fontSize: '0.9rem', color: '#374151' }}>{bulkStudentIds.length} student(s) selected.</p>}
            <Button onClick={() => void bulkRegister()}>Bulk register</Button>
          </Card>
        </>
      )}

      {showReport && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
            <h2 style={{ fontSize: '1rem' }}>Registration report</h2>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={reportTerm} onChange={(e) => setReportTerm(e.target.value)} style={selectStyle}>
                <option value="">Term…</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>{t.name ?? t.code}</option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => void openReport()}>Run</Button>
            </div>
          </div>
          <p style={{ fontSize: '0.9rem', marginBottom: 8 }}>
            Seats: {reportSummary.totalSeats} · Registered: {reportSummary.totalRegistered}
          </p>
          {reportRows.length === 0 && <p style={{ color: '#9ca3af' }}>No data for this term.</p>}
          {reportRows.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: 8 }}>Offering</th>
                  <th style={{ padding: 8 }}>Course</th>
                  <th style={{ padding: 8 }}>Program</th>
                  <th style={{ padding: 8 }}>Capacity</th>
                  <th style={{ padding: 8 }}>Enrolled</th>
                  <th style={{ padding: 8 }}>Waitlisted</th>
                  <th style={{ padding: 8 }}>Utilisation</th>
                </tr>
              </thead>
              <tbody>
                {reportRows.map((r) => (
                  <tr key={r.offeringId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>{r.code}</td>
                    <td style={{ padding: 8 }}>{r.courseCode} — {r.courseName}</td>
                    <td style={{ padding: 8 }}>{r.program ?? '—'}</td>
                    <td style={{ padding: 8 }}>{r.capacity ?? '∞'}</td>
                    <td style={{ padding: 8 }}>{r.enrolled}</td>
                    <td style={{ padding: 8 }}>{r.waitlisted}</td>
                    <td style={{ padding: 8 }}>{r.utilisation != null ? `${r.utilisation}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}
    </>
  );
}