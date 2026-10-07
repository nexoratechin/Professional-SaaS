/**
 * Pure request-shaping for the search API. Kept free of any `lib/http` import so it can be unit
 * tested under the web Jest config (node env), which cannot parse `import.meta.env` in http.ts.
 */
export interface SearchRequestParams {
  q: string;
  types?: readonly string[];
  take?: number;
}

/** Serializes search params the way the API DTO expects (comma-separated `types`). */
export function buildSearchQuery(params: SearchRequestParams): string {
  const search = new URLSearchParams();
  search.set('q', params.q);
  if (params.types && params.types.length > 0) {
    search.set('types', params.types.join(','));
  }
  if (params.take != null) {
    search.set('take', String(params.take));
  }
  return search.toString();
}
