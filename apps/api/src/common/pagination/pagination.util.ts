import type { Response } from 'express';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, type SortOrder } from './pagination.dto';

export interface PaginationQueryLike {
  skip?: number;
  take?: number;
}

export interface NormalizedPagination {
  skip: number;
  take: number;
}

/** Clamps client-supplied skip/take to the platform defaults + hard cap. */
export function normalizePagination(query: PaginationQueryLike = {}): NormalizedPagination {
  const skip = Number.isFinite(query.skip) ? Math.max(0, Math.trunc(query.skip ?? 0)) : 0;
  const take = Number.isFinite(query.take) ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(query.take ?? DEFAULT_PAGE_SIZE))) : DEFAULT_PAGE_SIZE;
  return { skip, take };
}

export function totalPages(total: number, take: number): number {
  return take > 0 ? Math.ceil(total / take) : 0;
}

/** 1-based page number for a given skip/take offset. */
export function pageFromSkip(skip: number, take: number): number {
  return take > 0 ? Math.floor(skip / take) + 1 : 1;
}

export interface LinkParts {
  path: string;
  skip: number;
  take: number;
}

/** Builds the `Link` header value (RFC 8288 subset) for prev/next pages. Pass the request's
 *  originalUrl (path only — query is rebuilt) so links stay tenant/server agnostic. */
export function buildPaginationLink(parts: LinkParts, rel: 'prev' | 'next'): string | null {
  if (parts.skip < 0) return null;
  const sep = parts.path.includes('?') ? '&' : '?';
  return `<${parts.path}${sep}skip=${parts.skip}&take=${parts.take}>; rel="${rel}"`;
}

export interface PaginationMetadataResult {
  total: number;
  skip: number;
  take: number;
  page: number;
  totalPages: number;
}

/**
 * Applies the pagination response headers every list endpoint shares:
 *   X-Total-Count — full matching row count (the codebase-wide convention the SPA pages on),
 *   X-Total-Pages — derived page count,
 *   X-Page        — 1-based current page,
 *   X-Page-Size   — records on this page,
 *   Link          — prev/next navigation (RFC 8288).
 * Request URL only supplies the rel links; callers that already set X-Total-Count can drop that
 * line and let this helper own it. Pure/additive — never wraps or mutates the response body.
 */
export function applyPaginationMetadata(
  res: Response,
  total: number,
  query: PaginationQueryLike = {},
  url?: string,
): PaginationMetadataResult {
  const { skip, take } = normalizePagination(query);
  const page = pageFromSkip(skip, take);
  const totalPagesCount = totalPages(total, take);

  res.setHeader('X-Total-Count', String(total));
  res.setHeader('X-Total-Pages', String(totalPagesCount));
  res.setHeader('X-Page', String(page));
  res.setHeader('X-Page-Size', String(take));

  if (url) {
    const links: string[] = [];
    if (page > 1) {
      const prev = buildPaginationLink({ path: url, skip: Math.max(0, skip - take), take }, 'prev');
      if (prev) links.push(prev);
    }
    if (page < totalPagesCount) {
      const next = buildPaginationLink({ path: url, skip: skip + take, take }, 'next');
      if (next) links.push(next);
    }
    if (links.length > 0) {
      res.setHeader('Link', links.join(', '));
    }
  }

  return { total, skip, take, page, totalPages: totalPagesCount };
}

/** Builds a Prisma-safe `orderBy` from a module's validated sort key + the shared sortOrder.
 *  Pass an explicit map for computed/joined fields when the module needs more than a column. */
export function toOrderBy<T extends string>(key: T | undefined, order: SortOrder | undefined): Record<string, 'asc' | 'desc'> | undefined {
  if (!key) return undefined;
  return { [key]: (order ?? 'asc') === 'desc' ? 'desc' : 'asc' } as Record<string, 'asc' | 'desc'>;
}

/** Shorthand for the extremely common "search a few text columns" filter building block. */
export function searchContains(search: string | undefined, fields: string[]): Array<Record<string, unknown>> | undefined {
  if (!search) return undefined;
  return fields.map((field) => ({ [field]: { contains: search, mode: 'insensitive' as const } }));
}