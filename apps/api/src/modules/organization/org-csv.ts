/**
 * Minimal, zero-dependency CSV parse / format helpers for organization import/export.
 * Handles quoted fields (RFC 4180), escapes commas/newlines/quotes in exports, and
 * coerces string values coming from CSV cells to appropriate JS types.
 */

// ── Coercion ──────────────────────────────────────────────────────────────────

function coerce(value: string): string | number | boolean | null {
  if (value === '' || value === undefined) return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return parseInt(value, 10);
  return value;
}

// ── Parse (RFC 4180) ──────────────────────────────────────────────────────────

function* splitLine(line: string): Generator<string> {
  let field = '';
  let quoted = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        quoted = true;
        i++;
      } else if (ch === ',') {
        yield field;
        field = '';
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }
  yield field;
}

/**
 * Parse a CSV string into an array of record objects keyed by the header row.
 * `fields` is the ordered list of canonical field names; headers in the CSV are
 * matched case-insensitively. Rows with fewer columns are padded with null.
 */
export function parseCsvToRows(
  csv: string,
  fields: ReadonlyArray<string>,
): Record<string, string | number | boolean | null>[] {
  const lines = csv
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const headerCells = [...splitLine(lines[0]!)];

  const headerMap = new Map<string, string>();
  for (const cell of headerCells) {
    const trimmed = cell.trim();
    const fieldIdx = fields.findIndex((f) => f.toLowerCase() === trimmed.toLowerCase());
    headerMap.set(trimmed, fieldIdx >= 0 ? fields[fieldIdx]! : trimmed);
  }

  const rows: Record<string, string | number | boolean | null>[] = [];

  for (let lineIdx = 1; lineIdx < lines.length; lineIdx++) {
    const cells = [...splitLine(lines[lineIdx]!)];
    const values: Record<string, string | number | boolean | null> = {};
    for (let cellIdx = 0; cellIdx < headerCells.length; cellIdx++) {
      const field = headerMap.get(headerCells[cellIdx]!) ?? headerCells[cellIdx]!;
      const raw = cells[cellIdx] ?? '';
      values[field] = coerce(raw.trim());
    }
    rows.push(values);
  }

  return rows;
}

// ── Format (export) ───────────────────────────────────────────────────────────

function escapeField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Serialize an array of row-objects into a CSV string using the given column order. */
export function rowsToCsv(rows: Record<string, unknown>[], fields: ReadonlyArray<string>): string {
  const header = fields.map(escapeField).join(',');
  const lines = rows.map((row) => fields.map((f) => escapeField(row[f])).join(','));
  return [header, ...lines].join('\n');
}