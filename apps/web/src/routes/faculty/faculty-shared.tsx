/** Shared helpers for the Faculty Portal pages. Re-exports the student portal primitives so the
 *  three portals stay visually and behaviourally consistent, plus a couple of faculty-specific
 *  formatters. */
export {
  apiFetch,
  ApiError,
  DataTable,
  PageShell,
  Stat,
  StatusBadge,
  fmtDate,
  fmtDateTime,
  runAction,
  usePortalData,
  type Column,
} from '../portal/portal-shared';
export { PORTAL_CSS } from '../portal/portal-layout';

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function dayName(value: number): string {
  return DAY_NAMES[value] ?? `Day ${value}`;
}

/** Some API list endpoints return `{ items }` / `{ data }` / a bare array depending on the module
 *  they wrap — normalise without leaking `any` into page components. */
export function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  const candidate = value as { items?: T[]; data?: T[] } | null;
  return candidate?.items ?? candidate?.data ?? [];
}
