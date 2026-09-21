/**
 * Certificate field resolution — turns a template's `fieldConfigJson` (an ordered `label → source`
 * map) into the fields/table/summary blocks rendered onto the PDF, backed by a snapshot of the
 * student, program/campus/batch and (for grade cards / marksheets / transcripts) their latest
 * published result process.
 *
 * Source expressions are dotted paths resolved against a well-defined context, plus two block
 * tokens:
 *   - `{{subjectTable}}` / `subjects` → subject-level result table (marksheet/transcript/grade card)
 *   - `{{academicSummary}}` / `summary` → aggregate GPA/CGPA/standing block
 *
 * Every expression is resolved against an immutable snapshot taken at generation time, so the
 * printed document (and its contentJson) never drifts when master data changes later.
 */
import { CertificateTypeDto } from '@college-erp/types';
import type { CertificatePdfField, CertificateBranding, MarkSheetTable } from './certificate-pdf';

export interface CertificateFieldRow {
  label: string;
  source: string;
  value: string;
  kind: 'field' | 'table' | 'summary';
}

export interface ResultCalculationRow {
  subjectCode?: string | null;
  subjectName?: string | null;
  creditHours?: number | null;
  maxMarks?: number | null;
  effectiveMarks?: number | null;
  percentage?: number | null;
  grade?: string | null;
  gradePoint?: number | null;
  outcome?: string | null;
}

export interface ResultProcessRow {
  sessionName?: string | null;
  sessionCode?: string | null;
  subjectCount?: number | null;
  passedCount?: number | null;
  failedCount?: number | null;
  aggregatePercent?: number | null;
  gpa?: number | null;
  cgpa?: number | null;
  creditsAttempted?: number | null;
  creditsEarned?: number | null;
  standing?: string | null;
  calculations?: ResultCalculationRow[];
}

export interface FieldContext {
  student: {
    fullName: string;
    admissionNumber: string | null;
    rollNumber: string | null;
    registrationNumber: string | null;
    firstName: string;
    middleName: string | null;
    lastName: string;
    gender: string | null;
    dateOfBirth: Date | string | null;
    admittedOn: Date | string | null;
    nationality: string | null;
    email: string | null;
    city: string | null;
    state: string | null;
  };
  program?: { name?: string | null; code?: string | null } | null;
  campus?: { name?: string | null } | null;
  batch?: { name?: string | null; year?: number | null } | null;
  certificate: {
    number: string | null;
    title: string | null;
    requestDate: string | null;
    type: string;
    status: string;
  };
  result?: ResultProcessRow | null;
  branding: CertificateBranding;
}

const DATE_FIELDS = new Set(['dateOfBirth', 'admittedOn']);

