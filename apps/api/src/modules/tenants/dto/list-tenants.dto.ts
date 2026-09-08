import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

const STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED'] as const;

export class ListTenantsDto {
  /** Matches against slug or name, case-insensitive. */
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  take?: number;
}
