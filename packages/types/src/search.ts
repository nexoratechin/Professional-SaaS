/**
 * Global search response-shape contracts between apps/api (modules/global-search) and
 * apps/web (the command-palette feature). Plain data only — no class-validator/NestJS
 * decorators here, so this package stays usable from the frontend.
 *
 * The API is the security boundary: every item below only exists after the caller's
 * permission (and its campus/department/program/OWN scope grants) for the owning module
 * has been checked. The frontend treats these purely as display data.
 */

/** The searchable entity families. Singular, because each row describes ONE record. */
export type GlobalSearchEntityType =
  | 'student'
  | 'faculty'
  | 'application'
  | 'course'
  | 'invoice'
  | 'payment'
  | 'exam'
  | 'result'
  | 'certificate'
  | 'ticket'
  | 'document';

export const GLOBAL_SEARCH_ENTITY_TYPES: readonly GlobalSearchEntityType[] = [
  'student',
  'faculty',
  'application',
  'course',
  'invoice',
  'payment',
  'exam',
  'result',
  'certificate',
  'ticket',
  'document',
];

/** One hit. `href` is a tenant-realm route the frontend navigates to on selection. */
export interface GlobalSearchResultItemDto {
  type: GlobalSearchEntityType;
  id: string;
  /** Primary label (name, title, number, code…). */
  title: string;
  /** Secondary label (status, email, code…). */
  subtitle: string | null;
  /** Third line of context (amount, date, campus…), already humanized. */
  description: string | null;
  /** Absolute in-app route for this record (e.g. `/students/<id>`). */
  href: string;
  /** 0..1 relevance used only for ordering rows of the same type. */
  score: number;
  /** Small type-specific badge values (status, number, amount…) for the palette UI. */
  meta: Record<string, string>;
}

/** GET /search?… */
export interface GlobalSearchResponseDto {
  query: string;
  /** Entity types that were actually searched (after permission filtering). */
  types: GlobalSearchEntityType[];
  /** Sum of the per-type match counts returned in `counts` (each capped). */
  total: number;
  /** Per-type match count — the numbers shown as badges next to each group. */
  counts: Partial<Record<GlobalSearchEntityType, number>>;
  results: GlobalSearchResultItemDto[];
  /** How long the fan-out took server-side (ms), for the palette's debug line. */
  tookMs: number;
}

export interface GlobalSearchSuggestionDto {
  /** Stable React key; not a database id for `kind: 'query'` suggestions. */
  id: string;
  kind: 'record' | 'query';
  text: string;
  type?: GlobalSearchEntityType;
  /** Present for `kind: 'record'`. */
  href?: string;
}

/** GET /search/suggest?… — type-ahead: recent queries first, then permitted record labels. */
export interface GlobalSearchSuggestionsResponseDto {
  query: string;
  suggestions: GlobalSearchSuggestionDto[];
}

/** One row of the caller's own search history. */
export interface RecentSearchDto {
  id: string;
  query: string;
  /** The entity-type filter the search ran with; null means "all permitted types". */
  types: GlobalSearchEntityType[] | null;
  resultCount: number;
  createdAt: string;
}

/** GET /search/recent */
export interface RecentSearchesResponseDto {
  data: RecentSearchDto[];
}
