import { Transform, Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GLOBAL_SEARCH_ENTITY_TYPES, type GlobalSearchEntityType } from '@college-erp/types';

/** Accepts `types=student,payment` and `types=student&types=payment` alike. */
function normalizeTypes(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const cleaned = raw
    .map((entry) => String(entry).trim())
    .filter((entry) => entry.length > 0);
  return cleaned.length > 0 ? cleaned : undefined;
}

export class SearchQueryDto {
  @ApiProperty({ description: 'Free-text query (minimum 2 characters).', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({
    description: 'Restrict the fan-out to these entity types (default: every permitted type).',
    enum: GLOBAL_SEARCH_ENTITY_TYPES,
    isArray: true,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeTypes(value))
  @IsArray()
  @IsIn(GLOBAL_SEARCH_ENTITY_TYPES as readonly string[], { each: true })
  types?: GlobalSearchEntityType[];

  @ApiPropertyOptional({ description: 'Max rows returned per entity type.', minimum: 1, maximum: 20, default: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  take?: number;
}

export class SearchSuggestQueryDto {
  @ApiProperty({ description: 'Partial query to complete.', minLength: 1, maxLength: 120 })
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  q!: string;

  @ApiPropertyOptional({ description: 'Max suggestions returned.', minimum: 1, maximum: 15, default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(15)
  limit?: number;
}
