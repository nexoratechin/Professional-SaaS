import React, { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@college-erp/ui';
import { apiFetch } from '../lib/http';
import { type AdmissionSessionRow, downloadCsv, fmtDate } from './admissions';

interface SessionReportRow {
  id: string;
  code: string;
  name: string;
  status: string;
  academicYear: string;
  applications: number;
  enrolled: number;
  seats: number;
  filledSeats: number;
  meritPublishedAt: string | null;
}

interface PipelineReportDto {
  sessionId: string;
  sessionName: string;
  byStage: Record<string, number>;
  byStatus: Record<string, number>;
  total: number;
  enquiries: number;
  conversions: number;
  seats: number;
  filled: number;
  perProgram: {
    programId: string;
    programName: string;
    seats: number;
    filledSeats: number;
    applications: number;
    enrolled: number;
  }[];
}

interface MeritReportDto {
  publishedAt: string | null;
  entries: {
    applicationId: string;
    applicationNumber: string;
    fullName: string;
    programName: string;
    meritScore: number | null;
    meritRank: number | null;
    status: string;
  }[];
}

const STAGE_ORDER = [
  'enquiry',
  'application',
  'documents',
  'verification',
  'merit',
  'counselling',
  'offer',
  'payment',
  'enrollment',
  'closed',
];

export function ReportsTab({
  canExport,
  onError,
  onNotice,
}: {
  canExport: boolean;
  onError: (msg: string | null) => void;
  onNotice: (msg: string | null) => void;
}) {
  const [sessions, setSessions] = useState<AdmissionSessionRow[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [sessionReport, setSessionReport] = useState<SessionReportRow[] | null>(null);
  const [pipeline, setPipeline] = useState<PipelineReportDto | null>(null);
  const [merit, setMerit] = useState<MeritReportDto | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const list = (await apiFetch<AdmissionSessionRow[]>('/admissions/sessions')) ?? [];
      setSessions(list);
      const active = list.find((x) => x.status === 'OPEN');
      setSessionId((cur) => cur || active?.id || list[0]?.id || '');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to load sessions.');
    }
  }, [onError]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    void (async () => {
      try {
        setSessionReport(await apiFetch<SessionReportRow[]>('/admissions/reports/sessions'));
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load session report.');
      }
    })();
  }, [onError]);

  useEffect(() => {
    if (!sessionId) return;
    void (async () => {
      try {
        const [pipe, m] = await Promise.all([
          apiFetch<PipelineReportDto>(`/admissions/reports/pipeline?sessionId=${sessionId}`),
          apiFetch<MeritReportDto>(`/admissions/reports/merit?sessionId=${sessionId}`),
        ]);
        setPipeline(pipe);
        setMerit(m);
      } catch (err) {
        onError(err instanceof Error ? err.message : 'Failed to load reports.');
      }
    })();
  }, [sessionId, onError]);

  const exportMerit = async () => {
    if (!sessionId) return;
    try {
      const res = await apiFetch<{ csv: string; filename: string }>(`/admissions/export/merit?sessionId=${sessionId}`);
      downloadCsv(res.csv, res.filename);
      onNotice(`Exported to ${res.filename}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Export failed.');
    }
  };

  const maxStage = pipeline ? Math.max(...Object.values(pipeline.byStage), ...STAGE_ORDER.map((s) => pipeline.byStage[s] ?? 0), 1) : 1;

  return (
    <>
      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 12 }}>Session report</h2>
        {sessionReport === null && <p>Loading…</p>}
        {sessionReport !== null && sessionReport.length === 0 && <p style={{ color: '#9ca3af' }}>No sessions.</p>}
        {sessionReport !== null && sessionReport.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ padding: 8 }}>Code</th>
                <th style={{ padding: 8 }}>Name</th>
                <th style={{ padding: 8 }}>Academic year</th>
                <th style={{ padding: 8 }}>Applications</th>
                <th style={{ padding: 8 }}>Enrolled</th>
                <th style={{ padding: 8 }}>Seats</th>
                <th style={{ padding: 8 }}>Merit published</th>
                <th style={{ padding: 8 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {sessionReport.map((row) => (
                <tr key={row.id} style={{ borderBottom: '1px solid #e5e7eb' }}>
                  <td style={{ padding: 8 }}>{row.code}</td>
                  <td style={{ padding: 8 }}>{row.name}</td>
                  <td style={{ padding: 8 }}>{row.academicYear}</td>
                  <td style={{ padding: 8 }}>{row.applications}</td>
                  <td style={{ padding: 8 }}>{row.enrolled}</td>
                  <td style={{ padding: 8 }}>{row.filledSeats}/{row.seats}</td>
                  <td style={{ padding: 8 }}>{fmtDate(row.meritPublishedAt)}</td>
                  <td style={{ padding: 8 }}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <h2 style={{ fontSize: '1rem' }}>Session detail</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} style={{ padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db' }}>
              {sessions.map((s) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
            {canExport && sessionId && <Button variant="secondary" onClick={() => void exportMerit()}>Export merit CSV</Button>}
          </div>
        </div>

        {pipeline && (
          <>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
              {[
                [pipeline.sessionName, 'Session'],
                [String(pipeline.total), 'Applications'],
                [String(pipeline.enquiries), 'Enquiries'],
                [String(pipeline.conversions), 'Converted'],
                [`${pipeline.filled}/${pipeline.seats}`, 'Seats filled'],
              ].map(([value, label]) => (
                <Card key={label} style={{ flex: 1, minWidth: 130 }}>
                  <p style={{ fontSize: '0.85rem', color: '#6b7280' }}>{label}</p>
                  <p style={{ fontSize: '1.3rem', fontWeight: 600 }}>{value}</p>
                </Card>
              ))}
            </div>

            <h3 style={{ fontSize: '0.95rem', marginBottom: 8 }}>Pipeline by stage</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {STAGE_ORDER.map((stage) => (
                <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 110, fontSize: '0.85rem', color: '#374151', textTransform: 'capitalize' }}>{stage}</span>
                  <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 12 }}>
                    <div style={{ width: `${Math.max(2, ((pipeline.byStage[stage] ?? 0) / maxStage) * 100)}%`, height: 12, borderRadius: 4, background: '#2563eb' }} />
                  </div>
                  <span style={{ width: 36, textAlign: 'right', fontSize: '0.85rem' }}>{pipeline.byStage[stage] ?? 0}</span>
                </div>
              ))}
            </div>

            {pipeline.perProgram.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                    <th style={{ padding: 8 }}>Program</th>
                    <th style={{ padding: 8 }}>Applications</th>
                    <th style={{ padding: 8 }}>Enrolled</th>
                    <th style={{ padding: 8 }}>Seats</th>
                  </tr>
                </thead>
                <tbody>
                  {pipeline.perProgram.map((p) => (
                    <tr key={p.programId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                      <td style={{ padding: 8 }}>{p.programName}</td>
                      <td style={{ padding: 8 }}>{p.applications}</td>
                      <td style={{ padding: 8 }}>{p.enrolled}</td>
                      <td style={{ padding: 8 }}>{p.filledSeats}/{p.seats}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Card>

      {merit && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>
            Merit list {merit.publishedAt ? <>— published {fmtDate(merit.publishedAt)}</> : '(not yet published)'}
          </h2>
          {merit.entries.length === 0 && <p style={{ color: '#9ca3af' }}>No ranked applicants in this session.</p>}
          {merit.entries.length > 0 && (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
              <thead>
                <tr style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>
                  <th style={{ padding: 8 }}>Rank</th>
                  <th style={{ padding: 8 }}>Application #</th>
                  <th style={{ padding: 8 }}>Name</th>
                  <th style={{ padding: 8 }}>Program</th>
                  <th style={{ padding: 8 }}>Score</th>
                  <th style={{ padding: 8 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {merit.entries.map((e) => (
                  <tr key={e.applicationId} style={{ borderBottom: '1px solid #e5e7eb' }}>
                    <td style={{ padding: 8 }}>{e.meritRank ?? '—'}</td>
                    <td style={{ padding: 8 }}>{e.applicationNumber}</td>
                    <td style={{ padding: 8 }}>{e.fullName}</td>
                    <td style={{ padding: 8 }}>{e.programName}</td>
                    <td style={{ padding: 8 }}>{e.meritScore ?? '—'}</td>
                    <td style={{ padding: 8 }}>{e.status}</td>
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