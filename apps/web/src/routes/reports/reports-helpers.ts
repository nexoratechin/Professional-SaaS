/** Pure contracts and normalization helpers for the Reports workspace. */

export const REPORTS_VIEW_PERMISSION = 'reports.view';
export const REPORTS_EXPORT_PERMISSION = 'reports.export';
export const REPORTS_MANAGE_PERMISSION = 'reports.manage';

export type ReportFormat = 'CSV' | 'EXCEL' | 'PDF';
export type ReportRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string;

export interface ReportFilters {
  dateFrom: string;
  dateTo: string;
  campusId: string;
  departmentId: string;
  programId: string;
  sectionId: string;
  academicYearId: string;
  termId: string;
  search: string;
  status: string;
}

export type ReportFilterKey = keyof ReportFilters;

export const REPORT_FILTER_KEYS: readonly ReportFilterKey[] = [
  'dateFrom',
  'dateTo',
  'campusId',
  'departmentId',
  'programId',
  'sectionId',
  'academicYearId',
  'termId',
  'search',
  'status',
];

export const EMPTY_REPORT_FILTERS: ReportFilters = {
  dateFrom: '',
  dateTo: '',
  campusId: '',
  departmentId: '',
  programId: '',
  sectionId: '',
  academicYearId: '',
  termId: '',
  search: '',
  status: '',
};

const FILTER_ALIASES: Record<ReportFilterKey, readonly string[]> = {
  dateFrom: ['dateFrom', 'fromDate', 'from', 'startDate', 'dateRangeFrom', 'dateRange'],
  dateTo: ['dateTo', 'toDate', 'to', 'endDate', 'dateRangeTo', 'dateRange'],
  campusId: ['campusId', 'campus', 'campusID'],
  departmentId: ['departmentId', 'department', 'departmentID'],
  programId: ['programId', 'program', 'programID'],
  sectionId: ['sectionId', 'section', 'sectionID'],
  academicYearId: ['academicYearId', 'academicYear', 'academicYearID', 'yearId'],
  termId: ['termId', 'term', 'termID'],
  search: ['search', 'q', 'query', 'generalSearch', 'searchTerm'],
  status: ['status', 'generalStatus', 'recordStatus'],
};

export function createEmptyReportFilters(): ReportFilters {
  return { ...EMPTY_REPORT_FILTERS };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (isRecord(value)) {
      const nested = firstString(value.id, value.value, value.key, value.code, value.label, value.name);
      if (nested) return nested;
    }
  }
  return '';
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return undefined;
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true' || value === '1') return true;
      if (value.toLowerCase() === 'false' || value === '0') return false;
    }
    if (typeof value === 'number' && (value === 0 || value === 1)) return value === 1;
  }
  return undefined;
}

/** Unwraps the small response envelopes used by the API without changing the caller's data. */
export function unwrapRecord(value: unknown): Record<string, unknown> | null {
  let current: unknown = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!isRecord(current)) return null;
    const nested = current.data ?? current.payload ?? current.result;
    if (isRecord(nested)) {
      current = nested;
      continue;
    }
    return current;
  }
  return isRecord(current) ? current : null;
}

export function unwrapEntity(value: unknown): Record<string, unknown> | null {
  const record = unwrapRecord(value);
  if (!record) return null;
  for (const key of ['saved', 'template', 'schedule', 'run', 'item', 'entity']) {
    if (isRecord(record[key])) return record[key];
  }
  return record;
}

export function unwrapCollection<T = unknown>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!isRecord(value)) return [];
  for (const key of ['data', 'items', 'results', 'list', 'rows']) {
    const nested = value[key];
    if (Array.isArray(nested)) return nested as T[];
    if (isRecord(nested)) {
      const result = unwrapCollection<T>(nested);
      if (result.length > 0 || Object.keys(nested).length === 0) return result;
    }
  }
  return [];
}

function normalizedToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function filterKeyFromName(value: unknown): ReportFilterKey | null {
  if (typeof value !== 'string') {
    if (isRecord(value)) return filterKeyFromName(value.key ?? value.name ?? value.field);
    return null;
  }
  const token = normalizedToken(value);
  for (const key of REPORT_FILTER_KEYS) {
    if (FILTER_ALIASES[key].some((alias) => normalizedToken(alias) === token)) return key;
  }
  return null;
}

