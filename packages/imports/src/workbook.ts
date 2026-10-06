/**
 * Format dispatch on top of the CSV and XLSX codecs. `parseTabularFile` is the single entry
 * point both the API's preview endpoint and the worker's processor use, so CSV and Excel are
 * treated identically downstream.
 */
import { parseCsv, rowsToCsv } from './csv';
import { readXlsx, writeXlsx } from './xlsx';
import type { ImportEntityDefinition, ImportFileFormat, ParsedFile } from './types';
import { buildTemplateSheet } from './types';

export function detectFormat(fileName: string): ImportFileFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'XLSX';
  return 'CSV';
}

function normalizeGrid(grid: string[][]): ParsedFile {
  if (grid.length === 0) return { headers: [], rows: [], totalRows: 0 };
  const headers = grid[0]!.map((h) => h.trim());
  const rows: Array<Record<string, string>> = [];
  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r]!;
    if (cells.every((c) => c.trim() === '')) continue;
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c]!;
      if (header === '' || Object.prototype.hasOwnProperty.call(record, header)) continue;
      record[header] = (cells[c] ?? '').trim();
    }
    rows.push(record);
  }
  return { headers: headers.filter((h) => h !== ''), rows, totalRows: rows.length };
}

/** Parses an uploaded CSV/XLSX buffer into headers + row records. */
export function parseTabularFile(buffer: Buffer, format: ImportFileFormat): ParsedFile {
  if (format === 'XLSX') {
    return normalizeGrid(readXlsx(buffer));
  }
  const { headers, rows } = parseCsv(buffer.toString('utf8'));
  return { headers, rows, totalRows: rows.length };
}

/** Serializes arbitrary rows using an explicit header order. */
export function serializeTabularFile(
  format: ImportFileFormat,
  headers: string[],
  rows: Array<Record<string, unknown>>,
): Buffer {
  if (format === 'XLSX') {
    const grid: string[][] = [headers];
    for (const row of rows) {
      grid.push(headers.map((h) => (row[h] === null || row[h] === undefined ? '' : String(row[h]))));
    }
    return writeXlsx(grid);
  }
  // CSV path — re-use the codec directly (avoids an eager XLSX import for the common case).
  return Buffer.from(rowsToCsv(rows, headers), 'utf8');
}

/** Builds the downloadable template buffer (header row + sample rows) for an entity. */
export function buildTemplateFile(
  entity: ImportEntityDefinition,
  format: ImportFileFormat,
): { buffer: Buffer; fileName: string } {
  const sheet = buildTemplateSheet(entity);
  const buffer = serializeTabularFile(format, sheet.headers, sheet.rows);
  const extension = format === 'XLSX' ? 'xlsx' : 'csv';
  return { buffer, fileName: `${entity.key}-import-template.${extension}` };
}
