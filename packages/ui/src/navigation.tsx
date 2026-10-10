import React from 'react';
import { cx } from './theme';

export interface Crumb {
  label: React.ReactNode;
  to?: string;
}

type LinkRenderer = React.ComponentType<{ to: string; className?: string; children: React.ReactNode }>;

function DefaultLink({ to, className, children }: { to: string; className?: string; children: React.ReactNode }) {
  return (
    <a href={to} className={className}>
      {children}
    </a>
  );
}

/** Accessible breadcrumb trail. Pass `linkComponent` (e.g. react-router's `Link`) for SPA nav. */
export function Breadcrumbs({ items, linkComponent }: { items: Crumb[]; linkComponent?: LinkRenderer }) {
  const Link = linkComponent ?? DefaultLink;
  if (items.length === 0) return null;
  return (
    <nav aria-label="Breadcrumb">
      <ol className="ui-breadcrumbs">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={index}>
              {isLast || !item.to ? (
                <span aria-current={isLast ? 'page' : undefined}>{item.label}</span>
              ) : (
                <Link to={item.to}>{item.label}</Link>
              )}
              {!isLast && <span className="ui-breadcrumbs__sep" aria-hidden="true">/</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/** Standard page title block: optional breadcrumbs, title, description and right-aligned actions. */
export function PageHeader({ title, description, breadcrumbs, actions, className }: PageHeaderProps) {
  return (
    <header className={cx('ui-page-header', className)}>
      {breadcrumbs}
      <div className="ui-page-header__row">
        <div>
          <h1 className="ui-page-header__title">{title}</h1>
          {description && <p className="ui-page-header__desc">{description}</p>}
        </div>
        {actions && <div className="ui-page-header__actions">{actions}</div>}
      </div>
    </header>
  );
}

export interface TabItem {
  key: string;
  label: React.ReactNode;
}

/** Accessible tab strip. Parent owns the active value and the panel content. */
export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[];
  value: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cx('ui-tabs', className)} role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="tab"
          id={`ui-tab-${item.key}`}
          aria-selected={value === item.key}
          className="ui-tab"
          onClick={() => onChange(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export interface PaginationProps {
  skip: number;
  take: number;
  total: number;
  onSkipChange: (skip: number) => void;
  onTakeChange?: (take: number) => void;
  pageSizes?: number[];
  /** Disable navigation while a page is loading. */
  loading?: boolean;
}

/** Range-aware pagination with optional page-size control. */
export function Pagination({ skip, take, total, onSkipChange, onTakeChange, pageSizes = [25, 50, 100], loading }: PaginationProps) {
  const from = total === 0 ? 0 : skip + 1;
  const to = Math.min(skip + take, total);
  const canPrev = skip > 0 && !loading;
  const canNext = skip + take < total && !loading;
  return (
    <div className="ui-pagination">
      <span className="ui-pagination__info">
        Showing <strong>{from}</strong>–<strong>{to}</strong> of <strong>{total}</strong>
      </span>
      <div className="ui-pagination__controls">
        {onTakeChange && (
          <select
            className="ui-select"
            style={{ width: 'auto', minHeight: 32, padding: '4px 28px 4px 10px' }}
            aria-label="Rows per page"
            value={take}
            onChange={(event) => onTakeChange(Number(event.target.value))}
          >
            {pageSizes.map((size) => (
              <option key={size} value={size}>
                {size} / page
              </option>
            ))}
          </select>
        )}
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!canPrev} onClick={() => onSkipChange(Math.max(0, skip - take))}>
          Previous
        </button>
        <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" disabled={!canNext} onClick={() => onSkipChange(skip + take)}>
          Next
        </button>
      </div>
    </div>
  );
}
