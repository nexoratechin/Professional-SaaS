import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

const ENTITLEMENT_TYPES = ['BOOLEAN', 'QUANTITY'] as const;

/** Manual, one-off entitlement grant for a specific tenant — the QUANTITY/PlanModule-key
 * generalization of SetTenantFeatureOverrideDto, which only covers boolean FeatureFlag keys.
 * `key` is free-form (a FeatureFlag.key or a PlanModule.moduleKey) since Entitlement spans both
 * catalogs — see Entitlement's doc comment in schema.prisma. */
export class SetEntitlementOverrideDto {
  @IsString()
  key!: string;

  @IsIn(ENTITLEMENT_TYPES)
  type!: (typeof ENTITLEMENT_TYPES)[number];

  @IsOptional()
  @IsBoolean()
  boolValue?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  limitValue?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
