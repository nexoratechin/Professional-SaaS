/**
 * Pure validation + mapping engine. Given an entity definition, the parsed rows, a committed
 * header→field mapping, and an ImportContext for DB lookups, it produces a per-row verdict
 * (valid / invalid / duplicate) plus a summary. No database writes happen here — the worker
 * applies the valid rows afterwards, and the API uses the same function for its preview.
 */
import type {
  ImportContext,
  ImportEntityDefinition,
  ImportFieldDef,
  ImportFieldRef,
  ValidationIssue,
  ValidationResult,
  ValidatedRow,
  ValidateRowsOptions,
  DuplicateStrategy,
} from './types';

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Auto-detects a header→field mapping from the template headers and aliases. */
export function autoMapHeaders(
  entity: ImportEntityDefinition,
  headers: readonly string[],
): Record<string, string> {
  const byNormalized = new Map<string, string>();
  for (const header of headers) {
    byNormalized.set(normalizeHeader(header), header);
  }
  const mapping: Record<string, string> = {};
  for (const def of entity.fields) {
    const candidates = [def.header, ...(def.aliases ?? []), def.field];
    for (const candidate of candidates) {
      const source = byNormalized.get(normalizeHeader(candidate));
      if (source) {
        mapping[source] = def.field;
        break;
      }
    }
  }
  return mapping;
}

interface CoerceResult {
  value?: unknown;
  issue?: ValidationIssue;
}

function issue(field: string, code: string, message: string): CoerceResult {
  return { issue: { field, code, message } };
}

function parseDate(field: string, raw: string): CoerceResult {
  const value = raw.trim();
  let date: Date | undefined;
  let m = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) {
    date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  } else if ((m = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/))) {
    // Interpret ambiguous dd/mm/yyyy vs mm/dd/yyyy as day-first when the first part exceeds 12,
    // otherwise month-first (matches how spreadsheets export locale dates most commonly).
    const first = Number(m[1]);
    const second = Number(m[2]);
    const day = first > 12 ? first : second;
    const month = first > 12 ? second : first;
    date = new Date(Date.UTC(Number(m[3]), month - 1, day));
  } else {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }
  if (!date || Number.isNaN(date.getTime())) {
    return issue(field, 'INVALID_DATE', `"${raw}" is not a valid date.`);
  }
  // Reject impossible dates (e.g. 2026-02-31 rolls over) by comparing components.
  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (iso) {
    if (date.getUTCMonth() + 1 !== Number(iso[2]) || date.getUTCDate() !== Number(iso[3])) {
      return issue(field, 'INVALID_DATE', `"${raw}" is not a valid date.`);
    }
  }
  return { value: date };
}

function coerceValue(def: ImportFieldDef, raw: string): CoerceResult {
  const value = raw.trim();
  if (value === '') return { value: undefined };

  if (def.type === 'string') {
    if (def.transform === 'upper') return { value: value.toUpperCase() };
    if (def.transform === 'lower') return { value: value.toLowerCase() };
    if (def.maxLength && value.length > def.maxLength) {
      return issue(def.field, 'TOO_LONG', `Exceeds maximum length of ${def.maxLength}.`);
    }
    return { value };
  }

  if (def.type === 'int' || def.type === 'number') {
    const cleaned = value.replace(/,/g, '');
    const num = Number(cleaned);
    if (!Number.isFinite(num)) {
      return issue(def.field, 'NOT_A_NUMBER', `"${raw}" is not a number.`);
    }
    if (def.type === 'int' && !Number.isInteger(num)) {
      return issue(def.field, 'NOT_AN_INTEGER', `"${raw}" must be a whole number.`);
    }
    if (def.min !== undefined && num < def.min) {
      return issue(def.field, 'BELOW_MIN', `Must be at least ${def.min}.`);
    }
    if (def.max !== undefined && num > def.max) {
      return issue(def.field, 'ABOVE_MAX', `Must be at most ${def.max}.`);
    }
    const scaled = def.transform === 'rupeesToCents' ? Math.round(num * 100) : num;
    return { value: scaled };
  }

  if (def.type === 'boolean') {
    const lower = value.toLowerCase();
    if (['true', 'yes', '1', 'y'].includes(lower)) return { value: true };
    if (['false', 'no', '0', 'n'].includes(lower)) return { value: false };
    return issue(def.field, 'NOT_A_BOOLEAN', `"${raw}" must be true or false.`);
  }

  if (def.type === 'date') {
    return parseDate(def.field, value);
  }

  if (def.type === 'enum') {
    const match = def.enumValues?.find((candidate) => candidate.toLowerCase() === value.toLowerCase());
    if (!match) {
      return issue(def.field, 'INVALID_ENUM', `"${raw}" is not one of: ${(def.enumValues ?? []).join(', ')}.`);
    }
    return { value: match };
  }

  return { value };
}

/** Resolves the source header each canonical field is mapped from. */
function buildFieldSource(
  entity: ImportEntityDefinition,
  mapping: Record<string, string>,
): Map<string, string> {
  const fieldToSource = new Map<string, string>();
  for (const [source, field] of Object.entries(mapping)) {
    if (!fieldToSource.has(field)) fieldToSource.set(field, source);
  }
  return fieldToSource;
}

