/**
 * Certificate PDF generator — a dependency-free, deterministic multi-page "PDF 1.4" builder
 * (same approach as the billing invoice PDF, generalized): plain Helvetica, line drawing, colored
 * branding bands and vector-drawn QR codes. No third-party PDF/render library, so the API or
 * worker can regenerate the identical document whenever storage loses it.
 *
 * The QR code is rendered as pure vector rectangles (each dark module becomes a filled `re` op),
 * so no image embedding is needed and the printed code remains scannable.
 */
import QRCode from 'qrcode';

/** A4 in points. */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const CONTENT_W = PAGE_W - MARGIN * 2;

const HEADER_BAND_H = 74;
const FOOTER_MIN = 96;
const LINE_H = 14;

export interface CertificateBranding {
  collegeName?: string | null;
  tagline?: string | null;
  headerText?: string | null;
  footerText?: string | null;
  watermark?: string | null;
  signedBy?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
}

export interface CertificatePdfField {
  label: string;
  value: string;
}

export interface MarkSheetColumn {
  label: string;
  width: number;
  align?: 'left' | 'center' | 'right';
}

export interface MarkSheetTable {
  columns: MarkSheetColumn[];
  rows: Array<Array<string | number | null>>;
}

export interface CertificatePdfInput {
  title: string;
  certificateNumber: string;
  issuedTo: string;
  branding: CertificateBranding;
  fields: CertificatePdfField[];
  table?: MarkSheetTable;
  summary?: CertificatePdfField[];
  issuedDate?: string | null;
  verifyUrl?: string | null;
  qrEnabled: boolean;
}

type FontName = 'F1' | 'F2';
type Align = 'left' | 'center' | 'right';

interface Run {
  text: string;
  font?: FontName;
  size?: number;
  color?: string;
}

interface Op {
  kind: 'text' | 'line' | 'rect';
  font?: FontName;
  x: number;
  y: number;
  size?: number;
  value?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  w?: number;
  h?: number;
  color?: string;
}

interface PageState {
  ops: Op[];
  y: number;
}

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Approximate Helvetica advance — adequate for wrapping/aligning without a font metrics table. */
function textWidth(value: string, size: number): number {
  return value.length * size * 0.5;
}

function toRgb(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  const value =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  const int = Number.parseInt(value.padEnd(6, '0').slice(0, 6), 16);
  return [
    Number(((int >> 16) & 0xff) / 255).toFixed(3),
    Number(((int >> 8) & 0xff) / 255).toFixed(3),
    Number((int & 0xff) / 255).toFixed(3),
  ] as unknown as [number, number, number];
}

const DARK = '#111827';
const GRAY = '#6b7280';
const LIGHT = '#e5e7eb';
const DEFAULT_PRIMARY = '#1e3a5f';

class CertificateDocument {
  private readonly pages: PageState[] = [];
  /** Current content cursor (y measured from the page top). Public so the top-level composer can
   * add spacing/titles/footers around the blocks this class draws. */
  page: PageState;
  private readonly branding: CertificateBranding;
  private readonly primary: string;
  /** Accent color used for the document rules/border/table lines. */
  readonly accent: string;

  constructor(branding: CertificateBranding) {
    this.branding = branding;
    this.primary = branding.primaryColor ?? DEFAULT_PRIMARY;
    this.accent = branding.accentColor ?? '#b45309';
    this.page = { ops: [], y: HEADER_BAND_H + 24 };
    this.pages.push(this.page);
  }

  private owner(): PageState {
    return this.page;
  }

  /** Start a fresh page (with the header band) when the block would overlap the fixed footer. */
  ensureSpace(needed: number): void {
    if (this.page.y + needed > PAGE_H - FOOTER_MIN) {
      this.page = { ops: [], y: HEADER_BAND_H + 24 };
      this.pages.push(this.page);
      this.drawHeader();
    }
  }

  drawHeader(): void {
    this.rectFill(0, PAGE_H - HEADER_BAND_H, PAGE_W, HEADER_BAND_H, this.primary);
    this.text(` ${this.branding.collegeName ?? 'College'}`, MARGIN, PAGE_H - 40, 20, { font: 'F2', color: '#ffffff' });
    if (this.branding.tagline) {
      this.text(` ${this.branding.tagline}`, MARGIN, PAGE_H - 60, 9, { color: '#d1d5db' });
    }
    // Accent rule below the band.
    this.line(0, PAGE_H - HEADER_BAND_H - 2, PAGE_W, PAGE_H - HEADER_BAND_H - 2, this.accent);
  }

