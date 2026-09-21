import React, { useEffect, useMemo, useState } from 'react';
import { Card, Input } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import { fmtDate, selectStyle } from './academics-shared';
import type { StudentSummaryDto } from '@college-erp/types';
import { Paged, SessionRow, useSessions, useStudents } from './exams-shared';
import { ProcessStudent, RESULT_STATES, ResultProcessRow } from './results-shared';

type Grouped = {
  studentId: string;
  publishedProcessCount: number;
  totalCreditsAttempted: number;
  totalCreditsEarned: number;
  cgpa: number | null;
};

function fmt(v: number | null | undefined): string {
  return v == null ? '—' : String(Math.round(v * 100) / 100);
}

export function StudentsTab({
  onError,
  onNotice,
}: {
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  void onNotice;
  const sessions = useSessions();
  const students = useStudents();
  const [sessionId, setSessionId] = useState('');
  const [rows, setRows] = useState<Grouped[]>([]);
  const [loading, setLoading] = useState(false);
  const [sessionName, setSessionName] = useState('');
  const [query, setQuery] = useState('');

  const studentById = useMemo(() => new Map(students.map((s) => [s.id, s])), [students]);

  useEffect(() => {
    if (!sessionId) {
      setRows([]);
      setSessionName('');
      return;
    }
    setLoading(true);
    apiFetch<Paged<ResultProcessRow>>(`/results/sessions/${sessionId}/processes?take=500&state=PUBLISHED`)
      .then((res) => {
        const published = res.items.filter((p) =>
          p.state === 'PUBLISHED' || p.state === 'LOCKED'
        );
        const byStudent = new Map<string, Grouped>();
        for (const p of published) {
          const g = byStudent.get(p.studentId) ?? { studentId: p.studentId, publishedProcessCount: 0, totalCreditsAttempted: 0, totalCreditsEarned: 0, cgpa: null };
          g.publishedProcessCount += 1;
          g.totalCreditsAttempted += p.creditsAttempted ?? 0;
          g.totalCreditsEarned += p.creditsEarned ?? 0;
          byStudent.set(p.studentId, g);
        }
        for (const g of byStudent.values()) {
          const parts = published.filter((p) => p.studentId === g.studentId && p.gpa != null);
          const weight = parts.reduce((a, p) => a + (p.gpa ?? 0) * (p.creditsAttempted ?? 0), 0);
          const denom = parts.reduce((a, p) => a + (p.creditsAttempted ?? 0), 0);
          if (denom > 0) g.cgpa = Math.round((weight / denom) * 100) / 100;
        }
        setRows([...byStudent.values()].sort((a, b) => (studentById.get(a.studentId)?.fullName ?? '').localeCompare(studentById.get(b.studentId)?.fullName ?? '')));
        setSessionName(sessions.find((s) => s.id === sessionId)?.name ?? '');
      })
      .catch((err) => onError(err instanceof Error ? err.message : 'Failed to load student summaries.'))
      .finally(() => setLoading(false));
  }, [sessionId, onError, studentById]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const st = studentById.get(r.studentId);
      return (
        (st?.fullName ?? '').toLowerCase().includes(q) ||
        (st?.admissionNumber ?? '').toLowerCase().includes(q) ||
        (st?.rollNumber ?? '').toLowerCase().includes(q)
      );
    });
  }, [rows, query, studentById]);

  return (
    <Card>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={selectStyle}>
          <option value="">Select session…</option>
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name} ({s.examType})
            </option>
          ))}
        </select>
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name / admission / roll…" style={{ maxWidth: 240 }} />
        {sessionId && <span style={{ color: '#6b7280', fontSize: '0.85rem' }}>{filtered.length} student(s) · {sessionName || '—'}</span>}
      </div>

      {loading && <p style={{ color: '#9ca3af' }}>Loading…</p>}
      {sessionId && !loading && filtered.length === 0 && (
        <p style={{ color: '#9ca3af' }}>No published student summaries yet. Calculate and publish session results first.</p>
      )}

      {sessionId && filtered.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
              <th style={{ padding: 8 }}>Student</th>
              <th style={{ padding: 8 }}>Admission</th>
              <th style={{ padding: 8 }}>Published</th>
              <th style={{ padding: 8 }}>Credits attempted</th>
              <th style={{ padding: 8 }}>Credits earned</th>
              <th style={{ padding: 8 }}>CGPA</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const st = studentById.get(r.studentId);
              return (
                <tr key={r.studentId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{st?.fullName ?? r.studentId}</td>
                  <td style={{ padding: 8 }}>{st?.admissionNumber ?? '—'}</td>
                  <td style={{ padding: 8 }}>{r.publishedProcessCount}</td>
                  <td style={{ padding: 8 }}>{fmt(r.totalCreditsAttempted)}</td>
                  <td style={{ padding: 8 }}>{fmt(r.totalCreditsEarned)}</td>
                  <td style={{ padding: 8 }}>{fmt(r.cgpa)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