/** Extracts the human-readable key (raw codes, not resolved ids) used for duplicate detection. */
export function computeSourceKey(
  entity: ImportEntityDefinition,
  fieldToSource: Map<string, string>,
  raw: Record<string, string>,
): string | null {
  const parts = entity.duplicateKey.map((field) => {
    const source = fieldToSource.get(field);
    return source ? (raw[source] ?? '').trim() : '';
  });
  if (parts.every((p) => p === '')) {
    if (entity.duplicateKeyFallback) {
      const source = fieldToSource.get(entity.duplicateKeyFallback);
      const fallback = source ? (raw[source] ?? '').trim() : '';
      return fallback === '' ? null : fallback.toLowerCase();
    }
    return null;
  }
  return parts.map((p) => p.toLowerCase()).join('\u0001');
}

export async function validateRows(
  entity: ImportEntityDefinition,
  rows: Array<Record<string, string>>,
  mapping: Record<string, string>,
  ctx: ImportContext,
  options: ValidateRowsOptions,
): Promise<ValidationResult> {
  const fieldToSource = buildFieldSource(entity, mapping);

  const missingRequired = entity.fields
    .filter((def) => def.required && !fieldToSource.has(def.field))
    .map((def) => def.field);
  const mappedSources = new Set(Object.keys(mapping));
  const unmappedHeaders = (options.headers ?? []).filter((header) => !mappedSources.has(header));

  const limited = options.limit !== undefined ? rows.slice(0, options.limit) : rows;

  // ── Pre-resolve every foreign-key column in one batched query per ref ───────
  const refValues = new Map<ImportFieldRef, Set<string>>();
  for (const def of entity.fields) {
    if (!def.ref) continue;
    const source = fieldToSource.get(def.field);
    if (!source) continue;
    const set = refValues.get(def.ref) ?? new Set<string>();
    for (const row of limited) {
      const value = (row[source] ?? '').trim();
      if (value !== '') set.add(value);
    }
    refValues.set(def.ref, set);
  }
  const resolvedRefs = new Map<ImportFieldRef, Map<string, string>>();
  for (const [ref, values] of refValues) {
    resolvedRefs.set(ref, await ctx.resolveRef(ref, [...values]));
  }

  // ── Pre-resolve keys already in the database ────────────────────────────────
  const sourceKeys: Array<string | null> = limited.map((row) => computeSourceKey(entity, fieldToSource, row));
  const distinctKeys = [...new Set(sourceKeys.filter((k): k is string => k !== null))];
  const dbKeys = await ctx.existingKeys(distinctKeys);

  const seenInFile = new Set<string>();
  const validated: ValidatedRow[] = [];
  let validRows = 0;
  let invalidRows = 0;
  let duplicateRows = 0;

  for (let i = 0; i < limited.length; i++) {
    const raw = limited[i]!;
    const rowNumber = i + 2; // 1-indexed spreadsheet row (header is row 1)
    const issues: ValidationIssue[] = [];
    const mapped: Record<string, unknown> = {};

    for (const def of entity.fields) {
      const source = fieldToSource.get(def.field);
      const cellValue = source ? (raw[source] ?? '') : '';
      if (cellValue.trim() === '') {
        if (def.required) {
          issues.push({ field: def.field, code: 'REQUIRED', message: `${def.header} is required.` });
        }
        continue;
      }
      const result = coerceValue(def, cellValue);
      if (result.issue) {
        issues.push(result.issue);
        continue;
      }
      mapped[def.field] = result.value;
    }

    // Resolve FK codes → ids.
    for (const def of entity.fields) {
      if (!def.ref) continue;
      const target = def.ref.targetField;
      const code = mapped[def.field];
      if (typeof code === 'string' && code !== '') {
        const id = resolvedRefs.get(def.ref)?.get(code);
        if (!id) {
          issues.push({ field: def.field, code: 'REF_NOT_FOUND', message: `${def.header} "${code}" was not found.` });
        } else {
          delete mapped[def.field];
          mapped[target] = id;
        }
      }
    }

    const sourceKey = sourceKeys[i] ?? null;
    let status: ValidatedRow['status'] = 'VALID';
    let existsInDb = false;

    if (issues.length > 0) {
      status = 'INVALID';
      invalidRows++;
    } else if (sourceKey && dbKeys.has(sourceKey)) {
      existsInDb = true;
      if (options.duplicateStrategy === 'FAIL') {
        issues.push({ code: 'DUPLICATE', message: 'A row with this key already exists.' });
        status = 'INVALID';
        invalidRows++;
      } else if (options.duplicateStrategy === 'SKIP') {
        status = 'DUPLICATE';
        duplicateRows++;
      } else {
        validRows++;
      }
    } else if (sourceKey && seenInFile.has(sourceKey)) {
      // Repeats inside the same file are always skipped rather than applied twice.
      issues.push({ code: 'DUPLICATE_IN_FILE', message: 'Duplicate of an earlier row in this file.' });
      status = 'DUPLICATE';
      duplicateRows++;
    } else {
      validRows++;
    }

    if (sourceKey) seenInFile.add(sourceKey);

    const finalMapped = entity.derive ? entity.derive(mapped, raw) : mapped;
    validated.push({ rowNumber, status, sourceKey, raw, mapped: finalMapped, issues, existsInDb });
  }

  return {
    rows: validated,
    summary: {
      totalRows: rows.length,
      validRows,
      invalidRows,
      duplicateRows,
      skippedRows: 0,
      missingRequired,
      unmappedHeaders,
    },
  };
}

export type { DuplicateStrategy };
