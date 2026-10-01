/**
 * Presentational pieces for the AI assistant page.
 *
 * Kept separate from `routes/ai-assistant.tsx` because they are pure renderers of the shared
 * `@college-erp/types` contracts — the assistant page owns the calls, this file owns how an answer
 * *looks*. Everything here is derived from the payload the API returned: the deterministic
 * `summary` is always shown even when a provider narrated a `DATA_WITH_NARRATION` response, because
 * the figure the system computed is the part a reader has to be able to trust.
 */

import React from 'react';
import { Card } from '@college-erp/ui';
import type {
  AiAnswerPayloadDto,
  AiDraftDto,
  AiGeneratedReportDto,
  AiMetricDto,
  AiRiskInsightsDto,
  AiScopeSnapshotDto,
  AiTableDto,
} from '@college-erp/types';

export function formatMetricValue(value: AiMetricDto['value'], unit: AiMetricDto['unit']): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  switch (unit) {
    case 'CURRENCY_CENTS':
      return (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case 'PERCENT':
      return `${value}%`;
    case 'COUNT':
      return value.toLocaleString('en-US');
    default:
      return String(value);
  }
}

export function MetricGrid({ metrics }: { metrics: AiMetricDto[] }) {
  if (metrics.length === 0) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
      {metrics.map((metric) => (
        <div key={metric.key} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 10px' }}>
          <div style={{ fontSize: '0.72rem', color: '#6b7280' }}>{metric.label}</div>
          <div style={{ fontSize: '1.05rem', fontWeight: 600 }}>{formatMetricValue(metric.value, metric.unit)}</div>
          {metric.hint && <div style={{ fontSize: '0.68rem', color: '#9ca3af' }}>{metric.hint}</div>}
        </div>
      ))}
    </div>
  );
}

