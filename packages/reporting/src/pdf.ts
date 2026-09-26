import type { ReportColumn, ReportRow } from './types';

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 36;
const HEADER_FONT_SIZE = 9;
const TITLE_FONT_SIZE = 15;
const ROW_HEIGHT = 15;
const TABLE_TOP_OFFSET = 74;

interface PdfInput {
  title: string;
  subtitle?: string;
  generatedAt: string;
  filters: Record<string, string>;
  summary: Record<string, number>;
  columns: ReportColumn[];
  rows: ReportRow[];
}

function sanitize(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[^\x20-\x7E]/g, '?');
  return raw;
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function draw(text: string, x: number, y: number, font: 'F1' | 'F2', size: number): string {
  return `BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapePdf(sanitize(text))}) Tj ET`;
}

function formatCell(value: ReportRow[string] | undefined, format: ReportColumn['format']): string {
  if (value === null || value === undefined) return '';
  if (format === 'currency' && typeof value === 'number') return value.toFixed(2);
  if (format === 'percent' && typeof value === 'number') return `${value.toFixed(2)}%`;
  if (format === 'date' && typeof value === 'string') return value.slice(0, 10);
  if (format === 'datetime' && typeof value === 'string') return value.replace('T', ' ').slice(0, 19);
  return String(value);
}

function columnWidths(columns: ReportColumn[], rows: ReportRow[]): number[] {
  const available = PAGE_WIDTH - MARGIN * 2;
  const sample = rows.slice(0, 250);
  const raw = columns.map((column) => {
    const longest = sample.reduce((max, row) => Math.max(max, formatCell(row[column.key], column.format).length), column.label.length);
    return Math.min(34, Math.max(8, longest));
  });
  const total = raw.reduce((sum, width) => sum + width, 0) || 1;
  return raw.map((width) => Math.max(36, (width / total) * available));
}

function availableRows(): number {
  return Math.max(1, Math.floor((PAGE_HEIGHT - MARGIN * 2 - TABLE_TOP_OFFSET) / ROW_HEIGHT));
}

export function renderTablePdf(input: PdfInput): Buffer {
  const widths = columnWidths(input.columns, input.rows);
  const perPage = availableRows();
  const pageCount = Math.max(1, Math.ceil(input.rows.length / perPage));
  const pages: string[] = [];

  const filterLine = Object.entries(input.filters)
    .map(([key, value]) => `${key}=${value}`)
    .join('  ');
  const summaryLine = Object.entries(input.summary)
    .map(([key, value]) => `${key}=${value}`)
    .join('  ');

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const ops: string[] = [];
    let y = PAGE_HEIGHT - MARGIN;
    ops.push(draw(input.title, MARGIN, y, 'F2', TITLE_FONT_SIZE));
    y -= 18;
    if (input.subtitle) {
      ops.push(draw(input.subtitle, MARGIN, y, 'F1', 10));
      y -= 13;
    }
    ops.push(draw(`Generated ${input.generatedAt}`, MARGIN, y, 'F1', HEADER_FONT_SIZE));
    y -= 12;
    if (filterLine) {
      ops.push(draw(fitToWidth(`Filters: ${filterLine}`, widths.reduce((sum, width) => sum + width, 0), HEADER_FONT_SIZE), MARGIN, y, 'F1', HEADER_FONT_SIZE));
      y -= 12;
    }
    if (summaryLine) {
      ops.push(draw(fitToWidth(`Summary: ${summaryLine}`, widths.reduce((sum, width) => sum + width, 0), HEADER_FONT_SIZE), MARGIN, y, 'F1', HEADER_FONT_SIZE));
      y -= 12;
    }

    const headerY = PAGE_HEIGHT - MARGIN - TABLE_TOP_OFFSET + 14;
    let x = MARGIN;
    input.columns.forEach((column, index) => {
      ops.push(draw(fitToWidth(column.label, widths[index] ?? 60, HEADER_FONT_SIZE), x, headerY, 'F2', HEADER_FONT_SIZE));
      x += widths[index] ?? 60;
    });
    ops.push(draw(`Page ${pageIndex + 1} of ${pageCount}`, PAGE_WIDTH - MARGIN - 80, MARGIN - 12, 'F1', 8));

    const start = pageIndex * perPage;
    const slice = input.rows.slice(start, start + perPage);
    slice.forEach((row, rowIndex) => {
      const rowY = headerY - ROW_HEIGHT * (rowIndex + 1);
      let cellX = MARGIN;
      input.columns.forEach((column, columnIndex) => {
        const width = widths[columnIndex] ?? 60;
        const value = formatCell(row[column.key], column.format);
        ops.push(draw(fitToWidth(value, width - 4, HEADER_FONT_SIZE), cellX, rowY, 'F1', HEADER_FONT_SIZE));
        cellX += width;
      });
    });

    pages.push(ops.join('\n'));
  }

  return buildPdf(pages);
}

function fitToWidth(value: string, width: number, fontSize: number): string {
  const maxChars = Math.max(1, Math.floor(width / (fontSize * 0.5)));
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function buildPdf(pageStreams: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = pageStreams.map((_, index) => 5 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageStreams.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pageStreams.forEach((stream, index) => {
    const pageId = pageIds[index] ?? 5;
    const contentId = pageId + 1;
    objects[pageId] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, 'latin1');
    pdf += `${id} 0 obj\n${objects[id] ?? ''}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) {
    pdf += `${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