function humanizeGender(value: unknown): string {
  if (!value) return '';
  return String(value).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanizeValue(expr: string, raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (DATE_FIELDS.has(expr.split('.').pop() ?? '')) {
    const d = raw instanceof Date ? raw : new Date(raw as string);
    return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
  }
  if (expr.endsWith('.gender')) return humanizeGender(raw);
  if (expr.endsWith('.standing') || expr.endsWith('.outcome')) {
    return String(raw).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (Array.isArray(raw)) return raw.join(', ');
  return String(raw);
}

function resolvePath(path: string, context: FieldContext): unknown {
  let value: unknown = context;
  for (const part of path.split('.')) {
    if (value === null || value === undefined) return '';
    if (typeof value !== 'object') return '';
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

const MAX_TABLE_ROWS = 60;

function buildSubjectTable(process: ResultProcessRow): MarkSheetTable {
  const rows = (process.calculations ?? []).slice(0, MAX_TABLE_ROWS).map((c) => [
    c.subjectCode ?? '-',
    c.subjectName ?? '-',
    c.creditHours ?? 0,
    c.maxMarks ?? 0,
    c.effectiveMarks ?? 'ABS',
    c.percentage != null ? `${c.percentage.toFixed(2)}%` : '-',
    c.grade ?? '-',
    c.outcome ? String(c.outcome).replace(/_/g, ' ').toUpperCase() : '-',
  ]);
  return {
    columns: [
      { label: 'Course Code', width: 0.18 },
      { label: 'Course', width: 0.26 },
      { label: 'Credits', width: 0.09, align: 'center' },
      { label: 'Max', width: 0.09, align: 'center' },
      { label: 'Obtained', width: 0.1, align: 'center' },
      { label: 'Percentage', width: 0.12, align: 'center' },
      { label: 'Grade', width: 0.08, align: 'center' },
      { label: 'Result', width: 0.08, align: 'center' },
    ],
    rows,
  };
}

function buildSummary(process: ResultProcessRow): CertificatePdfField[] {
  const items: CertificatePdfField[] = [];
  const round = (n: number | null | undefined): string => (n == null ? '-' : `${Number(n).toFixed(2)}%`);
  if (process.subjectCount != null) items.push({ label: 'Papers', value: String(process.subjectCount) });
  if (process.passedCount != null) items.push({ label: 'Passed', value: String(process.passedCount) });
  if (process.aggregatePercent != null) items.push({ label: 'Aggregate', value: round(process.aggregatePercent) });
  if (process.gpa != null) items.push({ label: 'GPA', value: Number(process.gpa).toFixed(2) });
  if (process.cgpa != null) items.push({ label: 'CGPA', value: Number(process.cgpa).toFixed(2) });
  if (process.creditsAttempted != null) items.push({ label: 'Credits Att.', value: String(process.creditsAttempted) });
  if (process.creditsEarned != null) items.push({ label: 'Credits Earned', value: String(process.creditsEarned) });
  if (process.standing) {
    items.push({
      label: 'Standing',
      value: String(process.standing).replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()),
    });
  }
  return items;
}

/**
 * Default field map per certificate type — used when a template has no explicit `fieldConfigJson`.
 * Keys become printed labels; sources follow the same expression syntax as template config.
 */
export const DEFAULT_FIELD_CONFIG: Record<string, Record<string, string>> = {
  BONAFIDE: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Registration Number': 'student.registrationNumber',
    'Date of Birth': 'student.dateOfBirth',
    'Program': 'program.name',
    'This is to certify that': 'student.fullName',
  },
  PROVISIONAL: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Registration Number': 'student.registrationNumber',
    'Program': 'program.name',
    'Date of Issue': 'certificate.requestDate',
  },
  MIGRATION: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Registration Number': 'student.registrationNumber',
    'Program': 'program.name',
    'Date of Admission': 'student.admittedOn',
  },
  TRANSCRIPT: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Program': 'program.name',
    'Subject Table': 'subjects',
    'Academic Summary': 'summary',
  },
  TRANSFER_CERTIFICATE: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Registration Number': 'student.registrationNumber',
    'Program': 'program.name',
    'Date of Admission': 'student.admittedOn',
  },
  GRADE_CARD: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Program': 'program.name',
    'Subject Table': 'subjects',
    'Academic Summary': 'summary',
  },
  MARKSHEET: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Program': 'program.name',
    'Subject Table': 'subjects',
    'Academic Summary': 'summary',
  },
  CHARACTER_CERTIFICATE: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Program': 'program.name',
    'Character': 'student.fullName',
  },
  TESTIMONIAL: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Program': 'program.name',
    'Period of Study': 'program.name',
  },
  OTHER: {
    'Admission Number': 'student.admissionNumber',
    'Roll Number': 'student.rollNumber',
    'Program': 'program.name',
  },
};

/**
 * Resolve the template's field map into ready-to-print blocks. Returns `{ fields, table?, summary? }`
 * where fields are plain label/value pairs. Empty values are dropped from the printed output.
 */
export function resolveCertificateSections(
  fieldConfig: Record<string, string>,
  type: CertificateTypeDto | string,
  context: FieldContext,
): { fields: CertificatePdfField[]; table?: MarkSheetTable; summary?: CertificatePdfField[] } {
  const config = Object.keys(fieldConfig ?? {}).length ? fieldConfig : DEFAULT_FIELD_CONFIG[type] ?? DEFAULT_FIELD_CONFIG.OTHER ?? {};

  const fields: CertificatePdfField[] = [];
  let table: MarkSheetTable | undefined;
  let summary: CertificatePdfField[] | undefined;

  for (const [label, source] of Object.entries(config)) {
    const normalized = source.trim();
    if (normalized === 'subjects' || normalized === '{{subjectTable}}') {
      if (context.result?.calculations?.length && !table) {
        table = buildSubjectTable(context.result);
      }
      continue;
    }
    if (normalized === 'summary' || normalized === '{{academicSummary}}') {
      if (context.result) {
        summary = buildSummary(context.result);
      }
      continue;
    }
    const raw = resolvePath(normalized, context);
    const value = humanizeValue(normalized, raw);
    if (value) {
      fields.push({ label, value });
    }
  }

  return { fields, table, summary };
}

/** Human-friendly title for a certificate type, used as the PDF title when the template has none. */
export function certificateTitle(type: string): string {
  const titles: Record<string, string> = {
    BONAFIDE: 'Bonafide Certificate',
    PROVISIONAL: 'Provisional Certificate',
    MIGRATION: 'Migration Certificate',
    TRANSCRIPT: 'Transcript of Records',
    TRANSFER_CERTIFICATE: 'Transfer Certificate',
    GRADE_CARD: 'Grade Card',
    MARKSHEET: 'Marksheet / Statement of Marks',
    CHARACTER_CERTIFICATE: 'Character Certificate',
    TESTIMONIAL: 'Testimonial',
    OTHER: 'Certificate',
  };
  return titles[type] ?? 'Certificate';
}