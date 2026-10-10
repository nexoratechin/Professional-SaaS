import React, { useEffect, useRef } from 'react';
import { cx } from './theme';
import { EmptyState, ErrorState, Skeleton } from './feedback';

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Plain-text column name — used for the mobile stacked label and sort accessibility. */
  label?: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  align?: 'left' | 'right' | 'center';
  width?: number | string;
  cellClassName?: string;
}

export interface SortState {
  key: string;
  dir: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  /** `null` renders the loading skeleton; an empty array renders the empty state. */
  rows: T[] | null;
  rowKey: (row: T) => string;
  error?: string | null;
  onRetry?: () => void;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onSelectedIdsChange?: (ids: Set<string>) => void;
  onRowClick?: (row: T) => void;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  empty?: React.ReactNode;
  loadingRows?: number;
  /** Stack rows into labelled cards on narrow screens (default true). */
  responsive?: boolean;
  /** Accessible caption for the table. */
  caption?: string;
}

function alignClass(align?: 'left' | 'right' | 'center'): string | undefined {
  if (align === 'right') return 'ui-table__num';
  if (align === 'center') return 'ui-table__center';
  return undefined;
}

/**
 * Design-system data table: optional row selection with a select-all control, sortable headers,
 * automatic loading skeletons, empty/error states, and mobile card stacking. Presentational only —
 * the owning page keeps fetching/pagination/sorting semantics.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  error,
  onRetry,
  selectable = false,
  selectedIds,
  onSelectedIdsChange,
  onRowClick,
  sort,
  onSortChange,
  empty,
  loadingRows = 6,
  responsive = true,
  caption,
}: DataTableProps<T>) {
  const headerCheckbox = useRef<HTMLInputElement | null>(null);
  const loading = rows === null;
  const current: T[] = rows ?? [];
  const selection = selectedIds ?? new Set<string>();
  const pageIds = current.map(rowKey);
  const allSelected = pageIds.length > 0 && pageIds.every((id) => selection.has(id));
  const someSelected = pageIds.some((id) => selection.has(id)) && !allSelected;

  useEffect(() => {
    if (headerCheckbox.current) headerCheckbox.current.indeterminate = someSelected;
  }, [someSelected]);

  const toggleAll = () => {
    if (!onSelectedIdsChange) return;
    const next = new Set(selection);
    if (allSelected) pageIds.forEach((id) => next.delete(id));
    else pageIds.forEach((id) => next.add(id));
    onSelectedIdsChange(next);
  };

  const toggleOne = (id: string) => {
    if (!onSelectedIdsChange) return;
    const next = new Set(selection);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(next);
  };

  const handleSort = (column: Column<T>) => {
    if (!column.sortable || !onSortChange) return;
    const dir: SortState['dir'] = sort?.key === column.key && sort.dir === 'asc' ? 'desc' : 'asc';
    onSortChange({ key: column.key, dir });
  };

  if (error && !loading) {
    return (
      <div className="ui-table-wrap">
        <ErrorState description={error} onRetry={onRetry} />
      </div>
    );
  }

  if (!loading && current.length === 0) {
    return (
      <div className="ui-table-wrap">
        {empty ?? <EmptyState title="No records" description="Nothing matches the current filters." />}
      </div>
    );
  }

  return (
    <div className="ui-table-wrap">
      <table className={cx('ui-table', responsive && 'ui-table--responsive')}>
        {caption && <caption className="ui-sr-only">{caption}</caption>}
        <thead>
          <tr>
            {selectable && (
              <th style={{ width: 40 }}>
                <input
                  ref={headerCheckbox}
                  type="checkbox"
                  aria-label="Select all rows on this page"
                  checked={allSelected}
                  onChange={toggleAll}
                />
              </th>
            )}
            {columns.map((column) => {
              const isSorted = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  style={{ width: column.width, textAlign: column.align ?? 'left' }}
                  aria-sort={isSorted ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sortable && onSortChange ? (
                    <span
                      className="ui-table__sort"
                      role="button"
                      tabIndex={0}
                      onClick={() => handleSort(column)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          handleSort(column);
                        }
                      }}
                    >
                      {column.header}
                      <span className="ui-table__sort-ind" aria-hidden="true">
                        {isSorted ? (sort?.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </span>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: loadingRows }).map((_, rowIndex) => (
              <tr key={`skeleton-${rowIndex}`}>
                {selectable && <td><Skeleton width={16} height={16} radius={4} /></td>}
                {columns.map((column) => (
                  <td key={column.key}>
                    <Skeleton height={12} width={rowIndex % 2 === 0 ? '70%' : '50%'} />
                  </td>
                ))}
              </tr>
            ))}

          {!loading &&
            current.map((row) => {
              const id = rowKey(row);
              const selected = selection.has(id);
              return (
                <tr
                  key={id}
                  data-clickable={onRowClick ? 'true' : undefined}
                  data-selected={selected ? 'true' : undefined}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {selectable && (
                    <td onClick={(event) => event.stopPropagation()}>
                      <input type="checkbox" aria-label="Select row" checked={selected} onChange={() => toggleOne(id)} />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      data-label={column.label ?? (typeof column.header === 'string' ? column.header : column.key)}
                      className={cx(alignClass(column.align), column.cellClassName)}
                      style={{ textAlign: column.align ?? 'left' }}
                    >
                      {column.render ? column.render(row) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

/** Toolbar wrapper: search grows, filters and actions sit alongside/below. */
export function TableToolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('ui-toolbar', className)}>{children}</div>;
}

/** Selection action bar shown above a table when rows are selected. */
export function BulkActionBar({ count, children, onClear }: { count: number; children?: React.ReactNode; onClear?: () => void }) {
  if (count === 0) return null;
  return (
    <div className="ui-bulkbar" role="region" aria-label="Bulk actions">
      <strong>{count}</strong> selected
      {onClear && (
        <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={onClear}>
          Clear
        </button>
      )}
      <span className="ui-toolbar__spacer" />
      {children}
    </div>
  );
}