/** Expands dateRange into both date fields and accepts the singular/plural spellings used by APIs. */
export function getSupportedFilterKeys(supportedFilters?: unknown): ReportFilterKey[] {
  if (supportedFilters === undefined || supportedFilters === null) return [...REPORT_FILTER_KEYS];

  const names: unknown[] = [];
  if (Array.isArray(supportedFilters)) {
    names.push(...supportedFilters);
  } else if (typeof supportedFilters === 'string') {
    names.push(...supportedFilters.split(','));
  } else if (isRecord(supportedFilters)) {
    names.push(...Object.entries(supportedFilters).filter(([, enabled]) => enabled !== false).map(([name]) => name));
  }

  const result = new Set<ReportFilterKey>();
  for (const name of names) {
    const key = filterKeyFromName(name);
    if (key) result.add(key);
    if (typeof name === 'string' && normalizedToken(name) === 'daterange') {
      result.add('dateFrom');
      result.add('dateTo');
    }
  }
  return REPORT_FILTER_KEYS.filter((key) => result.has(key));
}

export function supportsFilter(supportedFilters: unknown, key: ReportFilterKey): boolean {
  if (supportedFilters === undefined || supportedFilters === null) return true;
  return getSupportedFilterKeys(supportedFilters).includes(key);
}

function filterValue(source: Record<string, unknown>, key: ReportFilterKey): string {
  for (const alias of FILTER_ALIASES[key]) {
    const value = firstString(source[alias], source[alias.toLowerCase()]);
    if (value) return value;
  }
  return '';
}

export function normalizeReportFilters(value: unknown): ReportFilters {
  const source = isRecord(value) ? value : {};
  return {
    dateFrom: filterValue(source, 'dateFrom'),
    dateTo: filterValue(source, 'dateTo'),
    campusId: filterValue(source, 'campusId'),
    departmentId: filterValue(source, 'departmentId'),
    programId: filterValue(source, 'programId'),
    sectionId: filterValue(source, 'sectionId'),
    academicYearId: filterValue(source, 'academicYearId'),
    termId: filterValue(source, 'termId'),
    search: filterValue(source, 'search'),
    status: filterValue(source, 'status'),
  };
}

/** Serializes only meaningful values, making the preview/export payload deterministic and safe to omit. */
export function serializeReportFilters(filters: ReportFilters, supportedFilters?: unknown): Record<string, string> {
  const normalized = normalizeReportFilters(filters);
  const supported = supportedFilters === undefined || supportedFilters === null ? null : new Set(getSupportedFilterKeys(supportedFilters));
  const result: Record<string, string> = {};
  for (const key of REPORT_FILTER_KEYS) {
    if (supported && !supported.has(key)) continue;
    const value = normalized[key].trim();
    if (value) result[key] = value;
  }
  return result;
}

export const toReportFilterPayload = serializeReportFilters;

export function clearDependentReportFilters(filters: ReportFilters, changedKey: ReportFilterKey): ReportFilters {
  const next = { ...filters };
  if (changedKey === 'campusId') {
    next.departmentId = '';
    next.programId = '';
    next.sectionId = '';
  } else if (changedKey === 'departmentId') {
    next.programId = '';
    next.sectionId = '';
  } else if (changedKey === 'programId') {
    next.sectionId = '';
  } else if (changedKey === 'academicYearId') {
    next.termId = '';
  }
  return next;
}

export interface ReportChoice {
  id: string;
  label: string;
  code?: string;
  campusId?: string;
  departmentId?: string;
  programId?: string;
  academicYearId?: string;
  parentId?: string;
}

export interface ReportOptions {
  campus: ReportChoice[];
  department: ReportChoice[];
  program: ReportChoice[];
  sections: ReportChoice[];
  academicYears: ReportChoice[];
  terms: ReportChoice[];
}

export function emptyReportOptions(): ReportOptions {
  return { campus: [], department: [], program: [], sections: [], academicYears: [], terms: [] };
}

