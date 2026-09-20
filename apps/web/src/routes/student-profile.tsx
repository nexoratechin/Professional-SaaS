import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card } from '@college-erp/ui';
import type {
  StudentDetailDto,
  StudentStatusDto,
  StudentTimelineEntryDto,
} from '@college-erp/types';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch } from '../lib/http';
import { STUDENT_STATUSES } from './students';

const UPDATE_PERMISSION = 'students.update';
const DELETE_PERMISSION = 'students.delete';

const INSTITUTION_NAME = 'College ERP';

function money(cents: number | null | undefined): string {
  return cents == null ? '—' : `₹${(cents / 100).toFixed(2)}`;
}

function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : '—';
}

export function StudentProfilePage({ studentId }: { studentId: string }) {
  const { permissions, tenantSlug } = useAuth();
  const canUpdate = permissions.includes(UPDATE_PERMISSION);
  const canDelete = permissions.includes(DELETE_PERMISSION);

  const [student, setStudent] = useState<StudentDetailDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [timeline, setTimeline] = useState<StudentTimelineEntryDto[] | null>(null);
  const [showTimeline, setShowTimeline] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [statusReason, setStatusReason] = useState('');

  const load = useCallback(async () => {
    setError(null);
    try {
      setStudent(await apiFetch<StudentDetailDto>(`/students/${studentId}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load student.');
    }
  }, [studentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    if (!student) return;
    const payload = JSON.stringify({
      kind: 'student',
      id: student.id,
      admissionNumber: student.admissionNumber,
      tenantSlug: tenantSlug ?? '',
    });
    import('qrcode').then((QRCode) => {
      QRCode.toDataURL(payload, { width: 220, margin: 1 })
        .then((url) => {
          if (!cancelled) setQrDataUrl(url);
        })
        .catch(() => setQrDataUrl(null));
    });
    return () => {
      cancelled = true;
    };
  }, [student, tenantSlug]);

  const toggleTimeline = async () => {
    if (timeline !== null) {
      setShowTimeline((s) => !s);
      return;
    }
    setError(null);
    try {
      setTimeline(await apiFetch<StudentTimelineEntryDto[]>(`/students/${studentId}/timeline`));
      setShowTimeline(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load timeline.');
    }
  };

  const changeStatus = async () => {
    if (!newStatus) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/students/${studentId}/status`, {
        method: 'POST',
        body: JSON.stringify({ status: newStatus as StudentStatusDto, reason: statusReason || undefined }),
      });
      setNotice(`Status changed to ${newStatus}.`);
      setNewStatus('');
      setStatusReason('');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Status change failed.');
    }
  };

  const archive = async () => {
    if (!window.confirm('Archive this student?')) return;
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/students/${studentId}/archive`, { method: 'POST' });
      setNotice('Archived.');
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed.');
    }
  };

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      @media print {
        body * { visibility: hidden; }
        #student-id-card, #student-id-card * { visibility: visible; }
        #student-id-card { position: absolute; left: 0; top: 0; width: 100%; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, []);

  if (error && !student) {
    return (
      <div style={{ maxWidth: 1100, margin: '2rem auto' }}>
        <Card>
          <p style={{ color: '#b91c1c' }}>{error}</p>
          <Button variant="secondary" onClick={() => void load()} style={{ marginTop: 8 }}>Retry</Button>
        </Card>
      </div>
    );
  }

  if (!student) {
    return (
      <div style={{ maxWidth: 1100, margin: '2rem auto' }}>
        <Card><p>Loading…</p></Card>
      </div>
    );
  }

  const statusBadgeStyle: React.CSSProperties = {
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: '0.75rem',
    fontWeight: 600,
    background: student.hasActiveHolds ? '#fef3c7' : '#dcfce7',
    color: student.hasActiveHolds ? '#92400e' : '#166534',
  };

  return (
    <div style={{ maxWidth: 1100, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <h1 style={{ fontSize: '1.25rem' }}>
          <Link to="/students" style={{ color: '#2563eb', textDecoration: 'none' }}>← Students</Link>{' '}
          / {student.fullName}
        </h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => window.print()} disabled={!qrDataUrl}>
            Print ID card
          </Button>
          {canDelete && <Button variant="secondary" onClick={() => void archive()}>Archive</Button>}
        </div>
      </div>

      {error && <p style={{ color: '#b91c1c' }}>{error}</p>}
      {notice && <p style={{ color: '#15803d' }}>{notice}</p>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <h2 style={{ fontSize: '1rem' }}>{student.fullName}</h2>
            <p>
              <strong>Admission #:</strong> {student.admissionNumber}
              {student.rollNumber ? ` · Roll: ${student.rollNumber}` : ''}
            </p>
            <p>
              <strong>Campus:</strong> {student.campus.name} ({student.campus.code})
            </p>
            <p>
              <strong>Program:</strong> {student.program ? `${student.program.name} (${student.program.code})` : '—'}
              {student.section ? ` · Section: ${student.section.code}` : ''}
              {student.batch ? ` · Batch: ${student.batch.code}` : ''}
            </p>
            <p>
              <strong>Academic year:</strong> {student.academicYear ? student.academicYear.code : '—'}
              {student.yearOfAdmission ? ` · Admitted: ${student.yearOfAdmission}` : ''}
            </p>
            <p>
              <strong>Status:</strong> <span style={statusBadgeStyle}>{student.status}</span>
            </p>
            <p>
              <strong>Outstanding:</strong> {money(student.outstandingCents)}
              {student.activeHoldCount > 0 ? ` · ${student.activeHoldCount} active hold(s)` : ''}
            </p>
            <p>
              <strong>Contact:</strong> {student.email ?? '—'} {student.primaryPhone ? ` / ${student.primaryPhone}` : ''}
            </p>
          </div>
        </Card>

        {/* Digital ID card (QR + printable) */}
        <div
          id="student-id-card"
          style={{
            border: '2px solid #1d4ed8',
            borderRadius: 12,
            padding: 16,
            background: '#f8fafc',
            display: 'flex',
            gap: 16,
            alignItems: 'center',
          }}
        >
          {qrDataUrl && <img src={qrDataUrl} alt="Student QR" style={{ width: 130, height: 130, background: '#fff' }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: '0.9rem' }}>
            <p style={{ fontWeight: 700, fontSize: '1rem' }}>{INSTITUTION_NAME}</p>
            <p>Student ID — {student.admissionNumber}</p>
            <p style={{ fontWeight: 600 }}>{student.fullName}</p>
            <p>{student.program ? student.program.name : '—'}</p>
            <p>{student.campus.name} · {dateOnly(student.admittedOn)}</p>
            <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>Status: {student.status}</p>
          </div>
        </div>
      </div>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Personal</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, fontSize: '0.9rem' }}>
          <p><strong>Gender:</strong> {student.gender}</p>
          <p><strong>Blood group:</strong> {student.bloodGroup}</p>
          <p><strong>Nationality:</strong> {student.nationality ?? '—'}</p>
          <p><strong>Category:</strong> {student.category ?? '—'}</p>
          <p><strong>DOB:</strong> {dateOnly(student.dateOfBirth)}</p>
          <p><strong>Alt email:</strong> {student.alternateEmail ?? '—'}</p>
          <p><strong>Alt phone:</strong> {student.alternatePhone ?? '—'}</p>
        </div>
        {student.currentAddress && (student.currentAddress.city || student.currentAddress.line1) && (
          <p style={{ fontSize: '0.9rem', marginTop: 8 }}>
            <strong>Address:</strong> {[student.currentAddress.line1, student.currentAddress.line2, student.currentAddress.city, student.currentAddress.state, student.currentAddress.postalCode, student.currentAddress.country].filter(Boolean).join(', ')}
          </p>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h2 style={{ fontSize: '1rem' }}>Status & lifecycle</h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {canUpdate && (
              <>
                <select
                  value={newStatus}
                  onChange={(e) => setNewStatus(e.target.value)}
                  style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}
                >
                  <option value="">Change status…</option>
                  {STUDENT_STATUSES.filter((s) => s !== student.status).map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <InputInline value={statusReason} onChange={setStatusReason} placeholder="reason" />
                <Button variant="secondary" onClick={() => void changeStatus()} disabled={!newStatus}>Apply</Button>
              </>
            )}
            <Button variant="secondary" onClick={() => void toggleTimeline()}>
              {showTimeline ? 'Hide timeline' : 'Timeline'}
            </Button>
          </div>
        </div>
        {showTimeline && (
          <div style={{ marginTop: 12 }}>
            {timeline === null ? (
              <p>Loading timeline…</p>
            ) : timeline.length === 0 ? (
              <p style={{ color: '#9ca3af' }}>No activity yet.</p>
            ) : (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.9rem' }}>
                {timeline.map((entry) => (
                  <li key={`${entry.kind}-${entry.id}`} style={{ borderLeft: '2px solid #d1d5db', paddingLeft: 10 }}>
                    <p style={{ fontWeight: 600 }}>{entry.title}</p>
                    {entry.fromStatus || entry.toStatus ? (
                      <p style={{ color: '#374151' }}>
                        {entry.fromStatus ?? '—'} → {entry.toStatus ?? '—'}
                      </p>
                    ) : null}
                    {entry.description && <p style={{ color: '#6b7280' }}>{entry.description}</p>}
                    <p style={{ fontSize: '0.75rem', color: '#9ca3af' }}>{dateOnly(entry.occurredAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>

      <DetailSections student={student} />

      <Card>
        <h2 style={{ fontSize: '1rem' }}>Status history</h2>
        <StatusHistory student={student} />
      </Card>
    </div>
  );
}

function InputInline({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db', minWidth: 160 }}
    />
  );
}

const SectionConfig: Array<{ key: keyof StudentDetailDto; label: string; render: (v: unknown) => React.ReactNode }> = [
  {
    key: 'guardians',
    label: 'Guardians',
    render: (v) =>
      (v as StudentDetailDto['guardians']).map((g) => (
        <Row key={g.id} title={g.name} sub={`${g.kind} · ${g.role} · ${g.phone ?? '—'} · ${g.occupation ?? '—'}`} />
      )),
  },
  {
    key: 'documents',
    label: 'Documents',
    render: (v) =>
      (v as StudentDetailDto['documents']).map((d) => (
        <Row key={d.id} title={d.documentName} sub={`${d.category} · ${d.status}${d.verifiedAt ? ` · verified ${dateOnly(d.verifiedAt)}` : ''}`} />
      )),
  },
  {
    key: 'admissions',
    label: 'Admissions',
    render: (v) =>
      (v as StudentDetailDto['admissions']).map((a) => (
        <Row key={a.id} title={`${a.applicationNumber} — ${a.status}`} sub={`${a.program.name} · ${a.academicYear?.code ?? ''}`} />
      )),
  },
  {
    key: 'academicRecords',
    label: 'Academic records',
    render: (v) =>
      (v as StudentDetailDto['academicRecords']).map((r) => (
        <Row key={r.id} title={`${r.institution} (${r.yearOfPassing ?? '—'})`} sub={`${r.degree ?? '—'} · ${r.percentage != null ? `${r.percentage}%` : r.gpa != null ? `GPA ${r.gpa}` : '—'} · ${r.verificationStatus}`} />
      )),
  },
  {
    key: 'enrollments',
    label: 'Enrollments',
    render: (v) =>
      (v as StudentDetailDto['enrollments']).map((e) => (
        <Row key={e.id} title={`${e.program.name} · ${e.term?.code ?? ''}`} sub={`${e.academicYear.code} · ${e.section?.code ?? ''} ${e.batch ? `/ ${e.batch.code}` : ''} · ${e.status}${e.rollNumber ? ` · roll ${e.rollNumber}` : ''}`} />
      )),
  },
  {
    key: 'attendance',
    label: 'Attendance',
    render: (v) =>
      (v as StudentDetailDto['attendance']).map((a) => (
        <Row key={a.id} title={`${dateOnly(a.date)} — ${a.status}`} sub={`${a.attendanceType}${a.subjectName ? ` · ${a.subjectName}` : ''} (${a.term?.code ?? '—'})`} />
      )),
  },
  {
    key: 'fees',
    label: 'Fees',
    render: (v) =>
      (v as StudentDetailDto['fees']).map((f) => (
        <Row
          key={f.id}
          title={`${f.headName} — ${f.status}`}
          sub={`${money(f.amountCents)} · paid ${money(f.paidCents)} · due ${dateOnly(f.dueDate)}`}
        />
      )),
  },
  {
    key: 'payments',
    label: 'Payments',
    render: (v) =>
      (v as StudentDetailDto['payments']).map((p) => (
        <Row key={p.id} title={`${p.receiptNumber} — ${money(p.amountCents)} (${p.status})`} sub={`${dateOnly(p.paymentDate)} · ${p.method} · ${p.referenceNumber ?? ''}`} />
      )),
  },
  {
    key: 'exams',
    label: 'Exams',
    render: (v) =>
      (v as StudentDetailDto['exams']).map((e) => (
        <Row key={e.id} title={`${e.name} — ${e.examType} (${e.status})`} sub={`${e.term?.code ?? '—'} · ${dateOnly(e.startDate)}`} />
      )),
  },
  {
    key: 'results',
    label: 'Results',
    render: (v) =>
      (v as StudentDetailDto['results']).map((r) => (
        <Row key={r.id} title={`${r.subjectName} — ${r.outcome}`} sub={`${r.obtainedMarks ?? '—'} / ${r.maxMarks} · ${r.grade ?? ''} ${r.percentage != null ? `· ${r.percentage}%` : ''}`} />
      )),
  },
  {
    key: 'certificates',
    label: 'Certificates',
    render: (v) =>
      (v as StudentDetailDto['certificates']).map((c) => (
        <Row key={c.id} title={`${c.certificateType} — ${c.status}`} sub={`${c.certificateNumber ?? ''} · ${dateOnly(c.requestDate)}`} />
      )),
  },
  {
    key: 'libraryLoans',
    label: 'Library loans',
    render: (v) =>
      (v as StudentDetailDto['libraryLoans']).map((l) => (
        <Row key={l.id} title={`${l.itemTitle} — ${l.status}`} sub={`borrowed ${dateOnly(l.borrowedAt)} · due ${dateOnly(l.dueDate)} · fine ${money(l.fineCents)}`} />
      )),
  },
  {
    key: 'hostelBookings',
    label: 'Hostel bookings',
    render: (v) =>
      (v as StudentDetailDto['hostelBookings']).map((h) => (
        <Row key={h.id} title={`${h.hostelName} · Room ${h.roomNumber} — ${h.status}`} sub={`rent ${money(h.monthlyRentCents)} · check-in ${dateOnly(h.checkInDate)}`} />
      )),
  },
  {
    key: 'transportPasses',
    label: 'Transport passes',
    render: (v) =>
      (v as StudentDetailDto['transportPasses']).map((t) => (
        <Row key={t.id} title={`${t.routeName} — ${t.status}`} sub={`${dateOnly(t.periodStart)} → ${dateOnly(t.periodEnd)} · ${t.vehicleNumber ?? ''}`} />
      )),
  },
  {
    key: 'holds',
    label: 'Holds',
    render: (v) =>
      (v as StudentDetailDto['holds']).map((h) => (
        <Row key={h.id} title={`${h.type} — ${h.status}`} sub={`placed ${dateOnly(h.placedOn)} · ${h.reason}`} />
      )),
  },
  {
    key: 'communications',
    label: 'Communications',
    render: (v) =>
      (v as StudentDetailDto['communications']).map((c) => (
        <Row key={c.id} title={`${c.type} (${c.direction})`} sub={`${dateOnly(c.sentAt)} · ${c.subject ?? ''}`} />
      )),
  },
];

function DetailSections({ student }: { student: StudentDetailDto }) {
  const sections = useMemo(
    () =>
      SectionConfig.map((config) => ({
        ...config,
        rows: config.render(student[config.key]),
      })).filter((s) => React.Children.count(s.rows) > 0),
    [student],
  );

  if (sections.length === 0) {
    return <Card><p style={{ color: '#9ca3af' }}>No records yet.</p></Card>;
  }

  return (
    <Card>
      <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Records</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sections.map((s) => (
          <details key={String(s.key)} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 8, fontSize: '0.9rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
              {s.label} ({React.Children.count(s.rows)})
            </summary>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {s.rows}
            </div>
          </details>
        ))}
      </div>
    </Card>
  );
}

function Row({ title, sub }: { title: string; sub: string }) {
  return (
    <div style={{ padding: 6, borderBottom: '1px solid #f3f4f6' }}>
      <p style={{ fontWeight: 500 }}>{title}</p>
      {sub && <p style={{ color: '#6b7280', fontSize: '0.85rem' }}>{sub}</p>}
    </div>
  );
}

function StatusHistory({ student }: { student: StudentDetailDto }) {
  if (student.statusHistory.length === 0) {
    return <p style={{ color: '#9ca3af' }}>No status changes recorded.</p>;
  }
  return (
    <ol style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.9rem' }}>
      {[...student.statusHistory]
        .sort((a, b) => (a.changedAt < b.changedAt ? 1 : -1))
        .map((h) => (
          <li key={h.id}>
            {h.fromStatus ?? '—'} → <strong>{h.toStatus}</strong> on {dateOnly(h.changedAt)}
            {h.reason ? ` · ${h.reason}` : ''}
          </li>
        ))}
    </ol>
  );
}