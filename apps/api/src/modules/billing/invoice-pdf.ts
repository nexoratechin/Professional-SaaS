import { formatCentsAscii } from '@college-erp/auth';

export interface InvoicePdfInput {
  invoiceNumber: string;
  status: string;
  currency: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  periodStart: Date;
  periodEnd: Date;
  issuedAt: Date;
  dueAt: Date | null;
  paidAt: Date | null;
  taxName: string;
  taxRateBps: number;
  tenantName: string;
  billingEmail: string;
  planName: string;
  lineItems: Array<{ description: string; quantity: number; unitPriceCents: number; amountCents: number }>;
}

// A4 in points.
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 48;
const LINE_H = 15;

type Op =
  | { kind: 'line'; y1: number; y2: number }
  | { kind: 'text'; x: number; y: number; size: number; value: string; bold?: boolean };

function escapePdfText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/** Approximate Helvetica advance so right-aligned columns land close enough without a font
 * measuring table — adequate for a table of ASCII money values. */
function textWidth(value: string, size: number): number {
  return value.length * size * 0.5;
}

/**
 * Generates a minimal, self-contained single-page invoice PDF with no third-party library —
 * plain Helvetica + line drawing, ASCII-safe amounts (via formatCentsAscii). Deterministic, so
 * the API or worker can regenerate the same document on demand if storage ever loses it.
 */
export function buildInvoicePdf(input: InvoicePdfInput): Buffer {
  const ops: Op[] = [];

  const column = (x: number, size: number, y: number, value: string, right = false): void => {
    ops.push({ kind: 'text', x: right ? x - textWidth(value, size) : x, y, size, value });
  };

  // Header: product name + invoice number/status/issue date.
  const headerY = PAGE_H - 70;
  ops.push({ kind: 'text', x: MARGIN, y: headerY, size: 18, value: input.planName });
  ops.push({ kind: 'text', x: MARGIN, y: headerY - 16, size: 11, value: 'Subscription invoice' });
  column(PAGE_W - MARGIN, 11, headerY, input.invoiceNumber, true);
  column(PAGE_W - MARGIN, 11, headerY - 16, `Status: ${input.status}`, true);
  column(PAGE_W - MARGIN, 11, headerY - 32, `Issued: ${input.issuedAt.toISOString().slice(0, 10)}`, true);

  // Bill-to block.
  let y = PAGE_H - 130;
  ops.push({ kind: 'text', x: MARGIN, y, size: 11, value: 'Bill to' });
  ops.push({ kind: 'text', x: MARGIN, y: y - 16, size: 11, value: input.tenantName });
  ops.push({ kind: 'text', x: MARGIN, y: y - 32, size: 11, value: input.billingEmail });
  ops.push({
    kind: 'text',
    x: MARGIN,
    y: y - 56,
    size: 11,
    value: `Billing period: ${input.periodStart.toISOString().slice(0, 10)} to ${input.periodEnd.toISOString().slice(0, 10)}`,
  });
  if (input.dueAt) {
    ops.push({ kind: 'text', x: MARGIN, y: y - 72, size: 11, value: `Due: ${input.dueAt.toISOString().slice(0, 10)}` });
  } else if (input.paidAt) {
    ops.push({ kind: 'text', x: MARGIN, y: y - 72, size: 11, value: `Paid: ${input.paidAt.toISOString().slice(0, 10)}` });
  }

  // Line-items table.
  const descX = MARGIN;
  const qtyX = PAGE_W - MARGIN - 260;
  const unitX = PAGE_W - MARGIN - 155;
  const amountX = PAGE_W - MARGIN;

  let tableY = PAGE_H - 300;
  ops.push({ kind: 'line', y1: tableY, y2: tableY });
  tableY -= LINE_H;
  ops.push({ kind: 'text', x: descX, y: tableY, size: 10, value: 'Description' });
  ops.push({ kind: 'text', x: qtyX, y: tableY, size: 10, value: 'Qty' });
  ops.push({ kind: 'text', x: unitX, y: tableY, size: 10, value: 'Unit price' });
  ops.push({ kind: 'text', x: amountX, y: tableY, size: 10, value: 'Amount', bold: true });
  tableY -= LINE_H;
  ops.push({ kind: 'line', y1: tableY, y2: tableY });

  for (const item of input.lineItems) {
    tableY -= LINE_H;
    ops.push({ kind: 'text', x: descX, y: tableY, size: 10, value: item.description.slice(0, 64) });
    ops.push({ kind: 'text', x: qtyX, y: tableY, size: 10, value: String(item.quantity) });
    column(unitX, 10, tableY, formatCentsAscii(item.unitPriceCents, input.currency), true);
    column(amountX, 10, tableY, formatCentsAscii(item.amountCents, input.currency), true);
  }

  tableY -= LINE_H;
  ops.push({ kind: 'line', y1: tableY, y2: tableY });

  // Totals.
  let ty = tableY - LINE_H;
  ops.push({ kind: 'text', x: descX, y: ty, size: 10, value: `Subtotal (${input.currency})` });
  column(amountX, 10, ty, formatCentsAscii(input.subtotalCents, input.currency), true);
  ty -= LINE_H;
  const ratePct = input.subtotalCents > 0 ? ((input.taxRateBps / 100).toFixed(2)) : '0.00';
  ops.push({ kind: 'text', x: descX, y: ty, size: 10, value: `${input.taxName} (${ratePct}%)` });
  column(amountX, 10, ty, formatCentsAscii(input.taxCents, input.currency), true);
  ty -= LINE_H;
  ops.push({ kind: 'text', x: descX, y: ty, size: 12, value: 'Total due', bold: true });
  column(amountX, 12, ty, formatCentsAscii(input.totalCents, input.currency), true);

  // Footer.
  ops.push({ kind: 'line', y1: 70, y2: 70 });
  ops.push({ kind: 'text', x: MARGIN, y: 52, size: 8, value: `${input.planName} — College ERP subscription billing` });

  return buildPdf(renderContent(ops));
}

function renderContent(ops: Op[]): string {
  const lines: string[] = [];
  for (const op of ops) {
    if (op.kind === 'line') {
      lines.push(`${MARGIN} ${op.y1} m ${PAGE_W - MARGIN} ${op.y2} l S`);
    } else {
      const font = op.bold ? 'F1' : 'F1';
      lines.push(`BT /${font} ${op.size} Tf ${op.x.toFixed(2)} ${op.y.toFixed(2)} Td (${escapePdfText(op.value)}) Tj ET`);
    }
  }
  return lines.join('\n');
}

function buildPdf(content: string): Buffer {
  const objectCount = 5;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
  ];

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