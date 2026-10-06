import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Canonical sort direction — every list endpoint validates against these two values. */
export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

/** Platform defaults for offset pagination. List endpoints default to these when the client
 *  omits the params, and hard-cap at MAX_PAGE_SIZE regardless of what's requested. */
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 200;

/**
 * Shared base for every list/collection endpoint in the REST platform. Provides the three
 * cross-cutting query dimensions — pagination (skip/take), sorting (sortOrder), and free-text
 * `search` — using the same field names, validation rules and defaults everywhere.
 *
 * `sortBy` is deliberately NOT here: which column a collection may be sorted on is
 * entity-specific and must be an `@IsIn([...])` enum declared by the module's own list DTO (e.g.
 * `STUDENT_SORT_KEYS`), so invalid sort keys fail validation instead of leaking a DB error.
 *
 * Example — a module list DTO:
 *   export class ListThingDto extends PaginationQueryDto {
 *     @IsOptional() @IsIn(THING_SORT_KEYS) sortBy?: (typeof THING_SORT_KEYS)[number];
 *     @IsOptional() @IsString() status?: string;
 *   }
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Number of records to skip (offset pagination).', default: 0, minimum: 0, type: Number })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @ApiPropertyOptional({
    description: 'Page size (number of records to return).',
    default: DEFAULT_PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
    type: Number,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @Type(() => Number)
  take?: number;

  @ApiPropertyOptional({ description: 'Sort direction. Combine with the module-specific `sortBy`.', enum: SORT_ORDERS, default: 'asc' })
  @IsOptional()
  @IsIn(SORT_ORDERS)
  sortOrder?: SortOrder;

  @ApiPropertyOptional({
    description: 'Free-text search applied to the entity\'s searchable fields (case-insensitive).',
    type: String,
    example: 'ravi',
  })
  @IsOptional()
  @IsString()
  search?: string;
}