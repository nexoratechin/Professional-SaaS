import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../common/pagination/pagination.dto';

const STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED'] as const;

export const TENANT_SORT_KEYS = ['createdAt', 'name', 'slug', 'status'] as const;

export class ListTenantsDto extends PaginationQueryDto {
  /** Matches against slug or name, case-insensitive. */
  @ApiPropertyOptional({ description: 'Matches against slug or name, case-insensitive.', example: 'demo' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @ApiPropertyOptional({ description: 'Sort column.', enum: TENANT_SORT_KEYS, default: 'createdAt' })
  @IsOptional()
  @IsIn(TENANT_SORT_KEYS)
  sortBy?: (typeof TENANT_SORT_KEYS)[number];
}