import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import type {
  GlobalSearchEntityType,
  GlobalSearchResponseDto,
  GlobalSearchResultItemDto,
  GlobalSearchSuggestionDto,
  GlobalSearchSuggestionsResponseDto,
  RecentSearchDto,
  RecentSearchesResponseDto,
} from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { PermissionsService, type ScopeGrant } from '../rbac/permissions.service';
import type { SearchQueryDto, SearchSuggestQueryDto } from './dto/global-search.dto';
import { buildSearchRegistry, type SearchEntityDescriptor } from './search-registry';
import { combineSearchWhere, hasNoGrant, NO_ROWS } from './search-scope';

const DEFAULT_TAKE_PER_TYPE = 5;
const MAX_RECENT_SEARCHES = 10;
/** Per-user cap on stored history rows; older rows are pruned after each recorded search. */
const MAX_HISTORY_PER_USER = 50;
const SUGGEST_CACHE_TTL_SECONDS = 60;
/** Suggestions only fan out to record labels while the palette is still short-prefixing. */
const MIN_QUERY_LENGTH = 2;

/**
 * Cross-module, permission-aware search.
 *
 * The API is the security boundary, not the palette: the caller's effective permission map is
 * resolved once, each entity family is skipped unless its own view permission is granted, and the
 * family's scope fragment is merged into the query (see search-registry.ts). A family whose module
 * applies a record-level scope therefore inherits it here; one that only checks a permission is
 * treated identically. Results are re-derived on every call — history stores only the query text.
 */
@Injectable()
export class GlobalSearchService {
  private registryCache: SearchEntityDescriptor[] | null = null;

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly permissions: PermissionsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private get registry(): SearchEntityDescriptor[] {
    if (!this.registryCache) {
      this.registryCache = buildSearchRegistry();
    }
    return this.registryCache;
  }

  async search(tenantId: string, userId: string, dto: SearchQueryDto): Promise<GlobalSearchResponseDto> {
    const startedAt = Date.now();
    const query = dto.q.trim();
    const take = dto.take ?? DEFAULT_TAKE_PER_TYPE;
    const permissionMap = await this.permissions.getEffectivePermissionsWithScope(tenantId, userId);
    const requested = dto.types && dto.types.length > 0 ? new Set(dto.types) : null;

    const entries = this.registry.filter(
      (descriptor) =>
        (!requested || requested.has(descriptor.type)) && !hasNoGrant(permissionMap[descriptor.permission]),
    );

    const pages = await Promise.all(
      entries.map(async (descriptor) => {
        const grants = permissionMap[descriptor.permission] as ScopeGrant[];
        const scopeWhere = await this.resolveScope(descriptor, grants, userId);
        const where = combineSearchWhere(descriptor.textWhere(query), scopeWhere, descriptor.baseWhere);
        const { rows, count } = await descriptor.query(this.tenantPrisma.client, where, take);
        return { descriptor, rows, count };
      }),
    );

    const results: GlobalSearchResultItemDto[] = [];
    const counts: Partial<Record<GlobalSearchEntityType, number>> = {};
    const types: GlobalSearchEntityType[] = [];

    for (const { descriptor, rows, count } of pages) {
      types.push(descriptor.type);
      if (count > 0) counts[descriptor.type] = count;
      const ranked = rows.map((row) => descriptor.map(row, query)).sort((a, b) => b.score - a.score);
      results.push(...ranked);
    }

    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    if (query.length >= MIN_QUERY_LENGTH && total > 0) {
      await this.recordHistory(tenantId, userId, query, dto.types ?? [], total);
    }

    return { query, types, total, counts, results, tookMs: Date.now() - startedAt };
  }

