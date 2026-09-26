import { renderTablePdf } from './pdf';
import type { ReportColumn, ReportExportFormat, ReportResult, ReportRow, RenderedReport } from './types';

const CONTENT_TYPES: Record<ReportExportFormat, string> = {
  CSV: 'text/csv; charset=utf-8',
  EXCEL: 'application/vnd.ms-excel',
  PDF: 'application/pdf',
};

const EXTENSIONS: Record<ReportExportFormat, RenderedReport['extension']> = {
  CSV: 'csv',
  EXCEL: 'xls',
  PDF: 'pdf',
};

export interface RenderOptions {
  title?: string;
  subtitle?: string;
  fileNameBase?: string;
}

function safeFileBase(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'report'
  );
}

function isNumeric(format: ReportColumn['format']): boolean {
  return format === 'number' || format === 'currency' || format === 'percent';
}

function csvCell(value: ReportRow[string] | undefined, format: ReportColumn['format']): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && isNumeric(format)) return String(value);
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function renderCsv(result: ReportResult): Buffer {
  const lines: string[] = [];
  lines.push(result.columns.map((column) => csvCell(column.label, 'text')).join(','));
  for (const row of result.rows) {
    lines.push(result.columns.map((column) => csvCell(row[column.key], column.format)).join(','));
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n`, 'utf8');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function xmlCell(value: ReportRow[string] | undefined, format: ReportColumn['format']): string {
  if (value === null || value === undefined || value === '') return '<Cell/>';
  if (typeof value === 'number' && isNumeric(format)) {
    return `<Cell><Data ss:Type="Number">${Number.isFinite(value) ? value : 0}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(String(value))}</Data></Cell>`;
}

function renderExcel(result: ReportResult): Buffer {
  const header = result.columns.map((column) => `<Cell ss:StyleID="header"><Data ss:Type="String">${escapeXml(column.label)}</Data></Cell>`).join('');
  const body = result.rows
    .map((row) => `<Row>${result.columns.map((column) => xmlCell(row[column.key], column.format)).join('')}</Row>`)
    .join('\n');
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="header"><Font ss:Bold="1"/><Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="Report">
  <Table>
   <Row>${header}</Row>
${body}
  </Table>
 </Worksheet>
</Workbook>`;
  return Buffer.from(xml, 'utf8');
}

export function renderReport(format: ReportExportFormat, result: ReportResult, options: RenderOptions = {}): RenderedReport {
  const title = options.title ?? result.definition.name;
  const base = safeFileBase(options.fileNameBase ?? result.definition.key);
  const extension = EXTENSIONS[format];
  const fileName = `${base}-${result.generatedAt.slice(0, 10)}.${extension}`;

  if (format === 'CSV') {
    return { buffer: renderCsv(result), fileName, contentType: CONTENT_TYPES.CSV, extension };
  }
  if (format === 'EXCEL') {
    return { buffer: renderExcel(result), fileName, contentType: CONTENT_TYPES.EXCEL, extension };
  }
  const filters: Record<string, string> = {};
  for (const [key, value] of Object.entries(result.filters)) {
    if (value !== undefined && value !== null && typeof value !== 'object') filters[key] = String(value);
  }
  const buffer = renderTablePdf({
    title,
    subtitle: options.subtitle,
    generatedAt: result.generatedAt,
    filters,
    summary: result.summary,
    columns: result.columns,
    rows: result.rows,
  });
  return { buffer, fileName, contentType: CONTENT_TYPES.PDF, extension };
}

export function reportContentType(format: ReportExportFormat): string {
  return CONTENT_TYPES[format];
}
