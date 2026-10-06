import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../features/auth/auth-context';
import { apiFetch, apiFetchPaged } from '../lib/http';

/**
 * Bulk import/export workspace: pick an entity, download a template, upload a CSV/XLSX, map
 * columns, preview the validated rows, then commit as a background import. Import history,
 * the per-row error report and partial retry are all driven off the same job record.
 */

type Format = 'CSV' | 'XLSX';

interface FieldMeta {
  field: string;
  header: string;
  aliases: string[];
  required: boolean;
  type: string;
  enumValues: string[] | null;
  description: string | null;
  sample: string | null;
}

interface EntityMeta {
  key: string;
  label: string;
  module: string;
  importPermission: string;
  viewPermission: string;
  fields: FieldMeta[];
}

interface PreviewRow {
  rowNumber: number;
  status: 'VALID' | 'INVALID' | 'DUPLICATE';
  sourceKey: string | null;
  issues: Array<{ field?: string; code: string; message: string }>;
  mapped: Record<string, unknown>;
}

interface PreviewResult {
  entity: string;
  format: Format;
  headers: string[];
  mapping: Record<string, string>;
  templateHeaders: string[];
  summary: {
    totalRows: number;
    validRows: number;
    invalidRows: number;
    duplicateRows: number;
    missingRequired: string[];
    unmappedHeaders: string[];
    previewedRows: number;
  };
  rows: PreviewRow[];
}

