import type {
  GlobalSearchResponseDto,
  GlobalSearchSuggestionsResponseDto,
  RecentSearchDto,
  RecentSearchesResponseDto,
} from '@college-erp/types';
import { apiFetch } from '../../lib/http';
import { buildSearchQuery, type SearchRequestParams } from './search-params';

export { buildSearchQuery };
export type { SearchRequestParams };

export function searchAll(
  params: SearchRequestParams & { tenantSlug?: string | null },
): Promise<GlobalSearchResponseDto> {
  return apiFetch<GlobalSearchResponseDto>(`/search?${buildSearchQuery(params)}`, {
    tenantSlug: params.tenantSlug ?? undefined,
  });
}

export function suggestSearch(params: {
  q: string;
  limit?: number;
  tenantSlug?: string | null;
}): Promise<GlobalSearchSuggestionsResponseDto> {
  const search = new URLSearchParams({ q: params.q });
  if (params.limit != null) {
    search.set('limit', String(params.limit));
  }
  return apiFetch<GlobalSearchSuggestionsResponseDto>(`/search/suggest?${search.toString()}`, {
    tenantSlug: params.tenantSlug ?? undefined,
  });
}

export function fetchRecentSearches(tenantSlug?: string | null): Promise<RecentSearchesResponseDto> {
  return apiFetch<RecentSearchesResponseDto>('/search/recent', { tenantSlug: tenantSlug ?? undefined });
}

export function clearRecentSearches(tenantSlug?: string | null): Promise<{ cleared: number }> {
  return apiFetch<{ cleared: number }>('/search/recent', {
    method: 'DELETE',
    tenantSlug: tenantSlug ?? undefined,
  });
}

export type { RecentSearchDto };
