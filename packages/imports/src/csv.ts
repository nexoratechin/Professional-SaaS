/**
 * RFC 4180 CSV parse / format helpers (zero-dependency). Handles quoted fields, escaped
 * quotes, embedded commas and newlines, and CRLF line endings. This generalizes the original
 * organization-module CSV helper so the bulk import system has one implementation.
 */

/** Parses raw CSV text into a 2D array of cells (no header semantics). Blank trailing lines
 *  are dropped; a completely empty cell stays an empty string. */
export function parseCsvGrid(text: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  let i = 0;

  // Strip a UTF-8 BOM if present.
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  while (i < input.length) {
    const ch = input[i]!;
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          quoted = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
    } else if (ch === '"') {
      quoted = true;
      i += 1;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      i += 1;
    } else if (ch === '\r') {
      // Normalize CRLF / CR to a single row break.
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += input[i + 1] === '\n' ? 2 : 1;
    } else if (ch === '\n') {
      row.push(field);
      field = '';
      rows.push(row);
      row = [];
      i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  // Flush the final field/row unless the input ended exactly on a line break with no content.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop rows that are entirely empty (common trailing-newline artifact).
  return rows.filter((r) => r.some((cell) => cell.trim() !== ''));
}

export interface CsvRecords {
  headers: string[];
  rows: Array<Record<string, string>>;
}

/** Parses CSV text into records keyed by the (trimmed) header row. Duplicate headers keep the
 *  first occurrence; extra cells beyond the header are ignored. */
export function parseCsv(text: string): CsvRecords {
  const grid = parseCsvGrid(text);
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0]!.map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c]!;
      if (header === '' || Object.prototype.hasOwnProperty.call(record, header)) continue;
      record[header] = (cells[c] ?? '').trim();
    }
    rows.push(record);
  }
  return { headers: headers.filter((h) => h !== ''), rows };
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

/** Serializes records into CSV text using the given header order. */
export function rowsToCsv(rows: Array<Record<string, unknown>>, headers: readonly string[]): string {
  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escapeCsvCell(row[h])).join(','));
  }
  return lines.join('\r\n');
}
