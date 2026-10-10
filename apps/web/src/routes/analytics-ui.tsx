/**
 * Presentational building blocks shared by the two analytics dashboards — the tenant
 * `/analytics` page and the platform `/platform/analytics` page.
 *
 * Both render the same three things from the same contracts in `@college-erp/types`: a window +
 * freshness caption, KPI tiles, and bar charts off `AnalyticsSeriesDto.points`. The formatting and
 * the null handling live here once so the two dashboards cannot drift apart on either.
 *
 * Two rules this file exists to enforce in both places:
 *
 *  1. A `null` point is drawn as a **gap**, never as a zero-height bar. `AnalyticsSeriesPointDto
 *     .value` is null when the API could source that bucket from neither the materialized snapshot
 *     nor its bounded live fallback. Rendering that as 0 would turn "we don't know" into "attendance
 *     collapsed to nothing" — and a zero on a dashboard is a number people act on.
 *  2. Every surface states *when* its numbers were computed. `meta.source` / `meta.computedAt` are
 *     rendered verbatim instead of a generic "updated just now", because these figures come from a
 *     materialized rollup and a reader deciding whether to trust them needs to know which.
 */

import React, { useMemo } from 'react';
import type {
  AnalyticsMetaDto,
  AnalyticsSeriesDto,
  AnalyticsUnitDto,
  AnalyticsWindowDto,
} from '@college-erp/types';
import { Card } from '@college-erp/ui';

export type AnalyticsGranularity = AnalyticsWindowDto['granularity'];

/**
 * Bucket counts offered per granularity. A trailing-window dashboard only ever wants to be asked
 * for a handful of these, and every one of them is a whole number of buckets. The API clamps to
 * `MAX_ANALYTICS_PERIODS` regardless; this list is the UI's opinion about what is worth plotting.
 */
export const PERIOD_OPTIONS: Record<AnalyticsGranularity, number[]> = {
  DAILY: [7, 14, 30, 60, 90],
  MONTHLY: [3, 6, 12, 24, 36],
};

const selectStyle: React.CSSProperties = {
  padding: '0.45rem',
  borderRadius: 6,
  border: '1px solid #d1d5db',
  background: '#fff',
  minWidth: 120,
};

const checkboxLabel: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: '0.85rem',
  color: '#374151',
};

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

const currency = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

const plainNumber = new Intl.NumberFormat('en-IN');

export function formatCents(cents: number | null | undefined, code = 'INR'): string {
  if (cents === null || cents === undefined) return '—';
  if (code !== 'INR') {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: code, maximumFractionDigits: 0 }).format(cents / 100);
  }
  return currency.format(cents / 100);
}