  /** Wrap a series of styled runs into visual lines that each fit within `maxWidth`. */
  private wrapRuns(maxWidth: number, runs: Run[]): Array<Array<{ text: string; font: FontName; size: number; color: string }>> {
    const lines: Array<Array<{ text: string; font: FontName; size: number; color: string }>> = [];
    let line: Array<{ text: string; font: FontName; size: number; color: string }> = [];
    let lineW = 0;

    const flush = (): void => {
      if (line.length) {
        lines.push(line);
        line = [];
        lineW = 0;
      }
    };

    for (const run of runs) {
      const size = run.size ?? 11;
      const font = run.font ?? 'F1';
      const color = run.color ?? DARK;
      for (const word of run.text.split(' ')) {
        const gap = line.length ? size * 0.5 : 0;
        const wordW = textWidth(word, size);
        if (line.length && lineW + gap + wordW > maxWidth) {
          flush();
        }
        line.push({ text: word, font, size, color });
        lineW += textWidth(word, size);
      }
      // Restore inter-run gap after a flush so consecutive runs stay visually joined.
      if (line.length) {
        lineW += size * 0.25;
      }
    }
    flush();
    return lines.length ? lines : [[{ text: '', font: 'F1', size: 11, color: DARK }]];
  }

  private emitRuns(
    x: number,
    yTop: number,
    maxWidth: number,
    runs: Run[],
    align: Align,
    lineHeight: number,
  ): void {
    const lines = this.wrapRuns(maxWidth, runs);
    let cursor = yTop;
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      cursor = Math.max(cursor, this.page.y);
      this.ensureSpace(lineHeight);
      let pen = x;
      let width = 0;
      for (const run of line) {
        width += textWidth(run.text, run.size);
      }
      if (align === 'center') pen = x + (maxWidth - width) / 2;
      if (align === 'right') pen = x + maxWidth - width;
      for (const run of line) {
        this.text(run.text, pen, cursor + lineHeight - 3, run.size, { font: run.font as FontName, color: run.color });
        pen += textWidth(run.text, run.size);
      }
      cursor += lineHeight;
    }
  }

  text(value: string, x: number, yTop: number, size: number, opts: { font?: FontName; color?: string } = {}): void {
    this.page.ops.push({
      kind: 'text',
      x,
      y: PAGE_H - yTop,
      size,
      value,
      font: opts.font ?? 'F1',
      color: opts.color ?? DARK,
    });
  }

  line(ax: number, ay: number, bx: number, by: number, color = DARK): void {
    this.page.ops.push({ kind: 'line', x: ax, y: PAGE_H - ay, x2: bx, y2: PAGE_H - by, color });
  }

  rectFill(x: number, yTop: number, w: number, h: number, color: string): void {
    this.page.ops.push({ kind: 'rect', x, y: PAGE_H - yTop - h, w, h, color });
  }

  paragraph(x: number, yTop: number, maxWidth: number, runs: Run[], opts: { align?: Align; lineHeight?: number } = {}): number {
    const lineHeight = opts.lineHeight ?? LINE_H;
    this.emitRuns(x, yTop, maxWidth, runs, opts.align ?? 'left', lineHeight);
    return this.page.y;
  }

  table(x: number, yTop: number, width: number, table: MarkSheetTable): void {
    const header = table.columns.map((c) => c.label);
    const drawHeaderAt = (): void => {
      const height = 24;
      const headerY = this.ensureRow(height);
      this.rectFill(x, headerY, width, height, this.primary);
      this.rowCells(x, headerY, height, width, table, header, true);
      this.line(x, headerY + height, x + width, headerY + height, this.accent);
      this.page.y = headerY + height;
    };
    const drawBodyRow = (row: Array<string | number | null>): void => {
      const cells = row.map((c) => (c === null || c === undefined ? '' : String(c)));
      const height = this.rowHeight(x, width, table, cells);
      const rowY = this.ensureRow(height);
      this.rowCells(x, rowY, height, width, table, cells, false);
      this.line(x, rowY + height, x + width, rowY + height, LIGHT);
      this.page.y = rowY + height;
    };

    this.page.y = yTop;
    drawHeaderAt();
    for (const row of table.rows) {
      // If the next row will not fit on this page (allowed space above the fixed footer), start a
      // fresh page and repeat the column header — a table can span pages this way.
      if (this.page.y + 30 > PAGE_H - FOOTER_MIN) {
        this.page = { ops: [], y: HEADER_BAND_H + 24 };
        this.pages.push(this.page);
        this.drawHeader();
        this.page.y = HEADER_BAND_H + 24;
        drawHeaderAt();
      }
      drawBodyRow(row);
    }
  }

  private ensureRow(height: number): number {
    if (this.page.y + height > PAGE_H - FOOTER_MIN) {
      this.page = { ops: [], y: HEADER_BAND_H + 24 };
      this.pages.push(this.page);
      this.drawHeader();
    }
    return this.page.y;
  }

  private rowHeight(x: number, width: number, table: MarkSheetTable, cells: string[]): number {
    let height = 26;
    cells.forEach((cell, ci) => {
      const col = table.columns[ci];
      if (!col) return;
      const colW = width * col.width - 8;
      if (colW <= 0) return;
      const lines = this.wrapRuns(colW, [{ text: cell, size: 9 }]);
      height = Math.max(height, lines.length * 12 + 8);
    });
    return height;
  }

  private rowCells(
    x: number,
    rowY: number,
    height: number,
    width: number,
    table: MarkSheetTable,
    cells: string[],
    isHeader: boolean,
  ): void {
    let colX = x;
    cells.forEach((cell, ci) => {
      const col = table.columns[ci];
      if (!col) return;
      const colW = width * col.width;
      const textX = colX + 4;
      const textW = colW - 8;
      const lines = this.wrapRuns(
        Math.max(textW, 8),
        [{ text: cell, size: 9, font: isHeader ? 'F2' : 'F1', color: isHeader ? '#ffffff' : DARK }],
      );
      let pen = rowY + (height - lines.length * 12) / 2;
      for (const line of lines) {
        let start = textX;
        let runW = 0;
        for (const run of line) runW += textWidth(run.text, run.size);
        if (col.align === 'center') start = textX + (textW - runW) / 2;
        if (col.align === 'right') start = textX + textW - runW;
        for (const run of line) {
          this.text(run.text, start, pen + 12 - 3, run.size, { font: run.font, color: run.color });
          start += textWidth(run.text, run.size);
        }
        pen += 12;
      }
      this.line(colX, rowY, colX, rowY + height, LIGHT);
      colX += colW;
    });
  }

  get finishedY(): number {
    return this.page.y;
  }

  drawFooter(input: CertificatePdfInput): void {
    const yBase = PAGE_H - FOOTER_MIN + 8;
    this.line(MARGIN, yBase, PAGE_W - MARGIN, yBase, this.accent);

    let leftY = yBase - 22;
    if (input.branding.signedBy) {
      this.text(input.branding.signedBy, MARGIN, leftY, 10, { font: 'F2' });
      this.line(MARGIN, leftY + 2, MARGIN + 140, leftY + 2, DARK);
      this.text('Authorized Signatory', MARGIN, leftY - 12, 8, { color: GRAY });
    }

    let rightX = PAGE_W - MARGIN;
    this.text(
      `Certificate No: ${input.certificateNumber}`,
      rightX - textWidth(`${input.certificateNumber}`, 9),
      yBase - 22,
      9,
      { color: GRAY },
    );
    if (input.issuedDate) {
      this.text(
        `Issued on: ${input.issuedDate}`,
        rightX - textWidth(`Issued on: ${input.issuedDate}`, 9),
        yBase - 36,
        9,
        { color: GRAY },
      );
    }
    if (input.branding.footerText) {
      this.text(input.branding.footerText, MARGIN, yBase - 40, 8, { color: GRAY });
    }

    if (input.qrEnabled && input.verifyUrl && this.drawQr(input.verifyUrl, rightX - 130, yBase - 100)) {
      this.text('Scan to verify', rightX - 30 - textWidth('Scan to verify', 8), yBase - 118, 8, { color: GRAY });
      const shortUrl = input.verifyUrl.length > 90 ? `${input.verifyUrl.slice(0, 87)}...` : input.verifyUrl;
      this.text(shortUrl, rightX - 110 - textWidth(shortUrl, 6), yBase - 128, 6, { color: GRAY });
    }
  }

  /** Draw a QR code from its module matrix as filled rectangles. Returns true when drawn. */
  private drawQr(text: string, topRightX: number, topY: number): boolean {
    let qr: QRCode.QRCode;
    try {
      qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
    } catch {
      return false;
    }
    const modules = qr.modules.size;
    const modulePx = 2.4; // ~86pt wide / 36 modules at v5 → crisp enough on screen & print
    const total = modules * modulePx + 4 * modulePx * 2;
    const quiet = modulePx * 2;
    const x0 = topRightX - total;
    const y0 = topY;
    // White quiet zone.
    this.rectFill(x0, y0, total, total, '#ffffff');
    const data = qr.modules.data;
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (data[row * modules + col]! & 1) {
          this.rectFill(x0 + quiet + col * modulePx, y0 + quiet + row * modulePx, modulePx, modulePx, '#000000');
        }
      }
    }
    return true;
  }

  build(): Buffer {
    const fontCount = 2;
    const pageCount = this.pages.length;
    const objectCount = 2 + pageCount + fontCount + pageCount;
    const objects: string[] = [];

    // 1 = Catalog, 2 = Pages
    const pageRefs = Array.from({ length: pageCount }, (_, i) => 3 + i);
    objects.push('<< /Type /Catalog /Pages 2 0 R >>');
    objects.push(`<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(' ')}] /Count ${pageCount} >>`);

    const fontBase = 3 + pageCount;
    const f1Ref = fontBase;
    const f2Ref = fontBase + 1;
    const streamBase = fontBase + 2;

    this.pages.forEach((page, i) => {
      const contentRef = streamBase + i;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${f1Ref} 0 R /F2 ${f2Ref} 0 R >> >> /Contents ${contentRef} 0 R >>`,
      );
    });
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

    for (const page of this.pages) {
      const content = this.renderContent(page.ops);
      objects.push(`<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`);
    }

    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    for (let i = 0; i < objects.length; i += 1) {
      offsets.push(Buffer.byteLength(pdf, 'utf8'));
      pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    }

    const xrefStart = Buffer.byteLength(pdf, 'utf8');
    pdf += `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets) {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

    return Buffer.from(pdf, 'utf8');
  }

  private renderContent(ops: Op[]): string {
    const lines: string[] = [];
    let fillColor: string | null = null;
    for (const op of ops) {
      if (op.color && op.color !== fillColor) {
        const [r, g, b] = toRgb(op.color);
        lines.push(`${r} ${g} ${b} rg`);
        fillColor = op.color;
      }
      if (op.kind === 'line') {
        lines.push('0.75 w');
        lines.push(`${op.x.toFixed(2)} ${op.y.toFixed(2)} m ${op.x2?.toFixed(2)} ${op.y2?.toFixed(2)} l S`);
        lines.push('1 w');
      } else if (op.kind === 'rect') {
        lines.push(`${op.x.toFixed(2)} ${op.y.toFixed(2)} ${op.w?.toFixed(2)} ${op.h?.toFixed(2)} re f`);
      } else {
        lines.push(
          `BT /${op.font ?? 'F1'} ${op.size ?? 11} Tf ${op.x.toFixed(2)} ${op.y.toFixed(2)} Td (${escapePdfText(op.value ?? '')}) Tj ET`,
        );
      }
    }
    return lines.join('\n');
  }
}

export function buildCertificatePdf(input: CertificatePdfInput): Buffer {
  const doc = new CertificateDocument(input.branding);

  doc.drawHeader();

  // Title.
  doc.ensureSpace(60);
  doc.text(input.title, MARGIN, doc.page.y, 17, { font: 'F2', color: doc.accent });
  doc.line(MARGIN, doc.page.y + 6, PAGE_W - MARGIN, doc.page.y + 6, doc.accent);
  doc.page.y += 26;

  // Issued to.
  doc.paragraph(MARGIN, doc.page.y, CONTENT_W, [
    { text: 'Issued to: ', font: 'F2', size: 11 },
    { text: input.issuedTo, size: 12 },
  ]);
  doc.page.y += 4;

  // Watermark (light, centered).
  if (input.branding.watermark) {
    const wm = input.branding.watermark;
    const wmSize = Math.min(44, (CONTENT_W * 2) / wm.length);
    if (wmSize >= 12) {
      doc.text(wm, MARGIN + (CONTENT_W - textWidth(wm, wmSize)) / 2, PAGE_H - 360, wmSize, { color: '#f3f4f6' });
    }
  }

  // Fields.
  for (const field of input.fields) {
    if (!field.value.trim()) continue;
    doc.paragraph(MARGIN, doc.page.y, CONTENT_W, [
      { text: `${field.label}: `, font: 'F2', size: 10, color: GRAY },
      { text: field.value, size: 11 },
    ]);
    doc.page.y += 3;
  }

  if (input.table && input.table.columns.length && input.table.rows.length) {
    doc.page.y += 10;
    doc.ensureSpace(30);
    doc.table(MARGIN, doc.page.y, CONTENT_W, input.table);
    doc.page.y = doc.finishedY + 18;
  }

  if (input.summary && input.summary.length) {
    doc.ensureSpace(30);
    for (const item of input.summary) {
      doc.paragraph(MARGIN, doc.page.y, CONTENT_W, [
        { text: item.label, font: 'F2', size: 10, color: GRAY },
        { text: item.value, size: 11 },
      ]);
      doc.page.y += 1;
    }
    doc.page.y += 8;
  }

  doc.ensureSpace(120);
  doc.drawFooter(input);

  return doc.build();
}