  async suggest(tenantId: string, userId: string, dto: SearchSuggestQueryDto): Promise<GlobalSearchSuggestionsResponseDto> {
    const query = dto.q.trim();
    const limit = dto.limit ?? 8;
    const cacheKey = `search:suggest:${tenantId}:${userId}:${query.toLowerCase()}:${limit}`;

    const cached = await this.redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as GlobalSearchSuggestionsResponseDto;

    const permissionMap = await this.permissions.getEffectivePermissionsWithScope(tenantId, userId);
    const suggestions: GlobalSearchSuggestionDto[] = [];

    // 1. The caller's own past queries, prefix-matched — cheapest and usually most useful.
    const recents = await this.tenantPrisma.client.searchHistory.findMany({
      where: { userId, query: { startsWith: query, mode: 'insensitive' } },
      orderBy: { lastSearchedAt: 'desc' },
      take: limit,
      select: { id: true, query: true },
    });
    for (const recent of recents) {
      suggestions.push({ id: `query:${recent.id}`, kind: 'query', text: recent.query });
    }

    // 2. Record labels from permitted families, still capped by the overall limit. The per-family
    //    lookups run concurrently (was a serial await-per-family chain) but are flattened back in
    //    registry order so ranking stays deterministic.
    const permitted = this.registry.filter((descriptor) => !hasNoGrant(permissionMap[descriptor.permission]));
    const perFamily = await Promise.all(
      permitted.map(async (descriptor) => {
        const grants = permissionMap[descriptor.permission] as ScopeGrant[];
        const scopeWhere = await this.resolveScope(descriptor, grants, userId);
        const where = combineSearchWhere(descriptor.textWhere(query), scopeWhere, descriptor.baseWhere);
        const { rows } = await descriptor.query(this.tenantPrisma.client, where, limit);
        return rows.map((row) => {
          const item = descriptor.map(row, query);
          return {
            id: `record:${descriptor.type}:${item.id}`,
            kind: 'record' as const,
            text: item.title,
            type: descriptor.type,
            href: item.href,
          };
        });
      }),
    );
    for (const items of perFamily) {
      for (const item of items) {
        if (suggestions.length >= limit) break;
        suggestions.push(item);
      }
      if (suggestions.length >= limit) break;
    }

    const response: GlobalSearchSuggestionsResponseDto = { query, suggestions };
    await this.redis.set(cacheKey, JSON.stringify(response), 'EX', SUGGEST_CACHE_TTL_SECONDS);
    return response;
  }

  async recent(userId: string): Promise<RecentSearchesResponseDto> {
    const rows = await this.tenantPrisma.client.searchHistory.findMany({
      where: { userId },
      orderBy: { lastSearchedAt: 'desc' },
      take: MAX_RECENT_SEARCHES,
      select: { id: true, query: true, types: true, resultCount: true, createdAt: true },
    });

    const data: RecentSearchDto[] = rows.map((row) => ({
      id: row.id,
      query: row.query,
      types: row.types.length > 0 ? (row.types as GlobalSearchEntityType[]) : null,
      resultCount: row.resultCount,
      createdAt: row.createdAt.toISOString(),
    }));

    return { data };
  }

  async clearRecent(userId: string): Promise<{ cleared: number }> {
    const { count } = await this.tenantPrisma.client.searchHistory.deleteMany({ where: { userId } });
    return { cleared: count };
  }

  /** Fail-closed scope resolution — permission-only families intentionally return undefined. */
  private async resolveScope(
    descriptor: SearchEntityDescriptor,
    grants: ScopeGrant[],
    userId: string,
  ): Promise<Record<string, unknown> | undefined> {
    if (!descriptor.scope) return undefined;
    if (hasNoGrant(grants)) return NO_ROWS;
    return descriptor.scope(grants, userId, this.tenantPrisma.client);
  }

  /**
   * Upsert by (tenant, user, query) case-insensitively, then prune beyond the per-user cap.
   * History is best-effort: a failure here must never fail the search the user actually asked for.
   */
  private async recordHistory(
    tenantId: string,
    userId: string,
    query: string,
    types: GlobalSearchEntityType[],
    resultCount: number,
  ): Promise<void> {
    try {
      const existing = await this.tenantPrisma.client.searchHistory.findFirst({
        where: { userId, query: { equals: query, mode: 'insensitive' } },
        select: { id: true },
      });

      if (existing) {
        await this.tenantPrisma.client.searchHistory.update({
          where: { id: existing.id },
          data: { query, types, resultCount, lastSearchedAt: new Date() },
        });
      } else {
        await this.tenantPrisma.client.searchHistory.create({
          data: { tenantId, userId, query, types, resultCount },
        });
      }

      const overflow = await this.tenantPrisma.client.searchHistory.findMany({
        where: { userId },
        orderBy: { lastSearchedAt: 'desc' },
        skip: MAX_HISTORY_PER_USER,
        select: { id: true },
      });
      if (overflow.length > 0) {
        await this.tenantPrisma.client.searchHistory.deleteMany({
          where: { id: { in: overflow.map((row) => row.id) } },
        });
      }
    } catch {
      // Swallow: history is a convenience, never a correctness requirement.
    }
  }
}
