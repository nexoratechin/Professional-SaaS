/**
 * Shared presentation for the integrations page.
 *
 * Split out from integrations.tsx only to keep that file readable — the page itself is one cohesive
 * screen and splitting its tabs across files would obscure the flow. Nothing here talks to the API;
 * it is pure display so the same badges and empty states read identically wherever they appear.
 */

import React from 'react';

/** Matches the API's INTEGRATION_CATEGORIES. */
export const INTEGRATION_CATEGORIES = [
  'PAYMENT_GATEWAY',
  'ACCOUNTING',
  'LMS',
  'BIOMETRIC',
  'RFID',
  'IDENTITY_PROVIDER',
  'DOCUMENT_SERVICE',
  'SMS',
  'WHATSAPP',
  'EMAIL',
] as const;
export type IntegrationCategory = (typeof INTEGRATION_CATEGORIES)[number];

export const INTEGRATION_STATUSES = ['DRAFT', 'ACTIVE', 'DISABLED'] as const;
export const SYNC_MODES = ['PULL_SYNC', 'PUSH_SYNC'] as const;
export const FAILURE_CATEGORIES = [
  'AUTHENTICATION',
  'CONFIGURATION',
  'NETWORK',
  'TIMEOUT',
  'RATE_LIMIT',
  'PROVIDER_REJECTED',
  'SIGNATURE',
  'SCHEMA',
  'UNKNOWN',
] as const;

/**
 * Human labels for the category enum.
 *
 * Deliberately the words an operator actually uses. A column reading "PAYMENT_GATEWAY" tells them
 * nothing about where it appears in their product; "Payments" does.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  PAYMENT_GATEWAY: 'Payments',
  ACCOUNTING: 'Accounting',
  LMS: 'Learning management',
  BIOMETRIC: 'Biometric devices',
  RFID: 'RFID',
  IDENTITY_PROVIDER: 'Identity / SSO',
  DOCUMENT_SERVICE: 'Documents & e-sign',
  SMS: 'SMS',
  WHATSAPP: 'WhatsApp',
  EMAIL: 'Email',
};

const CATEGORY_COLORS: Record<string, string> = {
  PAYMENT_GATEWAY: '#15803d',
  ACCOUNTING: '#7c3aed',
  LMS: '#2563eb',
  BIOMETRIC: '#db2777',
  RFID: '#0891b2',
  IDENTITY_PROVIDER: '#b45309',
  DOCUMENT_SERVICE: '#4f46e5',
  SMS: '#9333ea',
  WHATSAPP: '#16a34a',
  EMAIL: '#0f766e',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: '#6b7280',
  ACTIVE: '#15803d',
  DISABLED: '#b91c1c',
  UNKNOWN: '#6b7280',
  HEALTHY: '#15803d',
  DEGRADED: '#f59e0b',
  UNHEALTHY: '#b91c1c',
  PENDING: '#6b7280',
  QUEUED: '#2563eb',
  IN_PROGRESS: '#f59e0b',
  RUNNING: '#f59e0b',
  PROCESSING: '#f59e0b',
  SUCCEEDED: '#15803d',
  PROCESSED: '#15803d',
  RECEIVED: '#2563eb',
  IGNORED: '#6b7280',
  PARTIAL: '#f59e0b',
  SKIPPED: '#6b7280',
  FAILED: '#b91c1c',
  CANCELED: '#6b7280',
};

const FAILURE_COLORS: Record<string, string> = {
  AUTHENTICATION: '#b91c1c',
  CONFIGURATION: '#b91c1c',
  NETWORK: '#f59e0b',
  TIMEOUT: '#f59e0b',
  RATE_LIMIT: '#f59e0b',
  PROVIDER_REJECTED: '#db2777',
  SIGNATURE: '#7c3aed',
  SCHEMA: '#db2777',
  UNKNOWN: '#6b7280',
};

/** Shared badge so status colouring is defined once rather than re-derived per table. */
export function Badge({ value, colors }: { value: string; colors?: Record<string, string> }) {
  return (
    <span style={{ color: colors?.[value] ?? '#374151', fontWeight: 600, whiteSpace: 'nowrap' }}>
      {value.replace(/_/g, ' ')}
    </span>
  );
}

export const CategoryBadge = ({ value }: { value: string }) => (
  <Badge value={CATEGORY_LABELS[value] ?? value} colors={Object.fromEntries(
    Object.entries(CATEGORY_LABELS).map(([k, v]) => [v, CATEGORY_COLORS[k] ?? '#374151']),
  )} />
);

export const StatusBadge = ({ value }: { value: string }) => <Badge value={value} colors={STATUS_COLORS} />;
export const FailureBadge = ({ value }: { value: string }) => <Badge value={value} colors={FAILURE_COLORS} />;

const th: React.CSSProperties = { padding: 8, textAlign: 'left' };
const td: React.CSSProperties = { padding: 8, verticalAlign: 'top' };

export function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
            {head.map((h) => (
              <th key={h} style={th}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export const Th = ({ children }: { children: React.ReactNode }) => <th style={th}>{children}</th>;

/**
 * Table cell.
 *
 * `style` is accepted and merged last so a caller can widen a column or colour an error without a
 * second presentation primitive. `colSpan` switches the cell to the shared empty-state treatment,
 * which is why the two are combined here rather than left to each call site.
 */
export function Td({
  children,
  colSpan,
  style,
}: {
  children: React.ReactNode;
  colSpan?: number;
  style?: React.CSSProperties;
}) {
  return (
    <td
      style={{
        ...td,
        ...(colSpan ? { textAlign: 'center', color: '#6b7280', padding: 20 } : {}),
        ...style,
      }}
      colSpan={colSpan}
    >
      {children}
    </td>
  );
}

/**
 * Empty state that explains WHY it is empty, not just that it is.
 *
 * "No results" on a fresh tenant is the common case here, and a bare message would read as breakage.
 */
export function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div style={{ padding: '1.5rem', textAlign: 'center', color: '#6b7280', fontSize: '0.9rem' }}>
      <div style={{ fontWeight: 600 }}>{message}</div>
      {hint ? <div style={{ marginTop: 4, fontSize: '0.8rem' }}>{hint}</div> : null}
    </div>
  );
}

export function StatGrid({ cards }: { cards: { label: string; value: string; color?: string }[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
      {cards.map((c) => (
        <div key={c.label} style={{ padding: '0.75rem 1rem', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>{c.label}</div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: c.color ?? '#111827' }}>{c.value}</div>
        </div>
      ))}
    </div>
  );
}

export function ErrorBanner({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <div
      style={{
        padding: '0.6rem 0.8rem',
        background: '#fef2f2',
        border: '1px solid #fecaca',
        borderRadius: 6,
        color: '#b91c1c',
        fontSize: '0.85rem',
        marginBottom: '0.75rem',
      }}
    >
      {error}
    </div>
  );
}

/** Renders a JSON value compactly for the log tables. Anything redacted upstream stays redacted. */
export function JsonPreview({ value, empty = '—' }: { value: unknown; empty?: string }) {
  if (value === null || value === undefined) return <span style={{ color: '#9ca3af' }}>{empty}</span>;
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) return <span style={{ color: '#9ca3af' }}>{empty}</span>;
  return (
    <code style={{ fontSize: '0.75rem', wordBreak: 'break-all', color: '#374151' }}>
      {text.length > 300 ? `${text.slice(0, 300)}…` : text}
    </code>
  );
}