export function normalizeReportChoice(value: unknown, index = 0): ReportChoice {
  if (typeof value === 'string' || typeof value === 'number') {
    const label = String(value);
    return { id: label, label };
  }
  const source = isRecord(value) ? value : {};
  const label = firstString(source.label, source.name, source.title, source.fullName, source.code, source.value, source.id);
  const id = firstString(source.id, source.value, source.key, source.code, label) || `option-${index}`;
  const parent = isRecord(source.parent) ? source.parent : undefined;
  return {
    id,
    label: label || id,
    code: firstString(source.code) || undefined,
    campusId: firstString(source.campusId, source.campus_id, parent?.campusId) || undefined,
    departmentId: firstString(source.departmentId, source.department_id, parent?.departmentId) || undefined,
    programId: firstString(source.programId, source.program_id, parent?.programId) || undefined,
    academicYearId: firstString(source.academicYearId, source.academic_year_id, parent?.academicYearId) || undefined,
    parentId: firstString(source.parentId, source.parent_id) || undefined,
  };
}

function normalizeChoiceArray(value: unknown): ReportChoice[] {
  if (Array.isArray(value)) return value.map((item, index) => normalizeReportChoice(item, index));
  if (isRecord(value)) {
    return Object.entries(value).map(([key, item], index) => {
      if (isRecord(item) || typeof item === 'string') return normalizeReportChoice({ id: key, ...(isRecord(item) ? item : { name: item }) }, index);
      return normalizeReportChoice(key, index);
    });
  }
  return [];
}

export function normalizeReportOptions(value: unknown): ReportOptions {
  const source = unwrapRecord(value) ?? {};
  const pick = (...keys: string[]): unknown => {
    for (const key of keys) {
      if (source[key] !== undefined) return source[key];
    }
    return [];
  };
  return {
    campus: normalizeChoiceArray(pick('campus', 'campuses')),
    department: normalizeChoiceArray(pick('department', 'departments')),
    program: normalizeChoiceArray(pick('program', 'programs')),
    sections: normalizeChoiceArray(pick('sections', 'section')),
    academicYears: normalizeChoiceArray(pick('academicYears', 'academicYear', 'academic_years', 'years')),
    terms: normalizeChoiceArray(pick('terms', 'term')),
  };
}

const FILTER_OPTION_KEY: Partial<Record<ReportFilterKey, keyof ReportOptions>> = {
  campusId: 'campus',
  departmentId: 'department',
  programId: 'program',
  sectionId: 'sections',
  academicYearId: 'academicYears',
  termId: 'terms',
};

/** Keeps dependent choices useful even when the API does not provide parent metadata. */
export function getChoicesForFilter(options: ReportOptions, key: ReportFilterKey, filters: ReportFilters): ReportChoice[] {
  const optionKey = FILTER_OPTION_KEY[key];
  if (!optionKey) return [];
  const choices = options[optionKey];

  const parentChecks: Array<{ filterKey: ReportFilterKey; choiceKey: keyof ReportChoice }> = [];
  if (key === 'departmentId' || key === 'programId') {
    if (filters.campusId) parentChecks.push({ filterKey: 'campusId', choiceKey: 'campusId' });
  }
  if ((key === 'programId' || key === 'sectionId') && filters.departmentId) {
    parentChecks.push({ filterKey: 'departmentId', choiceKey: 'departmentId' });
  }
  if (key === 'sectionId' && filters.programId) {
    parentChecks.push({ filterKey: 'programId', choiceKey: 'programId' });
  }
  if (key === 'programId' && filters.campusId) {
    // A program can be scoped by campus even when it is not scoped by a department.
    if (!parentChecks.some((check) => check.filterKey === 'campusId')) {
      parentChecks.push({ filterKey: 'campusId', choiceKey: 'campusId' });
    }
  }
  if (key === 'termId' && filters.academicYearId) {
    parentChecks.push({ filterKey: 'academicYearId', choiceKey: 'academicYearId' });
  }

  return choices.filter((choice) =>
    parentChecks.every(({ filterKey, choiceKey }) => {
      const parentValue = filters[filterKey];
      const choiceValue = choice[choiceKey];
      return !choiceValue || !parentValue || choiceValue === parentValue;
    }),
  );
}

export interface ReportColumn {
  key: string;
  label: string;
}

export function normalizeReportColumns(value: unknown): ReportColumn[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      if (typeof item === 'string' || typeof item === 'number') {
        const key = String(item);
        return { key, label: key };
      }
      const source = isRecord(item) ? item : {};
      const key = firstString(source.key, source.field, source.name, source.id, source.value, source.column) || `column-${index + 1}`;
      return { key, label: firstString(source.label, source.title, source.displayName, source.name, key) };
    });
  }
  if (isRecord(value)) {
    return Object.entries(value).map(([key, label]) => ({
      key,
      label: typeof label === 'string' ? label : firstString(label, key),
    }));
  }
  return [];
}

