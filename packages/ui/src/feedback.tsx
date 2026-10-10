import React from 'react';
import { cx } from './theme';

/** Inline or block loading spinner. */
export function Spinner({ size = 'md', className }: { size?: 'md' | 'lg'; className?: string }) {
  return <span className={cx('ui-spinner', size === 'lg' && 'ui-spinner--lg', className)} role="status" aria-label="Loading" />;
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius,
  className,
  style,
}: {
  width?: number | string;
  height?: number | string;
  radius?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx('ui-skeleton', className)}
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/** A block of skeleton lines, e.g. for a loading card or details panel. */
export function SkeletonText({ lines = 3, gap = 8 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }} aria-hidden="true">
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton key={index} height={12} width={index === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export interface EmptyStateProps {
  title?: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
}

/** Neutral "nothing here yet" placeholder. */
export function EmptyState({ title = 'Nothing to show', description, icon = '📭', action }: EmptyStateProps) {
  return (
    <div className="ui-state" role="status">
      <span className="ui-state__icon" aria-hidden="true">{icon}</span>
      <p className="ui-state__title">{title}</p>
      {description && <p className="ui-state__desc">{description}</p>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: React.ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}

/** Error placeholder with an optional retry affordance. */
export function ErrorState({ title = 'Something went wrong', description, onRetry, retryLabel = 'Try again' }: ErrorStateProps) {
  return (
    <div className="ui-state ui-state--error" role="alert">
      <span className="ui-state__icon" aria-hidden="true">⚠️</span>
      <p className="ui-state__title">{title}</p>
      {description && <p className="ui-state__desc">{description}</p>}
      {onRetry && (
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" style={{ marginTop: 8 }} onClick={onRetry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

export interface StatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  /** Optional leading icon/tone accent. */
  icon?: React.ReactNode;
}

/** Compact KPI tile for dashboards. */
export function StatCard({ label, value, hint, icon }: StatCardProps) {
  return (
    <div className="ui-card">
      <div className="ui-card__body" style={{ padding: 16 }}>
        <div className="ui-stat">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span className="ui-stat__label">{label}</span>
            {icon && <span aria-hidden="true" style={{ color: 'var(--ui-color-text-subtle)' }}>{icon}</span>}
          </div>
          <span className="ui-stat__value">{value}</span>
          {hint && <span className="ui-stat__hint">{hint}</span>}
        </div>
      </div>
    </div>
  );
}
