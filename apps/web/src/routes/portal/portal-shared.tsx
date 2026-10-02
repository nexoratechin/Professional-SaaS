import React from 'react';
import { apiFetch, ApiError } from '../../lib/http';

/** Shared helpers for the Student Portal pages. Kept self-contained (no dependency on the
 *  staff-facing *-shared.tsx files) so the portal remains a cohesive, mobile-first experience. */

export { apiFetch, ApiError };

export function money(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const STATUS_COLORS: Record<string, string> = {
  PRESENT: '#15803d',
  ABSENT: '#b91c1c',
  LATE: '#b45309',
  LEAVE: '#6b7280',
  PAID: '#15803d',
  ISSUED: '#1d4ed8',
  OVERDUE: '#b91c1c',
  PARTIALLY_PAID: '#b45309',
  WAIVED: '#6b7280',
  REFUNDED: '#6b7280',
  REQUESTED: '#b45309',
  GENERATED: '#1d4ed8',
  APPROVED: '#7c3aed',
  REJECTED: '#b91c1c',
  REVOKED: '#6b7280',
  ACTIVE: '#15803d',
  NEW: '#1d4ed8',
  OPEN: '#1d4ed8',
  IN_PROGRESS: '#b45309',
  PENDING: '#b45309',
  RESOLVED: '#15803d',
  CLOSED: '#6b7280',
  REOPENED: '#7c3aed',
  CANCELLED: '#6b7280',
  RETURNED: '#15803d',
  ALLOCATED: '#1d4ed8',
  CHECKED_IN: '#15803d',
  CHECKED_OUT: '#6b7280',
  EXPIRED: '#b91c1c',
  SUSPENDED: '#b91c1c',
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return <span style={{ color: '#9ca3af' }}>—</span>;
  const color = STATUS_COLORS[value] ?? '#334155';
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: '0.75rem',
        fontWeight: 600,
        color,
        background: `${color}1a`,
        whiteSpace: 'nowrap',
      }}
    >
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="sp-stat">
      <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: 4 }}>{value}</div>
      {hint && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

export interface Column<T> {
  label: string;
  render: (row: T) => React.ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: string;
}) {
  if (!rows.length) return <p style={{ color: '#9ca3af' }}>{empty ?? 'No records yet.'}</p>;
  return (
    <div className="sp-table-wrap">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
            {columns.map((column) => (
              <th key={column.label} style={{ padding: 8, whiteSpace: 'nowrap' }}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)} style={{ borderBottom: '1px solid #e5e7eb' }}>
              {columns.map((column) => (
                <td key={column.label} style={{ padding: 8, verticalAlign: 'top' }}>
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Generic paged query hook — swaps the loading/error/refetch boilerplate for one call. */
export function usePortalData<T>(path: string) {
  const [data, setData] = React.useState<T | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<T>(path);
      setData(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [path]);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  return { data, error, loading, reload, setData };
}

export function PageShell({
  title,
  subtitle,
  actions,
  error,
  notice,
  loading,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  error?: string | null;
  notice?: string | null;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="sp-page-head">
        <div>
          <h1 style={{ fontSize: '1.3rem', margin: 0 }}>{title}</h1>
          {subtitle && <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: '0.9rem' }}>{subtitle}</p>}
        </div>
        {actions && <div className="sp-actions">{actions}</div>}
      </div>
      {error && <p style={{ color: '#b91c1c', margin: 0 }}>{error}</p>}
      {notice && <p style={{ color: '#15803d', margin: 0 }}>{notice}</p>}
      {loading ? <p style={{ color: '#9ca3af' }}>Loading…</p> : children}
    </div>
  );
}

/** Small wrapper that turns a thrown ApiError into a user-facing message, preserving success. */
export async function runAction(
  action: () => Promise<unknown>,
  messages: { success?: string; onError: (message: string) => void; onNotice?: (message: string) => void },
): Promise<boolean> {
  try {
    await action();
    if (messages.success && messages.onNotice) messages.onNotice(messages.success);
    return true;
  } catch (err) {
    messages.onError(err instanceof ApiError ? err.message : 'Operation failed.');
    return false;
  }
}