export interface ReportDefinition {
  key: string;
  name: string;
  description: string;
  category: string;
  reportType: string;
  sourcePermission: string;
  sourcePath: string;
  supportedFilters: ReportFilterKey[];
  columns: ReportColumn[];
}

export function normalizeReportDefinition(value: unknown, index = 0): ReportDefinition {
  const source = unwrapRecord(value) ?? {};
  const key = firstString(source.key, source.reportKey, source.reportType, source.name) || `report-${index}`;
  const name = firstString(source.name, source.title, key);
  return {
    key,
    name,
    description: firstString(source.description),
    category: firstString(source.category, source.group, 'General'),
    reportType: firstString(source.reportType, source.type, key),
    sourcePermission: firstString(source.sourcePermission, source.permission),
    sourcePath: firstString(source.sourcePath, source.path),
    supportedFilters: getSupportedFilterKeys(source.supportedFilters),
    columns: normalizeReportColumns(source.columns),
  };
}

export interface ReportPreview {
  definition: unknown;
  rows: unknown[];
  summary: unknown;
  rowCount: number;
  totalCount: number;
  truncated: boolean;
  generatedAt: string;
}

export function normalizeReportPreview(value: unknown): ReportPreview {
  const source = unwrapRecord(value) ?? {};
  const rows = Array.isArray(source.rows) ? source.rows : unwrapCollection(source.rows);
  const rowCount = firstNumber(source.rowCount, source.count) ?? rows.length;
  const totalCount = firstNumber(source.totalCount, source.total, source.totalRows) ?? rowCount;
  return {
    definition: source.definition ?? source.reportDefinition ?? null,
    rows,
    summary: source.summary ?? null,
    rowCount,
    totalCount,
    truncated: firstBoolean(source.truncated, source.isTruncated) ?? false,
    generatedAt: firstString(source.generatedAt, source.generated_at, source.createdAt),
  };
}

export function getPreviewColumns(preview: ReportPreview | null, report: ReportDefinition | null): ReportColumn[] {
  const definition = unwrapRecord(preview?.definition);
  const rawColumns = definition?.columns ?? report?.columns ?? [];
  const columns = normalizeReportColumns(rawColumns);
  if (columns.length > 0) return columns;
  const firstRow = preview?.rows[0];
  if (isRecord(firstRow)) return Object.keys(firstRow).map((key) => ({ key, label: key }));
  return [];
}

export function getCellValue(row: unknown, key: string): unknown {
  if (isRecord(row)) {
    const path = key.split('.');
    let value: unknown = row;
    for (const part of path) {
      if (!isRecord(value)) return undefined;
      value = value[part];
    }
    return value;
  }
  if (Array.isArray(row)) {
    const index = Number(key);
    return Number.isInteger(index) ? row[index] : undefined;
  }
  return row;
}

export function displayCellValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export interface SavedReport {
  id: string;
  name: string;
  description: string;
  reportType: string;
  reportKey: string;
  filters: ReportFilters;
  isPrivate: boolean;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

export function normalizeSavedReport(value: unknown, index = 0): SavedReport {
  const source = unwrapEntity(value) ?? {};
  const configuration = isRecord(source.configuration) ? source.configuration : {};
  const filters = normalizeReportFilters(source.filters ?? configuration.filters ?? source.filter);
  const reportKey = firstString(source.reportKey, source.reportId, source.key);
  return {
    id: firstString(source.id, source.savedReportId, source._id) || `saved-${index}`,
    name: firstString(source.name, source.title) || 'Untitled saved report',
    description: firstString(source.description),
    reportType: firstString(source.reportType, source.type, reportKey),
    reportKey,
    filters,
    isPrivate: firstBoolean(source.isPrivate, source.private, source.visibility === 'PRIVATE' ? true : undefined) ?? false,
    ownerId: firstString(source.ownerId, source.ownerUserId, source.createdById, source.userId, source.createdBy),
    createdAt: firstString(source.createdAt, source.created_at),
    updatedAt: firstString(source.updatedAt, source.updated_at),
    raw: source,
  };
}

export interface ReportTemplate {
  id: string;
  name: string;
  subtitle: string;
  reportType: string;
  visibleColumns: string[];
  columnOrder: string[];
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => (isRecord(item) ? firstString(item.key, item.field, item.id, item.label) : String(item))).filter(Boolean);
  }
  if (typeof value === 'string') return value.split(',').map((item) => item.trim()).filter(Boolean);
  return [];
}

