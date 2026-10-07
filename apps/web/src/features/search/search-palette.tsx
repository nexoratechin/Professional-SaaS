import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type {
  GlobalSearchEntityType,
  GlobalSearchResponseDto,
  GlobalSearchResultItemDto,
  GlobalSearchSuggestionDto,
  RecentSearchDto,
} from '@college-erp/types';
import { useAuth } from '../auth/auth-context';
import { clearRecentSearches, fetchRecentSearches, searchAll, suggestSearch } from './search-api';

const SEARCH_PERMISSION = 'search.view';
/** Fired by the dashboard trigger (and anywhere else) to open the palette without the keyboard. */
export const OPEN_GLOBAL_SEARCH_EVENT = 'college-erp:open-search';

const DEBOUNCE_MS = 220;

/** Group headings. Display-only mirror of search-registry.ts's labels. */
const TYPE_LABELS: Record<GlobalSearchEntityType, string> = {
  student: 'Students',
  faculty: 'Faculty & Staff',
  application: 'Applications',
  course: 'Courses',
  invoice: 'Fee Invoices',
  payment: 'Payments',
  exam: 'Exams',
  result: 'Results',
  certificate: 'Certificates',
  ticket: 'Helpdesk Tickets',
  document: 'Documents',
};

interface ActionRow {
  id: string;
  label: string;
  sublabel?: string | null;
  badge?: string;
  /** Navigate here on activate. */
  href?: string;
  /** Fill the input with this instead of navigating (recent searches / query completions). */
  query?: string;
}

interface Section {
  title: string;
  rows: ActionRow[];
}

export function openGlobalSearch(): void {
  window.dispatchEvent(new CustomEvent(OPEN_GLOBAL_SEARCH_EVENT));
}

function toRecentRow(recent: RecentSearchDto): ActionRow {
  return {
    id: `recent:${recent.id}`,
    label: recent.query,
    sublabel: recent.resultCount > 0 ? `${recent.resultCount} result${recent.resultCount === 1 ? '' : 's'}` : 'No results',
    query: recent.query,
  };
}

function toSuggestionRow(suggestion: GlobalSearchSuggestionDto): ActionRow {
  return {
    id: suggestion.id,
    label: suggestion.text,
    sublabel: suggestion.kind === 'query' ? 'Recent search' : 'Record',
    badge: suggestion.type ? TYPE_LABELS[suggestion.type] : undefined,
    href: suggestion.kind === 'record' ? suggestion.href : undefined,
    query: suggestion.kind === 'query' ? suggestion.text : undefined,
  };
}

function toResultRow(item: GlobalSearchResultItemDto): ActionRow {
  return {
    id: `result:${item.type}:${item.id}`,
    label: item.title,
    sublabel: [item.subtitle, item.description].filter(Boolean).join(' · ') || null,
    badge: item.meta.status ?? TYPE_LABELS[item.type],
    href: item.href,
  };
}

/**
 * Ctrl/Cmd+K command palette. Rendered once per authenticated tenant session (App.tsx); it is
 * inert unless the caller holds `search.view`. It only renders what the API returns — every row
 * has already passed the owning module's permission and row-scope check server-side.
 */
