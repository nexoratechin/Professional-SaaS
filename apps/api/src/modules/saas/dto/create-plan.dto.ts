import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const BILLING_CYCLES = ['MONTHLY', 'ANNUAL', 'ONE_TIME'] as const;

export class CreatePlanDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsIn(BILLING_CYCLES)
  billingCycle?: (typeof BILLING_CYCLES)[number];

  @IsOptional()
  @IsBoolean()
  isCustom?: boolean;

  /** Feature flag keys this plan grants — validated against the FeatureFlag catalog. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  featureKeys?: string[];
}