export function normalizeReportTemplate(value: unknown, index = 0): ReportTemplate {
  const source = unwrapEntity(value) ?? {};
  const order = stringList(source.columnOrder ?? source.column_order ?? source.order);
  const visible = stringList(source.visibleColumns ?? source.visible_columns);
  return {
    id: firstString(source.id, source.templateId, source._id) || `template-${index}`,
    name: firstString(source.name, source.title) || 'Untitled template',
    subtitle: firstString(source.subtitle, source.subTitle, source.description),
    reportType: firstString(source.reportType, source.type, source.reportKey),
    visibleColumns: visible.length > 0 ? visible : order,
    columnOrder: order.length > 0 ? order : visible,
    createdAt: firstString(source.createdAt, source.created_at),
    updatedAt: firstString(source.updatedAt, source.updated_at),
    raw: source,
  };
}

export type ReportScheduleFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | string;

export interface ReportSchedule {
  id: string;
  name: string;
  reportType: string;
  savedReportId: string;
  templateId: string;
  frequency: ReportScheduleFrequency;
  time: string;
  timezone: string;
  format: ReportFormat | string;
  isActive: boolean;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  createdAt: string;
  updatedAt: string;
  raw: Record<string, unknown>;
}

function dayOfWeekValue(value: unknown): number | null {
  const numberValue = firstNumber(value);
  if (numberValue !== undefined && Number.isInteger(numberValue) && numberValue >= 0 && numberValue <= 6) return numberValue;
  if (typeof value === 'string') {
    const names: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const nameValue = names[value.toLowerCase()];
    if (nameValue !== undefined) return nameValue;
  }
  return null;
}

function dayOfMonthValue(value: unknown): number | null {
  const numberValue = firstNumber(value);
  return numberValue !== undefined && Number.isInteger(numberValue) && numberValue >= 1 && numberValue <= 31 ? numberValue : null;
}

export function normalizeReportSchedule(value: unknown, index = 0): ReportSchedule {
  const source = unwrapEntity(value) ?? {};
  const frequency = firstString(source.frequency, source.scheduleType, source.cadence, source.type).toUpperCase();
  const format = firstString(source.format, source.exportFormat).toUpperCase();
  return {
    id: firstString(source.id, source.scheduleId, source._id) || `schedule-${index}`,
    name: firstString(source.name, source.title) || 'Untitled schedule',
    reportType: firstString(source.reportType, source.type, source.reportKey),
    savedReportId: firstString(source.savedReportId, source.saved_report_id),
    templateId: firstString(source.templateId, source.template_id),
    frequency: frequency || 'DAILY',
    time: firstString(source.time, source.timeOfDay, source.runAt, source.scheduleTime),
    timezone: firstString(source.timezone, source.timeZone),
    format: format || 'CSV',
    isActive: firstBoolean(source.isActive, source.active, source.enabled) ?? true,
    dayOfWeek: dayOfWeekValue(source.dayOfWeek ?? source.weekDay ?? source.weekday),
    dayOfMonth: dayOfMonthValue(source.dayOfMonth ?? source.dayOf_month),
    createdAt: firstString(source.createdAt, source.created_at),
    updatedAt: firstString(source.updatedAt, source.updated_at),
    raw: source,
  };
}

export interface ReportRun {
  id: string;
  reportType: string;
  reportName: string;
  format: ReportFormat | string;
  status: ReportRunStatus;
  rowCount: number | null;
  createdAt: string;
  completedAt: string;
  error: string;
  downloadUrl: string;
  raw: Record<string, unknown>;
}

function normalizeRunStatus(value: unknown): ReportRunStatus {
  const status = firstString(value).toUpperCase();
  if (status === 'PENDING' || status === 'WAITING') return 'QUEUED';
  if (status === 'SUCCESS' || status === 'SUCCEEDED' || status === 'DONE') return 'COMPLETED';
  if (status === 'CANCELED') return 'CANCELLED';
  return status || 'QUEUED';
}