export function GlobalSearchPalette() {
  const { status, permissions, tenantSlug } = useAuth();
  const navigate = useNavigate();
  const enabled = status === 'authenticated' && permissions.includes(SEARCH_PERMISSION);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState<RecentSearchDto[]>([]);
  const [results, setResults] = useState<GlobalSearchResponseDto | null>(null);
  const [suggestions, setSuggestions] = useState<GlobalSearchSuggestionDto[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestSeq = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setResults(null);
    setSuggestions([]);
  }, []);

  // Open on Ctrl/Cmd+K, and on the programmatic event the dashboard button fires.
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener(OPEN_GLOBAL_SEARCH_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener(OPEN_GLOBAL_SEARCH_EVENT, onOpen);
    };
  }, [enabled]);

  // On open: focus the input and refresh the recent-search list.
  useEffect(() => {
    if (!open) return;
    setActiveIndex(0);
    inputRef.current?.focus();
    fetchRecentSearches(tenantSlug)
      .then((response) => setRecent(response.data))
      .catch(() => setRecent([]));
  }, [open, tenantSlug]);

  // Debounced fetch: 1 char → suggestions only; 2+ → suggestions + full (grouped) search.
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults(null);
      setSuggestions([]);
      return;
    }

    const seq = ++requestSeq.current;
    const timer = setTimeout(async () => {
      try {
        if (trimmed.length >= 2) {
          const [searchResponse, suggestResponse] = await Promise.all([
            searchAll({ q: trimmed, tenantSlug }),
            suggestSearch({ q: trimmed, tenantSlug }),
          ]);
          if (seq !== requestSeq.current) return;
          setResults(searchResponse);
          setSuggestions(suggestResponse.suggestions);
        } else {
          const suggestResponse = await suggestSearch({ q: trimmed, tenantSlug });
          if (seq !== requestSeq.current) return;
          setResults(null);
          setSuggestions(suggestResponse.suggestions);
        }
      } catch {
        if (seq !== requestSeq.current) return;
        setResults(null);
        setSuggestions([]);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, open, tenantSlug]);

  const sections = useMemo<Section[]>(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return recent.length > 0 ? [{ title: 'Recent searches', rows: recent.map(toRecentRow) }] : [];
    }

    const out: Section[] = [];
    const querySuggestions = suggestions.filter((suggestion) => suggestion.kind === 'query');
    if (querySuggestions.length > 0) {
      out.push({ title: 'Suggestions', rows: querySuggestions.map(toSuggestionRow) });
    }

    if (results && results.results.length > 0) {
      const byType = new Map<GlobalSearchEntityType, GlobalSearchResultItemDto[]>();
      for (const item of results.results) {
        const bucket = byType.get(item.type);
        if (bucket) bucket.push(item);
        else byType.set(item.type, [item]);
      }
      for (const [type, items] of byType) {
        out.push({ title: TYPE_LABELS[type], rows: items.map(toResultRow) });
      }
    }

    // Below the 2-character minimum there are no grouped results yet — surface the record
    // suggestions the API did return so the palette is never blank while typing.
    if (out.length === 0 && suggestions.length > 0) {
      out.push({ title: 'Suggestions', rows: suggestions.map(toSuggestionRow) });
    }

    return out;
  }, [query, recent, results, suggestions]);

  const actionable = useMemo<ActionRow[]>(() => sections.flatMap((section) => section.rows), [sections]);
  const indexById = useMemo(() => {
    const map = new Map<string, number>();
    actionable.forEach((row, index) => map.set(row.id, index));
    return map;
  }, [actionable]);

  useEffect(() => {
    setActiveIndex((prev) => (actionable.length === 0 ? 0 : Math.min(prev, actionable.length - 1)));
  }, [actionable.length]);

  useEffect(() => {
    document.getElementById(`global-search-row-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  const activate = useCallback(
    (row: ActionRow | undefined) => {
      if (!row) return;
      if (row.query) {
        setQuery(row.query);
        setActiveIndex(0);
        inputRef.current?.focus();
        return;
      }
      if (row.href) {
        close();
        navigate(row.href);
      }
    },
    [close, navigate],
  );

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (actionable.length === 0 ? 0 : Math.min(prev + 1, actionable.length - 1)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      activate(actionable[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const handleClearRecent = async () => {
    try {
      await clearRecentSearches(tenantSlug);
      setRecent([]);
    } catch {
      // Non-fatal: keep the list; the next open will re-fetch.
    }
  };

  if (!enabled) return null;

  const trimmed = query.trim();
  const showEmpty = trimmed.length >= 2 && results !== null && results.total === 0;

  return (
    <>
      {open && (
        <div
          role="presentation"
          onMouseDown={close}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.55)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '10vh',
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Global search"
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              width: 'min(640px, 92vw)',
              background: '#ffffff',
              borderRadius: 12,
              boxShadow: '0 20px 60px rgba(15, 23, 42, 0.35)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '70vh',
            }}
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onInputKeyDown}
              placeholder="Search students, faculty, courses, invoices…"
              aria-label="Search query"
              style={{
                border: 'none',
                borderBottom: '1px solid #e5e7eb',
                padding: '14px 16px',
                fontSize: '1rem',
                outline: 'none',
              }}
            />

            <div style={{ overflowY: 'auto', padding: '6px 0' }}>
              {sections.map((section) => (
                <div key={section.title}>
                  <div
                    style={{
                      padding: '8px 16px 4px',
                      fontSize: '0.7rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      color: '#6b7280',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <span>{section.title}</span>
                    {section.title === 'Recent searches' && (
                      <button
                        type="button"
                        onClick={handleClearRecent}
                        style={{ border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '0.7rem' }}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {section.rows.map((row) => {
                    const index = indexById.get(row.id) ?? -1;
                    const active = index === activeIndex;
                    return (
                      <div
                        key={row.id}
                        id={`global-search-row-${index}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          activate(row);
                        }}
                        style={{
                          padding: '8px 16px',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          gap: 12,
                          alignItems: 'baseline',
                          background: active ? '#eff6ff' : 'transparent',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {row.label}
                          </div>
                          {row.sublabel && (
                            <div style={{ color: '#6b7280', fontSize: '0.78rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {row.sublabel}
                            </div>
                          )}
                        </div>
                        {row.badge && (
                          <span style={{ color: '#6b7280', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{row.badge}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}

              {trimmed.length === 0 && recent.length === 0 && (
                <p style={{ padding: '12px 16px', color: '#6b7280', fontSize: '0.85rem' }}>
                  Type at least two characters to search.
                </p>
              )}
              {showEmpty && (
                <p style={{ padding: '12px 16px', color: '#6b7280', fontSize: '0.85rem' }}>
                  No matches for “{trimmed}”.
                </p>
              )}
            </div>

            <div
              style={{
                borderTop: '1px solid #e5e7eb',
                padding: '8px 16px',
                display: 'flex',
                justifyContent: 'space-between',
                color: '#6b7280',
                fontSize: '0.72rem',
              }}
            >
              <span>↑↓ navigate · ↵ open · esc close</span>
              {results && <span>{results.total} result{results.total === 1 ? '' : 's'} · {results.tookMs} ms</span>}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
