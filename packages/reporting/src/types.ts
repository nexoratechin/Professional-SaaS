/** Shared, framework-free contracts for the reporting engine used by the API and worker. */

export const REPORT_TYPES = [
  'ADMISSIONS',
  'STUDENTS',
  'ATTENDANCE',
  'FEES',
  'EXAMS',
  'PLACEMENTS',
  'LIBRARY',
  'HOSTEL',
  'TRANSPORT',
  'INVENTORY',
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const REPORT_EXPORT_FORMATS = ['CSV', 'EXCEL', 'PDF'] as const;
export type ReportExportFormat = (typeof REPORT_EXPORT_FORMATS)[number];

export const REPORT_SCHEDULE_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type ReportScheduleFrequency = (typeof REPORT_SCHEDULE_FREQUENCIES)[number];

export const REPORT_SCOPE_TYPES = ['GLOBAL', 'CAMPUS', 'DEPARTMENT', 'PROGRAM', 'OWN'] as const;
export type ReportScopeType = (typeof REPORT_SCOPE_TYPES)[number];

export const REPORT_FILTER_KEYS = [
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
] as const;
export type ReportFilterKey = (typeof REPORT_FILTER_KEYS)[number];

export interface ReportFilters {
  dateFrom?: string;
  dateTo?: string;
  campusId?: string;
  departmentId?: string;
  programId?: string;
  sectionId?: string;
  academicYearId?: string;
  termId?: string;
  search?: string;
  status?: string;
  includeInactive?: boolean;
}

export interface ReportScopeGrant {
  scopeType: ReportScopeType;
  campusId?: string;
  departmentId?: string;
  programId?: string;
}

export type ReportCellFormat = 'text' | 'number' | 'currency' | 'date' | 'datetime' | 'percent';

export interface ReportColumn {
  key: string;
  label: string;
  format?: ReportCellFormat;
  align?: 'LEFT' | 'CENTER' | 'RIGHT';
}

export interface ReportTemplateDefinition {
  title?: string;
  subtitle?: string;
  columns?: Array<{ key: string; label?: string; align?: 'LEFT' | 'CENTER' | 'RIGHT' }>;
  showTotals?: boolean;
}

export interface ReportDefinition {
  reportType: ReportType;
  key: string;
  name: string;
  description: string;
  category: string;
  sourcePermission: string;
  supportedFilters: ReportFilterKey[];
  columns: ReportColumn[];
  defaultFilters?: ReportFilters;
  /** Existing module screen that offers the specialized variant of this report, when one exists. */
  sourcePath?: string;
}

export type ReportRow = Record<string, string | number | boolean | null>;

export interface ReportResult {
  definition: ReportDefinition;
  columns: ReportColumn[];
  rows: ReportRow[];
  summary: Record<string, number>;
  rowCount: number;
  totalCount: number;
  truncated: boolean;
  generatedAt: string;
  filters: ReportFilters;
}

export interface ExecuteReportOptions {
  limit?: number;
  mode?: 'preview' | 'export';
  template?: ReportTemplateDefinition | null;
  actorUserId?: string;
  now?: Date;
}

export interface RenderedReport {
  buffer: Buffer;
  fileName: string;
  contentType: string;
  extension: 'csv' | 'xls' | 'pdf';
}

/** Minimal structural Prisma surface the engine needs; the caller passes a tenant-scoped client. */
export interface ReportDelegate {
  findMany(args: Record<string, unknown>): Promise<unknown[]>;
  count(args: Record<string, unknown>): Promise<number>;
}

export interface ReportPrisma {
  admissionApplication: ReportDelegate;
  student: ReportDelegate;
  studentAttendance: ReportDelegate;
  studentFee: ReportDelegate;
  examSession: ReportDelegate;
  placementOutcome: ReportDelegate;
  studentLibraryLoan: ReportDelegate;
  studentHostelBooking: ReportDelegate;
  studentTransportPass: ReportDelegate;
  inventoryStockItem: ReportDelegate;
}

export class ReportScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportScopeError';
  }
}