/** Indian short scale (lakh / crore) for tight spaces like table cells and chart tooltips. */
export function formatCompactCents(cents: number): string {
  const rupees = cents / 100;
  const abs = Math.abs(rupees);
  if (abs >= 1_00_00_000) return `₹${(rupees / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `₹${(rupees / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `₹${(rupees / 1_000).toFixed(1)}k`;
  return `₹${rupees.toFixed(0)}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return `${value.toFixed(1)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return plainNumber.format(value);
}

/** Renders one plotted value in its declared unit. `null` becomes an em dash, never "0". */
export function formatMetricValue(value: number | null, unit: AnalyticsUnitDto): string {
  if (value === null) return '—';
  if (unit === 'CURRENCY_CENTS') return formatCompactCents(value);
  if (unit === 'PERCENT') return `${value.toFixed(1)}%`;
  return plainNumber.format(value);
}

// ---------------------------------------------------------------------------
// Window caption + controls
// ---------------------------------------------------------------------------

export function formatBucketCaption(window: AnalyticsWindowDto): string {
  const noun = window.granularity === 'MONTHLY' ? 'monthly' : 'daily';
  const from = new Date(window.from).toISOString().slice(0, 10);
  const to = new Date(window.to).toISOString().slice(0, 10);
  const buckets = `${window.periodCount} ${noun} bucket${window.periodCount === 1 ? '' : 's'}`;
  return `${from} → ${to} (${buckets}, last bucket ending ${to})`;
}

/**
 * The "as of" line. Everything a reader needs to judge the numbers above it:
 * which buckets are covered, whether they came from the materialized rollup or were computed for
 * this request, which buckets were stitched from the live fallback, and which are simply missing.
 */
export function FreshnessNote({ window, meta }: { window: AnalyticsWindowDto; meta: AnalyticsMetaDto }): React.ReactElement {
  const lines: string[] = [formatBucketCaption(window)];

  if (meta.source === 'SNAPSHOT') {
    lines.push(
      meta.computedAt
        ? `served from the materialized rollup computed ${new Date(meta.computedAt).toLocaleString()}`
        : 'served from the materialized rollup (computation time unknown)',
    );
  } else {
    lines.push('computed live for this request');
  }

  if (window.includesInProgressPeriod) {
    lines.push('⚠ the newest bucket is still running, so its figures are partial');
  }
  if (meta.liveComputedKeys.length > 0) {
    lines.push(
      `${meta.liveComputedKeys.length} bucket(s) had no materialized row and were recomputed live: ${meta.liveComputedKeys.join(', ')}`,
    );
  }
  if (meta.unavailableKeys.length > 0) {
    lines.push(
      `${meta.unavailableKeys.length} bucket(s) could not be sourced at all and are drawn as gaps, not zeros: ${meta.unavailableKeys.join(', ')}`,
    );
  }

  return (
    <div style={{ fontSize: '0.78rem', color: '#6b7280', lineHeight: 1.6 }}>
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}

export interface AnalyticsWindowSelection {
  granularity: AnalyticsGranularity;
  periods: number;
  live: boolean;
  includeCurrent: boolean;
}

export function buildAnalyticsQuery(selection: AnalyticsWindowSelection): string {
  const query = new URLSearchParams();
  query.set('granularity', selection.granularity);
  query.set('periods', String(selection.periods));
  if (selection.live) query.set('live', 'true');
  if (selection.includeCurrent) query.set('includeCurrent', 'true');
  return query.toString();
}

export function WindowControls({
  selection,
  onChange,
  busy,
  onRefresh,
  refreshing,
}: {
  selection: AnalyticsWindowSelection;
  onChange: (next: AnalyticsWindowSelection) => void;
  busy: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}): React.ReactElement {
  const options = PERIOD_OPTIONS[selection.granularity];
  // The option list is per-granularity, so a bucket count valid for one may not exist in the other.
  // Fall back to the default rather than leaving a <select> showing nothing.
  const periods = options.includes(selection.periods) ? selection.periods : (options[0] ?? 30);

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <label style={{ ...checkboxLabel, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <span>Bucket</span>
        <select
          value={selection.granularity}
          style={selectStyle}
          onChange={(e) => {
            const granularity = e.target.value as AnalyticsGranularity;
            const next = PERIOD_OPTIONS[granularity];
            onChange({
              ...selection,
              granularity,
              periods: next.includes(periods) ? periods : (next[0] ?? periods),
            });
          }}
        >
          <option value="DAILY">Daily</option>
          <option value="MONTHLY">Monthly</option>
        </select>
      </label>

      <label style={{ ...checkboxLabel, flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
        <span>Buckets</span>
        <select
          value={periods}
          style={selectStyle}
          onChange={(e) => onChange({ ...selection, periods: Number(e.target.value) })}
        >
          {options.map((count) => (
            <option key={count} value={count}>
              Last {count}
            </option>
          ))}
        </select>
      </label>

      <label style={checkboxLabel}>
        <input
          type="checkbox"
          checked={selection.includeCurrent}
          onChange={(e) => onChange({ ...selection, includeCurrent: e.target.checked })}
        />
        Include the running bucket
      </label>

      <label style={checkboxLabel} title="Bypass the materialized snapshot and recompute on the server. Slower; use after correcting a record.">
        <input type="checkbox" checked={selection.live} onChange={(e) => onChange({ ...selection, live: e.target.checked })} />
        Live recompute
      </label>

      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy || refreshing}
          style={{
            padding: '0.5rem 1rem',
            borderRadius: 6,
            border: '1px solid #1d4ed8',
            background: '#fff',
            color: '#1d4ed8',
            fontSize: '0.9rem',
            cursor: busy || refreshing ? 'not-allowed' : 'pointer',
            opacity: busy || refreshing ? 0.6 : 1,
          }}
        >
          {refreshing ? 'Queueing…' : 'Queue refresh'}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI tiles
// ---------------------------------------------------------------------------

export type TileTone = 'default' | 'good' | 'warn' | 'bad';

const TONE_COLORS: Record<TileTone, string> = {
  default: '#111827',
  good: '#15803d',
  warn: '#b45309',
  bad: '#b91c1c',
};

export function MetricTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: TileTone;
}): React.ReactElement {
  return (
    <Card style={{ padding: '0.85rem 1rem' }}>
      <div style={{ fontSize: '0.75rem', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 600, color: TONE_COLORS[tone] }}>{value}</div>
      {hint && <div style={{ fontSize: '0.72rem', color: '#9ca3af' }}>{hint}</div>}
    </Card>
  );
}

export function TileGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>{children}</div>;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

const PLOT_HEIGHT = 120;

const SERIES_COLORS = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#0ea5e9', '#ef4444', '#14b8a6', '#a855f7'];

/**
 * Bar chart for one series.
 *
 * Negative values are real (`netNewMrr` goes below zero in a contraction month), so the plot area is
 * scaled to `[min(0, lowest), ceiling]` with a visible zero rule rather than being normalized to
 * the data's own minimum — a chart whose bars all point up regardless of sign is a lie about the
 * one series where the sign is the whole point.
 *
 * Percentage series are pinned to a 100 ceiling so two charts of different magnitude are visually
 * comparable and a 4% attendance rate does not render as a full-height bar.
 */
export function SeriesChart({ series, color }: { series: AnalyticsSeriesDto; color?: string }): React.ReactElement {
  // Derived once per series rather than on every render — the parent dashboards re-render on
  // window/filter changes far more often than the series data itself changes.
  const { dataMax, gapCount, step, lastIndex, zeroPercent, floor, span } = useMemo(() => {
    const present = series.points
      .map((point) => point.value)
      .filter((value): value is number => value !== null);
    const max = present.length > 0 ? Math.max(...present) : 0;
    const min = present.length > 0 ? Math.min(...present) : 0;
    const spanLocal = (series.unit === 'PERCENT' ? Math.max(100, max) : Math.max(max, 0)) - Math.min(0, min) || 1;
    const floorLocal = Math.min(0, min);
    return {
      dataMax: max,
      gapCount: series.points.length - present.length,
      step: Math.max(1, Math.ceil(series.points.length / 8)),
      lastIndex: series.points.length - 1,
      zeroPercent: ((0 - floorLocal) / spanLocal) * 100,
      floor: floorLocal,
      span: spanLocal,
    };
  }, [series]);
  const barColor = color ?? SERIES_COLORS[0];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <strong style={{ fontSize: '0.85rem' }}>{series.label}</strong>
        <span style={{ fontSize: '0.72rem', color: '#9ca3af' }}>
          peak {formatMetricValue(dataMax === 0 ? null : dataMax, series.unit)}
          {gapCount > 0 ? ` · ${gapCount} gap${gapCount === 1 ? '' : 's'}` : ''}
        </span>
      </div>

      <div style={{ position: 'relative', height: PLOT_HEIGHT, display: 'flex', alignItems: 'stretch', gap: 2, overflowX: 'auto' }}>
        {series.points.map((point) => {
          if (point.value === null) {
            // Rendered as an empty slot with an explicit tooltip. Deliberately NOT a zero-height bar.
            return (
              <div
                key={point.key}
                style={{ flex: '0 0 16px' }}
                title={`${point.label}: no data available (not zero)`}
              />
            );
          }
          const ratio = (point.value - floor) / span;
          const size = Math.max(1.5, Math.abs(ratio) * 100);
          return (
            <div key={point.key} style={{ flex: '0 0 16px', position: 'relative' }} title={`${point.label}: ${formatMetricValue(point.value, series.unit)}`}>
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  background: point.value < 0 ? '#ef4444' : barColor,
                  borderRadius: 2,
                  ...(point.value < 0
                    ? { top: `${zeroPercent}%`, height: `${size}%` }
                    : { bottom: `${100 - zeroPercent}%`, height: `${size}%` }),
                }}
              />
            </div>
          );
        })}
        {floor < 0 && (
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${zeroPercent}%`, borderTop: '1px dashed #9ca3af' }} />
        )}
      </div>

      <div style={{ display: 'flex', gap: 2, marginTop: 4, overflowX: 'auto' }}>
        {series.points.map((point, index) => (
          <div
            key={point.key}
            style={{ flex: '0 0 16px', fontSize: '0.6rem', color: '#9ca3af', whiteSpace: 'nowrap', overflow: 'visible' }}
          >
            {index % step === 0 || index === lastIndex ? point.label : ''}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SeriesGrid({ series }: { series: AnalyticsSeriesDto[] }): React.ReactElement {
  if (series.length === 0) {
    return <p style={{ color: '#9ca3af' }}>No series in this window.</p>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
      {series.map((entry, index) => (
        <SeriesChart key={entry.metric} series={entry} color={SERIES_COLORS[index % SERIES_COLORS.length]} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distributions
// ---------------------------------------------------------------------------

/**
 * A `Record<string, number>` status distribution.
 *
 * Rendered as proportional bars rather than a table of bare numbers, because a table gives no sense
 * of proportion and the question a reader actually has of a status histogram is "how much of this is
 * which bucket".
 */
export function StatusBreakdown({ title, rows, total }: { title: string; rows: Record<string, number>; total?: number }): React.ReactElement {
  const { entries, sum } = useMemo(() => {
    const filtered = Object.entries(rows).filter(([, count]) => count > 0);
    return { entries: filtered, sum: total ?? filtered.reduce((acc, [, count]) => acc + count, 0) };
  }, [rows, total]);

  return (
    <div>
      <div style={{ fontSize: '0.8rem', color: '#374151', marginBottom: 6, fontWeight: 600 }}>{title}</div>
      {entries.length === 0 ? (
        <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: 0 }}>No data in this window.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[...entries]
            .sort((left, right) => right[1] - left[1])
            .map(([status, count]) => (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
                <span style={{ width: 150, color: '#374151' }}>{status}</span>
                <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 10 }}>
                  <div
                    style={{
                      width: `${sum > 0 ? Math.max(1, (count / sum) * 100) : 0}%`,
                      height: 10,
                      borderRadius: 4,
                      background: '#2563eb',
                    }}
                  />
                </div>
                <span style={{ width: 70, textAlign: 'right' }}>{formatCount(count)}</span>
                <span style={{ width: 46, textAlign: 'right', color: '#6b7280' }}>
                  {sum > 0 ? `${((count / sum) * 100).toFixed(0)}%` : '—'}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal funnel bar list. `percentOfTop` is supplied by the API relative to the first stage. */
export function FunnelBars({ stages }: { stages: Array<{ stage: string; count: number; percentOfTop: number }> }): React.ReactElement {
  if (stages.length === 0) {
    return <p style={{ fontSize: '0.8rem', color: '#9ca3af', margin: 0 }}>No applications in this window.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {stages.map((stage) => (
        <div key={stage.stage} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.78rem' }}>
          <span style={{ width: 150, color: '#374151' }}>{stage.stage}</span>
          <div style={{ flex: 1, background: '#e5e7eb', borderRadius: 4, height: 10 }}>
            <div
              style={{
                width: `${Math.max(1, Math.min(100, stage.percentOfTop))}%`,
                height: 10,
                borderRadius: 4,
                background: '#10b981',
              }}
            />
          </div>
          <span style={{ width: 70, textAlign: 'right' }}>{formatCount(stage.count)}</span>
          <span style={{ width: 46, textAlign: 'right', color: '#6b7280' }}>{stage.percentOfTop.toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

export const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
export const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' };
export const tdStyle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap' };
