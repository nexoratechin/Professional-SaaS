/**
 * Client-side relevance for search rows. The API returns a small, capped page per entity type and
 * ranks it in memory by how a row's labels match the query, because Postgres/Prisma cannot express
 * "prefix beats substring" in a single ORDER BY across heterogeneous label columns.
 *
 *   exact match            → 1.00
 *   matches from the start → 0.85
 *   word-boundary match    → 0.70
 *   anywhere else          → 0.50
 *   no match               → 0.00
 */
export function relevanceScore(query: string, values: Array<string | null | undefined>): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  let best = 0;
  for (const value of values) {
    if (!value) continue;
    const haystack = value.toLowerCase();
    if (haystack === needle) {
      best = Math.max(best, 1);
    } else if (haystack.startsWith(needle)) {
      best = Math.max(best, 0.85);
    } else if (haystack.includes(` ${needle}`)) {
      best = Math.max(best, 0.7);
    } else if (haystack.includes(needle)) {
      best = Math.max(best, 0.5);
    }
  }
  return best;
}

/** "PARTIALLY_PAID" → "Partially Paid". Display-only. */
export function humanizeCode(value: string | null | undefined): string | null {
  if (!value) return null;
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** Rupee formatting consistent with the rest of the tenant UI (hostel/library/transport). */
export function formatAmount(cents: number | null | undefined): string {
  const value = (cents ?? 0) / 100;
  return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** ISO date → "12 Mar 2026". */
export function formatDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