interface JobView {
  id: string;
  entityType: string;
  format: Format;
  status: string;
  mode: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  insertedRows: number;
  updatedRows: number;
  failedRows: number;
  message: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface JobRowView {
  id: string;
  rowNumber: number;
  status: string;
  sourceKey: string | null;
  errors: Array<{ field?: string; message: string }>;
  message: string | null;
}

interface SignedFile {
  url: string;
  fileName: string;
}

interface SavedMapping {
  id: string;
  entityType: string;
  name: string;
  mapping: Record<string, string> | null;
}

const ACTIVE_STATUSES = ['PENDING', 'QUEUED', 'VALIDATING', 'VALIDATED', 'RUNNING'];

function statusColor(status: string): string {
  if (['COMPLETED'].includes(status)) return '#15803d';
  if (['PARTIAL', 'FAILED'].includes(status)) return '#b91c1c';
  if (ACTIVE_STATUSES.includes(status)) return '#b45309';
  return '#6b7280';
}

function contentTypeFor(format: Format): string {
  return format === 'XLSX'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';
}

function openFile(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

export function ImportExportPage() {
  const { permissions } = useAuth();
  const [entities, setEntities] = useState<EntityMeta[]>([]);
  const [entityKey, setEntityKey] = useState<string>('');
  const [format, setFormat] = useState<Format>('CSV');
  const [duplicateStrategy, setDuplicateStrategy] = useState<'SKIP' | 'UPDATE' | 'FAIL'>('SKIP');
  const [file, setFile] = useState<File | null>(null);
  const [storageKey, setStorageKey] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [jobs, setJobs] = useState<JobView[]>([]);
  const [selectedJob, setSelectedJob] = useState<{ job: JobView; rows: JobRowView[]; rowTotal: number } | null>(null);
  const [savedMappings, setSavedMappings] = useState<SavedMapping[]>([]);
  const [mappingName, setMappingName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const visibleEntities = useMemo(
    () => entities.filter((entity) => permissions.includes(entity.viewPermission)),
    [entities, permissions],
  );
  const entity = useMemo(
    () => visibleEntities.find((candidate) => candidate.key === entityKey) ?? null,
    [visibleEntities, entityKey],
  );
  const canImport = entity ? permissions.includes(entity.importPermission) : false;

  // ── Load registry + history ────────────────────────────────────────────────
  useEffect(() => {
    void apiFetch<{ entities: EntityMeta[] }>('/imports/entities')
      .then((result) => setEntities(result.entities))
      .catch((err: Error) => setError(err.message));
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const { data, total } = await apiFetchPaged<JobView[]>('/imports/jobs?take=25');
      setJobs(data);
      void total;
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs]);

  const loadMappings = useCallback(async (key: string) => {
    try {
      const result = await apiFetch<{ items: SavedMapping[] }>(`/imports/templates?entity=${encodeURIComponent(key)}`);
      setSavedMappings(result.items);
    } catch {
      setSavedMappings([]);
    }
  }, []);

  useEffect(() => {
    if (entityKey) void loadMappings(entityKey);
  }, [entityKey, loadMappings]);

  // ── Auto-poll a running job ────────────────────────────────────────────────
  const selectedJobId = selectedJob?.job.id;
  const selectedStatus = selectedJob?.job.status;
  useEffect(() => {
    if (pollRef.current) {
      window.clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (!selectedJobId || !selectedStatus || !ACTIVE_STATUSES.includes(selectedStatus)) return;
    pollRef.current = window.setInterval(() => {
      void apiFetch<{ job: JobView; rows: JobRowView[]; rowTotal: number }>(`/imports/jobs/${selectedJobId}`)
        .then((result) => setSelectedJob(result))
        .catch(() => undefined);
    }, 2500);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, [selectedJobId, selectedStatus]);

  // ── Handlers ───────────────────────────────────────────────────────────────
  const resetFileState = () => {
    setFile(null);
    setStorageKey(null);
    setPreview(null);
    setMapping({});
  };

  const handleTemplate = async () => {
    if (!entity) return;
    try {
      const signed = await apiFetch<SignedFile>(`/imports/entities/${entity.key}/template?format=${format}`);
      openFile(signed.url);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleFile = async (chosen: File | null) => {
    setError(null);
    setPreview(null);
    setMapping({});
    setStorageKey(null);
    setFile(chosen);
    if (!chosen || !entity) return;
    try {
      setUploading(true);
      const signed = await apiFetch<{ uploadUrl: string; storageKey: string; format: Format }>(
        `/imports/${entity.key}/upload-url`,
        { method: 'POST', body: JSON.stringify({ fileName: chosen.name, sizeBytes: chosen.size }) },
      );
      const response = await fetch(signed.uploadUrl, {
        method: 'PUT',
        body: chosen,
        headers: { 'Content-Type': contentTypeFor(signed.format) },
      });
      if (!response.ok) throw new Error('Upload to storage failed.');
      setStorageKey(signed.storageKey);
      await runPreview(signed.storageKey, entity.key);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const runPreview = async (key: string, entityKeyValue: string) => {
    const result = await apiFetch<PreviewResult>(`/imports/${entityKeyValue}/preview`, {
      method: 'POST',
      body: JSON.stringify({ storageKey: key, duplicateStrategy, limit: 100 }),
    });
    setPreview(result);
    setMapping(result.mapping);
  };

  const handleCreateJob = async () => {
    if (!entity || !storageKey || !file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await apiFetch<{ job: JobView; rows: JobRowView[]; rowTotal: number }>(`/imports/${entity.key}/jobs`, {
        method: 'POST',
        body: JSON.stringify({
          storageKey,
          fileName: file.name,
          format: preview?.format ?? format,
          mode: 'COMMIT',
          mapping,
          options: { duplicateStrategy },
        }),
      });
      setSelectedJob(result);
      resetFileState();
      await loadJobs();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleSelectJob = async (jobId: string) => {
    try {
      const result = await apiFetch<{ job: JobView; rows: JobRowView[]; rowTotal: number }>(`/imports/jobs/${jobId}`);
      setSelectedJob(result);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      const result = await apiFetch<{ job: JobView; rows: JobRowView[]; rowTotal: number }>(`/imports/jobs/${jobId}/retry`, {
        method: 'POST',
      });
      setSelectedJob(result);
      await loadJobs();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleErrors = async (jobId: string) => {
    try {
      const signed = await apiFetch<SignedFile>(`/imports/jobs/${jobId}/errors?format=${format}`);
      openFile(signed.url);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSaveMapping = async () => {
    if (!entity || !mappingName.trim()) return;
    try {
      await apiFetch('/imports/templates', {
        method: 'POST',
        body: JSON.stringify({ entity: entity.key, name: mappingName.trim(), mapping }),
      });
      setMappingName('');
      await loadMappings(entity.key);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleApplyMapping = (saved: SavedMapping) => {
    if (saved.mapping) setMapping(saved.mapping);
  };

  return (
    <div style={{ maxWidth: 1100, margin: '2rem auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 style={{ fontSize: '1.25rem' }}>Bulk Import / Export</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label>Format</label>
          <select value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            <option value="CSV">CSV</option>
            <option value="XLSX">Excel (XLSX)</option>
          </select>
        </div>
      </div>

      {error && <Card><p style={{ color: '#b91c1c' }}>{error}</p></Card>}

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>1. Choose entity & download template</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <select
            value={entityKey}
            onChange={(e) => {
              setEntityKey(e.target.value);
              resetFileState();
            }}
          >
            <option value="">Select an entity…</option>
            {visibleEntities.map((candidate) => (
              <option key={candidate.key} value={candidate.key}>{candidate.label}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={handleTemplate} disabled={!entity}>
            Download template ({format})
          </Button>
          <Button variant="secondary" onClick={() => entity && void apiFetch<SignedFile>(`/imports/entities/${entity.key}/export?format=${format}`).then((s) => openFile(s.url)).catch((err: Error) => setError(err.message))} disabled={!entity}>
            Export current data
          </Button>
        </div>
        {entity && (
          <p style={{ color: '#6b7280', marginTop: 8, fontSize: 13 }}>
            {entity.fields.length} columns · duplicate key: {entity.fields.filter((f) => f.required).map((f) => f.header).join(', ') || '—'}
          </p>
        )}
        {!canImport && entity && <p style={{ color: '#b45309', marginTop: 8 }}>You have read-only access to {entity.label} bulk tools.</p>}
      </Card>

      <Card>
        <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>2. Upload file</h2>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="file"
            accept=".csv,.xlsx,.xls"
            disabled={!entity || !canImport || uploading}
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          <label>Duplicate rows</label>
          <select value={duplicateStrategy} onChange={(e) => setDuplicateStrategy(e.target.value as 'SKIP' | 'UPDATE' | 'FAIL')}>
            <option value="SKIP">Skip</option>
            <option value="UPDATE">Update existing</option>
            <option value="FAIL">Fail row</option>
          </select>
          {uploading && <span>Uploading…</span>}
          {storageKey && <span style={{ color: '#15803d' }}>Uploaded ✓</span>}
        </div>
      </Card>

      {preview && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>3. Map columns & preview</h2>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            {preview.summary.totalRows} rows · {preview.summary.validRows} valid · {preview.summary.invalidRows} invalid ·{' '}
            {preview.summary.duplicateRows} duplicate (showing {preview.summary.previewedRows})
          </p>
          {preview.summary.missingRequired.length > 0 && (
            <p style={{ color: '#b91c1c', fontSize: 13 }}>
              Missing required columns: {preview.summary.missingRequired.join(', ')}
            </p>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8, margin: '12px 0' }}>
            {entity?.fields.map((field) => (
              <label key={field.field} style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>
                  {field.header}
                  {field.required ? ' *' : ''}
                </span>
                <select
                  value={Object.entries(mapping).find(([, target]) => target === field.field)?.[0] ?? ''}
                  onChange={(e) => {
                    const source = e.target.value;
                    setMapping((prev) => {
                      const next: Record<string, string> = {};
                      for (const [key, value] of Object.entries(prev)) {
                        if (value !== field.field && key !== source) next[key] = value;
                      }
                      if (source) next[source] = field.field;
                      return next;
                    });
                  }}
                >
                  <option value="">— not mapped —</option>
                  {preview.headers.map((header) => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {preview.summary.unmappedHeaders.length > 0 && (
            <p style={{ fontSize: 12, color: '#9ca3af' }}>Ignored columns: {preview.summary.unmappedHeaders.join(', ')}</p>
          )}

          <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Input placeholder="Save mapping as…" value={mappingName} onChange={(e) => setMappingName(e.target.value)} />
            <Button variant="secondary" onClick={handleSaveMapping} disabled={!mappingName.trim()}>Save mapping</Button>
            <Button onClick={handleCreateJob} disabled={!canImport || busy}>Start import</Button>
          </div>

          {savedMappings.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 13 }}>
              Saved mappings:{' '}
              {savedMappings.map((saved) => (
                <button key={saved.id} type="button" onClick={() => handleApplyMapping(saved)} style={{ marginRight: 8 }}>
                  {saved.name}
                </button>
              ))}
            </div>
          )}

          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={cellHeader}>Row</th>
                  <th style={cellHeader}>Status</th>
                  <th style={cellHeader}>Issues</th>
                  <th style={cellHeader}>Preview</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 25).map((row) => (
                  <tr key={row.rowNumber}>
                    <td style={cell}>{row.rowNumber}</td>
                    <td style={{ ...cell, color: statusColor(row.status === 'INVALID' ? 'FAILED' : row.status === 'DUPLICATE' ? 'PARTIAL' : 'COMPLETED') }}>
                      {row.status}
                    </td>
                    <td style={cell}>{row.issues.map((issue) => issue.message).join('; ')}</td>
                    <td style={cell}>{Object.entries(row.mapped).slice(0, 4).map(([k, v]) => `${k}=${String(v)}`).join(', ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>Import history</h2>
          <Button variant="secondary" onClick={() => void loadJobs()}>Refresh</Button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                <th style={cellHeader}>Entity</th>
                <th style={cellHeader}>File</th>
                <th style={cellHeader}>Status</th>
                <th style={cellHeader}>Rows</th>
                <th style={cellHeader}>Inserted</th>
                <th style={cellHeader}>Updated</th>
                <th style={cellHeader}>Failed</th>
                <th style={cellHeader}>Created</th>
                <th style={cellHeader} />
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id}>
                  <td style={cell}>{job.entityType}</td>
                  <td style={cell}>{job.fileName}</td>
                  <td style={{ ...cell, color: statusColor(job.status) }}>{job.status}</td>
                  <td style={cell}>{job.totalRows}</td>
                  <td style={cell}>{job.insertedRows}</td>
                  <td style={cell}>{job.updatedRows}</td>
                  <td style={cell}>{job.invalidRows + job.failedRows}</td>
                  <td style={cell}>{new Date(job.createdAt).toLocaleString()}</td>
                  <td style={cell}>
                    <button type="button" onClick={() => void handleSelectJob(job.id)}>Details</button>{' '}
                    <button type="button" onClick={() => void handleErrors(job.id)}>Errors</button>{' '}
                    {['COMPLETED', 'PARTIAL', 'FAILED', 'VALIDATED'].includes(job.status) &&
                      job.invalidRows + job.failedRows > 0 && (
                        <button type="button" onClick={() => void handleRetry(job.id)}>Retry failed</button>
                      )}
                  </td>
                </tr>
              ))}
              {jobs.length === 0 && (
                <tr>
                  <td style={cell} colSpan={9}>No imports yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedJob && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 8 }}>
            Job {selectedJob.job.id.slice(0, 8)} — {selectedJob.job.status}
            {ACTIVE_STATUSES.includes(selectedJob.job.status) ? ' (processing…)' : ''}
          </h2>
          <p style={{ fontSize: 13, color: '#6b7280' }}>
            {selectedJob.job.fileName} · {selectedJob.rowTotal} error rows
            {selectedJob.job.message ? ` · ${selectedJob.job.message}` : ''}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={cellHeader}>Row</th>
                  <th style={cellHeader}>Status</th>
                  <th style={cellHeader}>Details</th>
                </tr>
              </thead>
              <tbody>
                {selectedJob.rows.map((row) => (
                  <tr key={row.id}>
                    <td style={cell}>{row.rowNumber}</td>
                    <td style={cell}>{row.status}</td>
                    <td style={cell}>
                      {[row.message, ...row.errors.map((e) => e.message)].filter(Boolean).join('; ')}
                    </td>
                  </tr>
                ))}
                {selectedJob.rows.length === 0 && (
                  <tr>
                    <td style={cell} colSpan={3}>No error rows 🎉</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

const cellHeader: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: '4px 8px' };
const cell: React.CSSProperties = { borderBottom: '1px solid #f3f4f6', padding: '4px 8px', verticalAlign: 'top' };