export function normalizeReportRun(value: unknown, index = 0, fallbackStatus: ReportRunStatus = 'QUEUED'): ReportRun {
  const source = unwrapEntity(value) ?? {};
  return {
    id: firstString(source.id, source.runId, source._id) || `run-${index}`,
    reportType: firstString(source.reportType, source.type, source.reportKey),
    reportName: firstString(source.reportName, source.report_name, source.reportType),
    format: firstString(source.format, source.exportFormat).toUpperCase() || 'CSV',
    status: normalizeRunStatus(source.status ?? fallbackStatus),
    rowCount: firstNumber(source.rowCount, source.totalCount, source.total) ?? null,
    createdAt: firstString(source.createdAt, source.created_at, source.queuedAt, source.requestedAt),
    completedAt: firstString(source.completedAt, source.completed_at, source.finishedAt),
    error: firstString(source.error, source.errorMessage, source.failureReason),
    downloadUrl: firstString(source.downloadUrl, source.signedUrl, source.url),
    raw: source,
  };
}

export function isRunPollable(status: string): boolean {
  const normalized = status.toUpperCase();
  return normalized === 'QUEUED' || normalized === 'PENDING' || normalized === 'RUNNING' || normalized === 'PROCESSING';
}

export function isRunCompleted(status: string): boolean {
  return status.toUpperCase() === 'COMPLETED' || status.toUpperCase() === 'SUCCESS' || status.toUpperCase() === 'SUCCEEDED';
}

export function isRunFailed(status: string): boolean {
  return status.toUpperCase() === 'FAILED' || status.toUpperCase() === 'ERROR' || status.toUpperCase() === 'CANCELLED' || status.toUpperCase() === 'CANCELED';
}

export function shouldPollRuns(runs: readonly Pick<ReportRun, 'status'>[]): boolean {
  return runs.some((run) => isRunPollable(run.status));
}

export function runStatusLabel(status: string): string {
  const normalized = status.toUpperCase();
  if (normalized === 'PENDING' || normalized === 'WAITING' || normalized === 'QUEUED') return 'Queued';
  if (normalized === 'RUNNING' || normalized === 'PROCESSING') return 'Running';
  if (normalized === 'COMPLETED' || normalized === 'SUCCESS' || normalized === 'SUCCEEDED') return 'Completed';
  if (normalized === 'FAILED' || normalized === 'ERROR') return 'Failed';
  if (normalized === 'CANCELLED' || normalized === 'CANCELED') return 'Cancelled';
  return status || 'Unknown';
}

export function runStatusTone(status: string): 'pending' | 'success' | 'error' | 'neutral' {
  if (isRunPollable(status)) return 'pending';
  if (isRunCompleted(status)) return 'success';
  if (isRunFailed(status)) return 'error';
  return 'neutral';
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString();
}

export function extractSignedUrl(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  const source = unwrapEntity(value) ?? {};
  return firstString(source.url, source.downloadUrl, source.signedUrl, source.signed_url, source.fileUrl);
}

export interface ScheduleDraft {
  name: string;
  reportType: string;
  savedReportId: string;
  templateId: string;
  frequency: ReportScheduleFrequency;
  time: string;
  timezone: string;
  format: ReportFormat | string;
  isActive: boolean;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
}

export function validateScheduleDraft(draft: ScheduleDraft): string | null {
  if (!draft.name.trim()) return 'Enter a schedule name.';
  if (!draft.reportType.trim()) return 'Select a report.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(draft.time)) return 'Enter a valid time.';
  if (!draft.timezone.trim()) return 'Enter a timezone.';
  if (!['CSV', 'EXCEL', 'PDF'].includes(draft.format.toUpperCase())) return 'Select a valid export format.';
  if (draft.frequency.toUpperCase() === 'WEEKLY' && (draft.dayOfWeek === null || draft.dayOfWeek < 0 || draft.dayOfWeek > 6)) {
    return 'Select a day of the week.';
  }
  if (draft.frequency.toUpperCase() === 'MONTHLY' && (draft.dayOfMonth === null || draft.dayOfMonth < 1 || draft.dayOfMonth > 31)) {
    return 'Choose a day of the month from 1 to 31.';
  }
  return null;
}