export function AnswerTable({ table }: { table: AiTableDto }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <h4 style={{ fontSize: '0.85rem' }}>{table.title}</h4>
        <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>
          {table.rows.length} of {table.totalCount.toLocaleString('en-US')} rows
          {table.truncated ? ' (truncated)' : ''}
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr>
              {table.columns.map((column) => (
                <th
                  key={column.key}
                  style={{ textAlign: 'left', borderBottom: '2px solid #e5e7eb', padding: '4px 8px', whiteSpace: 'nowrap' }}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index}>
                {table.columns.map((column) => (
                  <td key={column.key} style={{ borderBottom: '1px solid #f3f4f6', padding: '4px 8px' }}>
                    {renderCell(row[column.key] ?? null, column.format)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length === 0 && <p style={{ fontSize: '0.78rem', color: '#9ca3af', marginTop: 6 }}>No rows.</p>}
    </div>
  );
}

function renderCell(value: string | number | boolean | null, format: string | undefined): string {
  if (value === null) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (format === 'percent' && typeof value === 'number') return `${value}%`;
  if (format === 'currency' && typeof value === 'number') {
    return (value / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (format === 'number' && typeof value === 'number') return value.toLocaleString('en-US');
  return String(value);
}

export function RiskPanel({ risks }: { risks: AiRiskInsightsDto }) {
  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h3 style={{ fontSize: '0.95rem' }}>Students flagged at risk</h3>
        <span style={{ fontSize: '0.75rem', color: '#6b7280' }}>
          {risks.counts.high} high · {risks.counts.medium} medium · {risks.counts.low} low · window{' '}
          {new Date(risks.from).toLocaleDateString()} – {new Date(risks.to).toLocaleDateString()} · attendance &lt;{' '}
          {risks.attendanceThresholdPercent}%
        </span>
      </div>
      <div style={{ overflowX: 'auto', marginTop: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
          <thead>
            <tr>
              <th style={riskTh}>Student</th>
              <th style={riskTh}>Admission no.</th>
              <th style={riskTh}>Program</th>
              <th style={riskTh}>Severity</th>
              <th style={riskTh}>Score</th>
              <th style={riskTh}>Why</th>
            </tr>
          </thead>
          <tbody>
            {risks.students.map((student) => (
              <tr key={student.studentId}>
                <td style={riskTd}>{student.fullName}</td>
                <td style={riskTd}>{student.admissionNumber}</td>
                <td style={riskTd}>{student.program ?? '—'}</td>
                <td style={{ ...riskTd, fontWeight: 600, color: severityColor(student.severity) }}>{student.severity}</td>
                <td style={riskTd}>{student.riskScore}</td>
                <td style={{ ...riskTd, color: '#4b5563' }}>
                  {student.evidence.map((item) => item.detail).join(' ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {risks.students.length === 0 && <p style={{ fontSize: '0.8rem', color: '#9ca3af' }}>No students flagged in this window.</p>}
      {risks.truncated && (
        <p style={{ fontSize: '0.75rem', color: '#b45309', marginTop: 6 }}>
          Showing {risks.students.length} of {risks.totalCount} flagged students.
        </p>
      )}
      <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 8 }}>
        Risk is a weighted heuristic over attendance, fees and results — a prompt to look, not a conclusion.
      </p>
    </Card>
  );
}

const riskTh: React.CSSProperties = {
  textAlign: 'left',
  borderBottom: '2px solid #e5e7eb',
  padding: '4px 8px',
  whiteSpace: 'nowrap',
};
const riskTd: React.CSSProperties = { borderBottom: '1px solid #f3f4f6', padding: '4px 8px', verticalAlign: 'top' };

function severityColor(severity: string): string {
  if (severity === 'HIGH') return '#b91c1c';
  if (severity === 'MEDIUM') return '#b45309';
  return '#15803d';
}

export function DraftPreview({ draft }: { draft: AiDraftDto }) {
  return (
    <Card>
      <h3 style={{ fontSize: '0.95rem' }}>Draft — {draft.tone.toLowerCase()} {draft.channel.toLowerCase()}</h3>
      <p style={{ fontSize: '0.75rem', color: '#6b7280', marginTop: 4 }}>
        Audience: {draft.audience.toLowerCase()} · {draft.audienceSize} recipient(s) ·{' '}
        {draft.narrated ? `phrased by ${draft.provider ?? 'a provider'}` : 'deterministic template'}
      </p>
      <div style={{ marginTop: 8, fontSize: '0.82rem' }}>
        <div style={{ fontWeight: 600 }}>{draft.subject}</div>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', marginTop: 6, color: '#374151' }}>{draft.body}</pre>
      </div>
      <p style={{ fontSize: '0.72rem', color: '#9ca3af', marginTop: 6 }}>
        Nothing has been sent. Sending is a separate action that also needs <code>notifications.send</code>.
      </p>
    </Card>
  );
}

export function ReportPreview({ report }: { report: AiGeneratedReportDto }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <h4 style={{ fontSize: '0.85rem' }}>{report.title}</h4>
        <span style={{ fontSize: '0.72rem', color: '#6b7280' }}>
          {report.reportType} · {report.rowCount} of {report.totalCount.toLocaleString('en-US')} rows
          {report.savedReportId ? ` · saved ${report.savedReportId.slice(0, 8)}` : ''}
        </span>
      </div>
      <p style={{ fontSize: '0.75rem', color: '#6b7280' }}>{report.description}</p>
      <AnswerTable
        table={{
          title: report.title,
          columns: report.columns,
          rows: report.rows,
          totalCount: report.totalCount,
          truncated: report.truncated,
        }}
      />
    </div>
  );
}

export function ScopeNote({ scope }: { scope: AiScopeSnapshotDto }) {
  if (scope.isGlobal) {
    return (
      <p style={{ fontSize: '0.72rem', color: '#6b7280' }}>
        Scope: institution-wide (every campus, department and program your grants cover).
      </p>
    );
  }
  const parts = scope.effectiveGrants.map((grant) =>
    grant.scopeType === 'CAMPUS'
      ? `campus ${grant.campusId?.slice(0, 8)}`
      : grant.scopeType === 'DEPARTMENT'
        ? `department ${grant.departmentId?.slice(0, 8)}`
        : grant.scopeType === 'PROGRAM'
          ? `program ${grant.programId?.slice(0, 8)}`
          : grant.scopeType,
  );
  return (
    <p style={{ fontSize: '0.72rem', color: '#6b7280' }}>
      Scope: {parts.length > 0 ? parts.join(', ') : 'no grants'} — this answer was narrowed, not widened, by your
      permissions.
    </p>
  );
}

/** Renders whichever of the payload's optional bodies is present. */
export function AnswerBody({ payload, showTables = true }: { payload: AiAnswerPayloadDto; showTables?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ fontSize: '0.85rem' }}>{payload.summary}</p>
      <MetricGrid metrics={payload.metrics} />
      {payload.risks && <RiskPanel risks={payload.risks} />}
      {payload.report && <ReportPreview report={payload.report} />}
      {showTables && !payload.report && payload.tables.map((table) => <AnswerTable key={table.title} table={table} />)}
      {payload.caveats.length > 0 && (
        <ul style={{ fontSize: '0.74rem', color: '#6b7280', margin: 0, paddingLeft: 18 }}>
          {payload.caveats.map((caveat, index) => (
            <li key={index}>{caveat}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
