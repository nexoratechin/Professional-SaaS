import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

const ENTITLEMENT_TYPES = ['BOOLEAN', 'QUANTITY'] as const;

export class PlanModuleInputDto {
  @IsString()
  moduleKey!: string;

  @IsString()
  name!: string;

  @IsIn(ENTITLEMENT_TYPES)
  type!: (typeof ENTITLEMENT_TYPES)[number];

  /** Required when type = QUANTITY (e.g. 5 extra campuses); ignored for BOOLEAN. */
  @IsOptional()
  @IsInt()
  @Min(0)
  limitValue?: number;
}

export class SetPlanModulesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanModuleInputDto)
  modules!: PlanModuleInputDto[];
}
