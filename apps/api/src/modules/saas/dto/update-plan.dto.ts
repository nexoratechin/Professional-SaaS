import { IsArray, IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** When provided, replaces the plan's feature grants wholesale. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  featureKeys?: string[];
}
