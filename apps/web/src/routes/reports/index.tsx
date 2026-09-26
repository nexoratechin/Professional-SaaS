import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Input } from '@college-erp/ui';
import { useAuth } from '../../features/auth/auth-context';
import { apiFetch } from '../../lib/http';
import {
  clearDependentReportFilters,
  createEmptyReportFilters,
  displayCellValue,
  extractSignedUrl,
  formatDateTime,
  getCellValue,
  getChoicesForFilter,
  getPreviewColumns,
  getSupportedFilterKeys,
  isRecord,
  isRunFailed,
  normalizeReportDefinition,
  normalizeReportOptions,
  normalizeReportPreview,
  normalizeReportRun,
  normalizeReportSchedule,
  normalizeReportTemplate,
  normalizeSavedReport,
  runStatusLabel,
  runStatusTone,
  serializeReportFilters,
  shouldPollRuns,
  supportsFilter,
  unwrapCollection,
  validateScheduleDraft,
  type ReportColumn,
  type ReportDefinition,
  type ReportFilterKey,
  type ReportFilters,
  type ReportOptions,
  type ReportPreview,
  type ReportRun,
  type ReportSchedule,
  type ReportTemplate,
  type SavedReport,
  type ScheduleDraft,
} from './reports-helpers';

const VIEW = 'reports.view';
const EXPORT = 'reports.export';
const MANAGE = 'reports.manage';

const FILTER_LABELS: Record<ReportFilterKey, string> = {
  dateFrom: 'From date',
  dateTo: 'To date',
  campusId: 'Campus',
  departmentId: 'Department',
  programId: 'Program',
  sectionId: 'Section',
  academicYearId: 'Academic year',
  termId: 'Term',
  search: 'Search',
  status: 'Status',
};

const FORMATS = ['CSV', 'EXCEL', 'PDF'] as const;
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type Tab = 'overview' | 'saved' | 'templates' | 'schedules' | 'history';

