import { Controller, Delete, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSION_KEYS as K, type AuthenticatedUser } from '@college-erp/auth';
import type {
  GlobalSearchResponseDto,
  GlobalSearchSuggestionsResponseDto,
  RecentSearchesResponseDto,
} from '@college-erp/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { TenantMatchGuard } from '../../common/guards/tenant-match.guard';
import { SearchQueryDto, SearchSuggestQueryDto } from './dto/global-search.dto';
import { GlobalSearchService } from './global-search.service';

/**
 * Global search / command palette. `search.view` gates the entry point only — each result family
 * is still filtered by its own module's view permission and row scope inside
 * GlobalSearchService (the same guards every other feature controller uses). No feature flag is
 * attached: FeatureFlagsGuard is a no-op without @RequireFeature metadata, and search has no
 * plan-entitlement boolean to key off.
 */
@ApiTags('search')
@ApiBearerAuth()
@Controller('search')
@UseGuards(JwtAuthGuard, TenantMatchGuard, PermissionsGuard)
export class GlobalSearchController {
  constructor(private readonly globalSearch: GlobalSearchService) {}

  @Get()
  @RequirePermission(K.SEARCH_VIEW)
  @ApiOperation({ summary: 'Search across permitted entity types' })
  @ApiOkResponse({ description: 'Grouped results, per-type counts and timing.' })
  search(@CurrentUser() user: AuthenticatedUser, @Query() query: SearchQueryDto): Promise<GlobalSearchResponseDto> {
    return this.globalSearch.search(user.tenantId, user.id, query);
  }

  @Get('suggest')
  @RequirePermission(K.SEARCH_VIEW)
  @ApiOperation({ summary: 'Type-ahead suggestions: recent queries first, then permitted record labels' })
  suggest(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: SearchSuggestQueryDto,
  ): Promise<GlobalSearchSuggestionsResponseDto> {
    return this.globalSearch.suggest(user.tenantId, user.id, query);
  }

  @Get('recent')
  @RequirePermission(K.SEARCH_VIEW)
  @ApiOperation({ summary: "The caller's own recent searches" })
  recent(@CurrentUser() user: AuthenticatedUser): Promise<RecentSearchesResponseDto> {
    return this.globalSearch.recent(user.id);
  }

  @Delete('recent')
  @RequirePermission(K.SEARCH_VIEW)
  @ApiOperation({ summary: "Clear the caller's own recent searches" })
  clearRecent(@CurrentUser() user: AuthenticatedUser): Promise<{ cleared: number }> {
    return this.globalSearch.clearRecent(user.id);
  }
}
