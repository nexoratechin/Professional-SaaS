import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
import { FEATURE_KEYS, type FeatureKey } from '@college-erp/auth';

export class SetTenantFeatureOverrideDto {
  @IsIn(Object.values(FEATURE_KEYS))
  featureKey!: FeatureKey;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  reason?: string;
}