const selectStyle: React.CSSProperties = { padding: '0.5rem', borderRadius: 6, border: '1px solid #d1d5db', background: '#fff', minWidth: 160 };
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid #f1f5f9', whiteSpace: 'nowrap' };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function ReportsPage() {
  const { permissions, entitlements } = useAuth();
  const canView = permissions.includes(VIEW) || permissions.includes(MANAGE);
  const canExport = permissions.includes(EXPORT) || permissions.includes(MANAGE);
  const canManage = permissions.includes(MANAGE);

  const [tab, setTab] = useState<Tab>('overview');
  const [catalog, setCatalog] = useState<ReportDefinition[]>([]);
  const [options, setOptions] = useState<ReportOptions>(normalizeReportOptions(null));
  const [selectedType, setSelectedType] = useState('');
  const [filters, setFilters] = useState<ReportFilters>(createEmptyReportFilters());
  const [preview, setPreview] = useState<ReportPreview | null>(null);
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [saved, setSaved] = useState<SavedReport[]>([]);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [savedName, setSavedName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateColumns, setTemplateColumns] = useState<string[]>([]);
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>({
    name: '',
    reportType: '',
    savedReportId: '',
    templateId: '',
    frequency: 'DAILY',
    time: '08:00',
    timezone: 'Asia/Kolkata',
    format: 'CSV',
    isActive: true,
    dayOfWeek: 1,
    dayOfMonth: 1,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(() => catalog.find((entry) => entry.reportType === selectedType) ?? null, [catalog, selectedType]);

  const refreshRuns = useCallback(async () => {
    const response = await apiFetch<unknown>('/reports/runs?take=50');
    const items = isRecord(response) ? unwrapCollection(response.items) : unwrapCollection(response);
    setRuns(items.map((item, index) => normalizeReportRun(item, index)));
  }, []);

  const loadReferenceData = useCallback(async () => {
    const [catalogResponse, optionsResponse, runsResponse, savedResponse, templateResponse, scheduleResponse] = await Promise.all([
      apiFetch<unknown>('/reports'),
      apiFetch<unknown>('/reports/options'),
      apiFetch<unknown>('/reports/runs?take=50'),
      apiFetch<unknown>('/reports/saved?take=100'),
      apiFetch<unknown>('/reports/templates?take=100'),
      apiFetch<unknown>('/reports/schedules?take=100'),
    ]);
    const entries = unwrapCollection(catalogResponse).map((item, index) => normalizeReportDefinition(item, index));
    setCatalog(entries);
    setOptions(normalizeReportOptions(optionsResponse));
    const runItems = isRecord(runsResponse) ? unwrapCollection(runsResponse.items) : unwrapCollection(runsResponse);
    setRuns(runItems.map((item, index) => normalizeReportRun(item, index)));
    const savedItems = isRecord(savedResponse) ? unwrapCollection(savedResponse.items) : unwrapCollection(savedResponse);
    setSaved(savedItems.map((item, index) => normalizeSavedReport(item, index)));
    const templateItems = isRecord(templateResponse) ? unwrapCollection(templateResponse.items) : unwrapCollection(templateResponse);
    setTemplates(templateItems.map((item, index) => normalizeReportTemplate(item, index)));
    const scheduleItems = isRecord(scheduleResponse) ? unwrapCollection(scheduleResponse.items) : unwrapCollection(scheduleResponse);
    setSchedules(scheduleItems.map((item, index) => normalizeReportSchedule(item, index)));
  }, []);

  useEffect(() => {
    if (!canView) return;
    loadReferenceData().catch((err) => setError(errorMessage(err)));
    // Data is intentionally loaded once per page visit; `loadReferenceData` is stable so picking a
    // different report does not re-fetch the catalog.
  }, [canView, loadReferenceData]);

  useEffect(() => {
    if (selectedType || catalog.length === 0) return;
    selectReport(catalog[0]!);
  }, [catalog, selectedType]);

  useEffect(() => {
    if (!shouldPollRuns(runs)) return;
    const timer = window.setInterval(() => {
      refreshRuns().catch(() => undefined);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [runs, refreshRuns]);

  function selectReport(definition: ReportDefinition) {
    setSelectedType(definition.reportType);
    setPreview(null);
    setScheduleDraft((draft) => ({ ...draft, reportType: definition.reportType }));
    setTemplateColumns(definition.columns.map((column) => column.key));
  }

  function updateFilter(key: ReportFilterKey, value: string) {
    setFilters((current) => clearDependentReportFilters({ ...current, [key]: value }, key));
  }

  async function runPreview() {
    if (!selectedType) return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch<unknown>('/reports/preview', {
        method: 'POST',
        body: JSON.stringify({ reportType: selectedType, filters: serializeReportFilters(filters, selected?.supportedFilters) }),
      });
      setPreview(normalizeReportPreview(response));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function exportReport(format: string) {
    if (!selectedType) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/reports/exports', {
        method: 'POST',
        body: JSON.stringify({
          reportType: selectedType,
          format,
          filters: serializeReportFilters(filters, selected?.supportedFilters),
        }),
      });
      setNotice(`${format} export queued.`);
      setTab('history');
      await refreshRuns();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function saveCurrent() {
    if (!selectedType || !savedName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/reports/saved', {
        method: 'POST',
        body: JSON.stringify({ name: savedName.trim(), reportType: selectedType, filters: serializeReportFilters(filters, selected?.supportedFilters) }),
      });
      setSavedName('');
      setNotice('Saved report created.');
      await loadReferenceData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSaved(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/reports/saved/${id}`, { method: 'DELETE' });
      await loadReferenceData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function loadSaved(report: SavedReport) {
    setSelectedType(report.reportType);
    setFilters(report.filters);
    setTab('overview');
  }

  async function createTemplate() {
    if (!selectedType || !templateName.trim() || templateColumns.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/reports/templates', {
        method: 'POST',
        body: JSON.stringify({
          name: templateName.trim(),
          reportType: selectedType,
          definition: { columns: templateColumns.map((key) => ({ key })) },
        }),
      });
      setTemplateName('');
      setNotice('Template created.');
      await loadReferenceData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/reports/templates/${id}`, { method: 'DELETE' });
      await loadReferenceData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function createSchedule() {
    const validation = validateScheduleDraft(scheduleDraft);
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/reports/schedules', {
        method: 'POST',
        body: JSON.stringify({
          name: scheduleDraft.name.trim(),
          reportType: scheduleDraft.reportType,
          templateId: scheduleDraft.templateId || undefined,
          format: scheduleDraft.format,
          frequency: scheduleDraft.frequency,
          timeOfDay: scheduleDraft.time,
          timezone: scheduleDraft.timezone,
          dayOfWeek: scheduleDraft.frequency === 'WEEKLY' ? scheduleDraft.dayOfWeek : undefined,
          dayOfMonth: scheduleDraft.frequency === 'MONTHLY' ? scheduleDraft.dayOfMonth : undefined,
          filters: serializeReportFilters(filters, selected?.supportedFilters),
          isActive: scheduleDraft.isActive,
        }),
      });
      setNotice('Schedule created.');
      await loadReferenceData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteSchedule(id: string) {
    setBusy(true);
    try {
      await apiFetch(`/reports/schedules/${id}`, { method: 'DELETE' });
      await loadReferenceData();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function downloadRun(id: string) {
    setError(null);
    try {
      const response = await apiFetch<unknown>(`/reports/runs/${id}/download`);
      const url = extractSignedUrl(response);
      if (!url) throw new Error('Download link was not returned.');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (!canView || entitlements.reports === false) {
    return (
      <div style={{ maxWidth: 720, margin: '2rem auto' }}>
        <Card>You do not have access to reports.</Card>
      </div>
    );
  }

  const previewColumns: ReportColumn[] = getPreviewColumns(preview, selected);

  return (
    <div style={{ maxWidth: 1240, margin: '2rem auto', padding: '0 1rem', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Link to="/dashboard">&larr; Dashboard</Link>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ fontSize: '1.35rem' }}>Reports</h1>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(['overview', 'saved', 'templates', 'schedules', 'history'] as Tab[]).map((entry) => (
            <Button key={entry} variant={tab === entry ? 'primary' : 'secondary'} onClick={() => setTab(entry)}>
              {entry[0]?.toUpperCase()}
              {entry.slice(1)}
            </Button>
          ))}
        </div>
      </div>

      {error && <div style={{ color: '#b91c1c', background: '#fef2f2', padding: '0.6rem 0.8rem', borderRadius: 6 }}>{error}</div>}
      {notice && <div style={{ color: '#166534', background: '#f0fdf4', padding: '0.6rem 0.8rem', borderRadius: 6 }}>{notice}</div>}

      {tab === 'overview' && (
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, alignItems: 'end' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span>Report</span>
              <select
                style={selectStyle}
                value={selectedType}
                onChange={(event) => {
                  const definition = catalog.find((entry) => entry.reportType === event.target.value);
                  if (definition) selectReport(definition);
                }}
              >
                {catalog.map((entry) => (
                  <option key={entry.reportType} value={entry.reportType}>{entry.category} · {entry.name}</option>
                ))}
              </select>
            </label>
            {selected && getSupportedFilterKeys(selected.supportedFilters).map((key) => {
              if (key === 'status' && !supportsFilter(selected.supportedFilters, key)) return null;
              if (key === 'dateFrom' || key === 'dateTo') {
                return (
                  <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>{FILTER_LABELS[key]}</span>
                    <input type="date" style={selectStyle} value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)} />
                  </label>
                );
              }
              if (key === 'search' || key === 'status') {
                return (
                  <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span>{FILTER_LABELS[key]}</span>
                    <input style={selectStyle} value={filters[key]} placeholder={key === 'search' ? 'Name, code, number…' : 'Exact status'} onChange={(event) => updateFilter(key, event.target.value)} />
                  </label>
                );
              }
              const choices = getChoicesForFilter(options, key, filters);
              return (
                <label key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>{FILTER_LABELS[key]}</span>
                  <select style={selectStyle} value={filters[key]} onChange={(event) => updateFilter(key, event.target.value)}>
                    <option value="">All</option>
                    {choices.map((choice) => (
                      <option key={choice.id} value={choice.id}>{choice.label}</option>
                    ))}
                  </select>
                </label>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
            <Button onClick={() => void runPreview()} disabled={busy || !selectedType}>Run preview</Button>
            {canExport && FORMATS.map((format) => (
              <Button key={format} variant="secondary" onClick={() => void exportReport(format)} disabled={busy || !selectedType}>Export {format}</Button>
            ))}
            {selected?.sourcePath && <Link to={selected.sourcePath} style={{ marginLeft: 'auto' }}>Open specialized report →</Link>}
          </div>

          {selected && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              <Input label="Save as" id="saved-name" value={savedName} onChange={(event) => setSavedName(event.target.value)} placeholder="e.g. Overdue fees by campus" />
              <Button variant="secondary" onClick={() => void saveCurrent()} disabled={busy || !savedName.trim()}>Save configuration</Button>
            </div>
          )}
        </Card>
      )}

      {tab === 'overview' && preview && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '1rem' }}>{selected?.name ?? 'Preview'}</h2>
            <span style={{ color: '#6b7280' }}>{preview.rowCount} of {preview.totalCount} rows{preview.truncated ? ' (truncated)' : ''} · {formatDateTime(preview.generatedAt)}</span>
          </div>
          <div style={{ overflowX: 'auto', marginTop: 10 }}>
            <table style={tableStyle}>
              <thead>
                <tr>{previewColumns.map((column) => <th key={column.key} style={thStyle}>{column.label}</th>)}</tr>
              </thead>
              <tbody>
                {preview.rows.length === 0 && <tr><td style={tdStyle} colSpan={Math.max(1, previewColumns.length)}>No rows match the selected filters.</td></tr>}
                {preview.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {previewColumns.map((column) => (
                      <td key={column.key} style={tdStyle}>{displayCellValue(getCellValue(row, column.key))}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === 'saved' && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Saved reports</h2>
          {saved.length === 0 && <p style={{ color: '#6b7280' }}>No saved reports yet. Run a report and save its configuration.</p>}
          <div style={{ display: 'grid', gap: 8 }}>
            {saved.map((entry) => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.6rem 0.8rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{entry.name}</strong>
                  <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{entry.reportType} · updated {formatDateTime(entry.updatedAt)}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Button variant="secondary" onClick={() => loadSaved(entry)}>Load</Button>
                  <Button variant="secondary" onClick={() => void deleteSaved(entry.id)} disabled={busy}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'templates' && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Report templates</h2>
          {canManage && selected && (
            <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
              <Input label="Template name" id="template-name" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {selected.columns.map((column) => (
                  <label key={column.key} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: '0.85rem' }}>
                    <input
                      type="checkbox"
                      checked={templateColumns.includes(column.key)}
                      onChange={(event) =>
                        setTemplateColumns((current) =>
                          event.target.checked ? [...current, column.key] : current.filter((key) => key !== column.key),
                        )
                      }
                    />
                    {column.label}
                  </label>
                ))}
              </div>
              <Button variant="secondary" onClick={() => void createTemplate()} disabled={busy || !templateName.trim() || templateColumns.length === 0}>
                Create template for {selected.name}
              </Button>
            </div>
          )}
          {templates.length === 0 && <p style={{ color: '#6b7280' }}>No templates yet.</p>}
          <div style={{ display: 'grid', gap: 8 }}>
            {templates.map((entry) => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.6rem 0.8rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{entry.name}</strong>
                  <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{entry.reportType} · {entry.columnOrder.length || entry.visibleColumns.length} columns</div>
                </div>
                {canManage && <Button variant="secondary" onClick={() => void deleteTemplate(entry.id)} disabled={busy}>Delete</Button>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'schedules' && (
        <Card>
          <h2 style={{ fontSize: '1rem', marginBottom: 10 }}>Scheduled exports</h2>
          {canManage && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10, marginBottom: 14 }}>
              <Input label="Name" id="schedule-name" value={scheduleDraft.name} onChange={(event) => setScheduleDraft({ ...scheduleDraft, name: event.target.value })} />
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Report</span>
                <select style={selectStyle} value={scheduleDraft.reportType} onChange={(event) => setScheduleDraft({ ...scheduleDraft, reportType: event.target.value })}>
                  {catalog.map((entry) => <option key={entry.reportType} value={entry.reportType}>{entry.name}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Frequency</span>
                <select style={selectStyle} value={scheduleDraft.frequency} onChange={(event) => setScheduleDraft({ ...scheduleDraft, frequency: event.target.value })}>
                  <option value="DAILY">Daily</option>
                  <option value="WEEKLY">Weekly</option>
                  <option value="MONTHLY">Monthly</option>
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Time</span>
                <input type="time" style={selectStyle} value={scheduleDraft.time} onChange={(event) => setScheduleDraft({ ...scheduleDraft, time: event.target.value })} />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Timezone</span>
                <select style={selectStyle} value={scheduleDraft.timezone} onChange={(event) => setScheduleDraft({ ...scheduleDraft, timezone: event.target.value })}>
                  {TIMEZONES.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Format</span>
                <select style={selectStyle} value={scheduleDraft.format} onChange={(event) => setScheduleDraft({ ...scheduleDraft, format: event.target.value })}>
                  {FORMATS.map((format) => <option key={format} value={format}>{format}</option>)}
                </select>
              </label>
              {scheduleDraft.frequency === 'WEEKLY' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Day</span>
                  <select style={selectStyle} value={scheduleDraft.dayOfWeek ?? 1} onChange={(event) => setScheduleDraft({ ...scheduleDraft, dayOfWeek: Number(event.target.value) })}>
                    {DAYS.map((day, index) => <option key={day} value={index}>{day}</option>)}
                  </select>
                </label>
              )}
              {scheduleDraft.frequency === 'MONTHLY' && (
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span>Day of month</span>
                  <input type="number" min={1} max={31} style={selectStyle} value={scheduleDraft.dayOfMonth ?? 1} onChange={(event) => setScheduleDraft({ ...scheduleDraft, dayOfMonth: Number(event.target.value) })} />
                </label>
              )}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span>Template (optional)</span>
                <select style={selectStyle} value={scheduleDraft.templateId} onChange={(event) => setScheduleDraft({ ...scheduleDraft, templateId: event.target.value })}>
                  <option value="">None</option>
                  {templates.filter((entry) => entry.reportType === scheduleDraft.reportType).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <Button variant="secondary" onClick={() => void createSchedule()} disabled={busy}>Create schedule</Button>
              </div>
            </div>
          )}
          {schedules.length === 0 && <p style={{ color: '#6b7280' }}>No scheduled exports yet.</p>}
          <div style={{ display: 'grid', gap: 8 }}>
            {schedules.map((entry) => (
              <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, border: '1px solid #e5e7eb', borderRadius: 6, padding: '0.6rem 0.8rem', flexWrap: 'wrap' }}>
                <div>
                  <strong>{entry.name}</strong>
                  <div style={{ color: '#6b7280', fontSize: '0.8rem' }}>{entry.reportType} · {entry.frequency} at {entry.time} {entry.timezone} · {entry.format} · {entry.isActive ? 'active' : 'paused'}</div>
                </div>
                <Button variant="secondary" onClick={() => void deleteSchedule(entry.id)} disabled={busy || !canManage}>Delete</Button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {tab === 'history' && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h2 style={{ fontSize: '1rem' }}>Export history</h2>
            <Button variant="secondary" onClick={() => void refreshRuns()}>Refresh</Button>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Report</th>
                  <th style={thStyle}>Format</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Rows</th>
                  <th style={thStyle}>Created</th>
                  <th style={thStyle}>Completed</th>
                  <th style={thStyle} />
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 && <tr><td style={tdStyle} colSpan={7}>No exports yet.</td></tr>}
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td style={tdStyle}>{run.reportName || run.reportType}</td>
                    <td style={tdStyle}>{run.format}</td>
                    <td style={{ ...tdStyle, color: runStatusTone(run.status) === 'error' ? '#b91c1c' : runStatusTone(run.status) === 'success' ? '#166534' : '#92400e' }}>
                      {runStatusLabel(run.status)}
                      {run.error ? ` · ${run.error}` : ''}
                    </td>
                    <td style={tdStyle}>{run.rowCount ?? '—'}</td>
                    <td style={tdStyle}>{formatDateTime(run.createdAt)}</td>
                    <td style={tdStyle}>{formatDateTime(run.completedAt)}</td>
                    <td style={tdStyle}>
                      {canExport && run.status === 'COMPLETED' && !isRunFailed(run.status) && (
                        <Button variant="secondary" onClick={() => void downloadRun(run.id)}>Download</Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
