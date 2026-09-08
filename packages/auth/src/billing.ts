/**
 * Aggregate debt model — rounds first, carries an invoice balance (with per-item commitments so
 * prorated/line-item adjustments stay attributable), then applies a proration hint. Truly shared
 * money math for invoices AND subscription plan changes so apps/api and apps/worker never drift
 * into two copies of a formula.
 *
 * All amounts are integer cents; tax rates are basis points (1800 = 18%). Sequences for invoice
 * numbering are allocated by the caller from billing_config.next_invoice_sequence (atomic
 * UPDATE … RETURNING); these helpers only render/format so the format lives in one place.
 */

export interface InvoiceTotals {
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
}

/** Tax over a subtotal at a rate in basis points (1800 = 18%). Rounds half-up, never negative. */
export function computeTaxCents(subtotalCents: number, taxRateBps: number): number {
  if (subtotalCents <= 0) return 0;
  return Math.round((subtotalCents * taxRateBps) / 10_000);
}

/** Full invoice money view for a (possibly net-credit) subtotal taxed at `taxRateBps`. A
 *  negative subtotal (e.g. a proration credit larger than the pro-rated charge) is not taxable
 *  and clamps the total at 0 — the residual credit is shown on the lines but not refunded. */
export function computeInvoiceTotals(subtotalCents: number, taxRateBps: number): InvoiceTotals {
  const taxCents = computeTaxCents(subtotalCents, taxRateBps);
  return { subtotalCents, taxCents, totalCents: Math.max(subtotalCents + taxCents, 0) };
}

/** Sequential invoice number: `PREFIX-YYYYMMDD-000123`. `sequence` is the already-allocated,
 *  de-incremented billing_config sequence value (post-increment value minus one). */
export function formatInvoiceNumber(prefix: string, sequence: number, date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${String(sequence).padStart(6, '0')}`;
}

/**
 * Prorated share of a price for the part of the billing period still remaining at `at` —
 * the same formula serves credits (old plan's unused portion) and charges (new plan's
 * remaining portion). Rounded half-up, clamped to [0, priceCents] so an over-remaining
 * fraction (shouldn't happen but defensive) never yields a negative line.
 */
export function proratedShareCents(
  priceCents: number,
  periodStart: Date,
  periodEnd: Date,
  at: Date,
): number {
  const totalMs = periodEnd.getTime() - periodStart.getTime();
  const remainingMs = periodEnd.getTime() - at.getTime();
  if (totalMs <= 0 || remainingMs <= 0 || priceCents <= 0) return 0;
  const share = Math.round((priceCents * remainingMs) / totalMs);
  return Math.max(0, Math.min(share, priceCents));
}

/** `amountCents` formatted ASCII-safe (no non-latin glyphs) for PDFs and logs: `INR 1,234.00`. */
export function formatCentsAscii(amountCents: number, currency: string): string {
  const value = (amountCents / 100).toFixed(2);
  const [intPart, fracPart] = value.split('.');
  const separator = ',';
  const grouped = (intPart ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, separator);
  return `${currency} ${grouped}.${fracPart ?? '00'}`;
}

/** Add whole days to a date (local-time safe for dueAt/grace math). */
export function addDaysToDate(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}