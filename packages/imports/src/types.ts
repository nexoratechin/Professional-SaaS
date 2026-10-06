/**
 * Shared, dependency-free contracts + engine for the bulk import/export system.
 *
 * This package is consumed by BOTH apps/api (synchronous parse/preview/validate and job
 * creation) and apps/worker (background processing) so both sides always agree on what a
 * template looks like, how a cell is validated, and how duplicate detection works. It has no
 * NestJS/Prisma dependency on purpose — DB access is injected through the small context
 * interfaces below, keeping this package pure and unit-testable.
 */

export const IMPORT_ENTITY_KEYS = [
  'students',
  'faculty',
  'courses',
  'departments',
  'fees',
  'attendance',
  'marks',
  'library',
  'inventory',
] as const;

export type ImportEntityKey = (typeof IMPORT_ENTITY_KEYS)[number];

export type ImportFileFormat = 'CSV' | 'XLSX';

/** COMMIT applies rows through the worker; VALIDATE parses/validates and stops. */
export type ImportMode = 'COMMIT' | 'VALIDATE';

/** How a row whose duplicate key already exists (in-file or in the database) is handled. */
export type DuplicateStrategy = 'SKIP' | 'UPDATE' | 'FAIL';

export type ImportFieldType = 'string' | 'int' | 'number' | 'boolean' | 'date' | 'enum';

/** A foreign-key column: the cell holds a human code (e.g. a campus code) that is resolved to
 *  the referenced row's id before the row is written. */
export interface ImportFieldRef {
  /** Prisma delegate name on the tenant-scoped client, e.g. 'campus'. */
  model: string;
  /** Column on the referenced model the cell value is matched against, e.g. 'code'. */
  codeField: string;
  /** Field on the imported model the resolved id is written to, e.g. 'campusId'. */
  targetField: string;
  /** Optional scalar filter so the same code can exist per kind (e.g. inventory categories). */
  filter?: Record<string, string>;
}

export type ImportFieldTransform = 'rupeesToCents' | 'trim' | 'upper' | 'lower';

export interface ImportFieldDef {
  /** Canonical target field (matches the Prisma field name unless a ref redirects it). */
  field: string;
  /** Default template header shown to the user. */
  header: string;
  /** Additional accepted header spellings (case-insensitive) for auto-mapping. */
  aliases?: string[];
  required?: boolean;
  type: ImportFieldType;
  enumValues?: readonly string[];
  maxLength?: number;
  min?: number;
  max?: number;
  ref?: ImportFieldRef;
  transform?: ImportFieldTransform;
  description?: string;
  /** A representative value used when generating the downloadable template. */
  sample?: string;
}

/** Which apply routine the worker uses. 'generic' writes mapped fields straight onto `model`;
 *  'attendance'/'marks' compose several models (registration lookup, FK wiring). */
export type ImportStrategy = 'generic' | 'attendance' | 'marks';

export interface ImportEntityDefinition {
  key: ImportEntityKey;
  label: string;
  /** Prisma delegate name on the tenant-scoped client. */
  model: string;
  /** RBAC module prefix (e.g. 'students' → students.create / students.view). */
  module: string;
  /** Permission required to import/apply rows and upload files for this entity. */
  importPermission: string;
  /** Permission required to preview, read history, and export/template-download. */
  viewPermission: string;
  strategy: ImportStrategy;
  /** Canonical fields whose combined value identifies a duplicate row. */
  duplicateKey: string[];
  /** When every duplicateKey cell is blank, fall back to this field (e.g. a book title). */
  duplicateKeyFallback?: string;
  fields: ImportFieldDef[];
  /** Post-mapping derivation applied to every row (e.g. Student.fullName). Pure. */
  derive?: (mapped: Record<string, unknown>, raw: Record<string, string>) => Record<string, unknown>;
}

// ── Parsed / validated row shapes ─────────────────────────────────────────────

export interface ParsedSheet {
  headers: string[];
  rows: Array<Record<string, string>>;
}

export interface ParsedFile extends ParsedSheet {
  totalRows: number;
}

export interface ValidationIssue {
  field?: string;
  code: string;
  message: string;
}

export type ImportRowStatus =
  | 'VALID'
  | 'INVALID'
  | 'DUPLICATE'
  | 'SKIPPED'
  | 'INSERTED'
  | 'UPDATED'
  | 'FAILED';

export interface ValidatedRow {
  rowNumber: number;
  status: 'VALID' | 'INVALID' | 'DUPLICATE';
  sourceKey: string | null;
  raw: Record<string, string>;
  mapped: Record<string, unknown>;
  issues: ValidationIssue[];
  /** True when the row's duplicate key already existed in the database. */
  existsInDb: boolean;
}

export interface ValidationSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  skippedRows: number;
  missingRequired: string[];
  unmappedHeaders: string[];
}

export interface ValidationResult {
  rows: ValidatedRow[];
  summary: ValidationSummary;
}

/**
 * The DB-facing hooks the pure engine needs. apps/api (preview) and apps/worker (apply) each
 * implement this over a tenant-scoped Prisma client.
 */
export interface ImportContext {
  /** Returns code → id for every requested distinct code on the ref's model. */
  resolveRef(
    ref: ImportFieldRef,
    codes: string[],
  ): Promise<Map<string, string>>;
  /** Returns the set of duplicate-key strings that already exist in the database. */
  existingKeys(keys: string[]): Promise<Set<string>>;
}

export interface ValidateRowsOptions {
  duplicateStrategy: DuplicateStrategy;
  /** Upper bound on rows to validate; undefined validates all. */
  limit?: number;
  /** Every header present in the uploaded file, used to report ignored columns. */
  headers?: readonly string[];
}

export const IMPORT_TEMPLATE_SAMPLE_ROWS = 2;

/** Builds the template (header row + sample data rows) for an entity. */
export function buildTemplateSheet(entity: ImportEntityDefinition): ParsedSheet {
  const headers = entity.fields.map((f) => f.header);
  const rows: Array<Record<string, string>> = [];
  for (let i = 0; i < IMPORT_TEMPLATE_SAMPLE_ROWS; i++) {
    const row: Record<string, string> = {};
    for (const field of entity.fields) {
      if (field.sample !== undefined) {
        row[field.header] = field.sample;
      } else if (field.type === 'enum' && field.enumValues?.length) {
        row[field.header] = field.enumValues[0] ?? '';
      } else if (field.type === 'date') {
        row[field.header] = '2026-01-15';
      } else if (field.type === 'int' || field.type === 'number') {
        row[field.header] = field.required ? '1' : '';
      } else if (field.type === 'boolean') {
        row[field.header] = 'true';
      } else {
        row[field.header] = '';
      }
    }
    rows.push(row);
  }
  return { headers, rows };
}
