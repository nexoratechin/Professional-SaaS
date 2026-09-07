import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';
import { PERMISSION_SCOPE_TYPES } from '@college-erp/auth';

const SCOPE_TYPES = Object.values(PERMISSION_SCOPE_TYPES);

export class PermissionGrantDto {
  @IsString()
  key!: string;

  /** Defaults to GLOBAL when omitted. */
  @IsOptional()
  @IsIn(SCOPE_TYPES)
  scopeType?: string;
}

export class SetRolePermissionsDto {
  /** Legacy flat form — every key granted at GLOBAL scope. Prefer `grants` for anything that
   * needs CAMPUS/DEPARTMENT/PROGRAM/OWN scoping. Exactly one of `permissionKeys`/`grants` should
   * be supplied; if both are, `grants` wins. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissionKeys?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PermissionGrantDto)
  grants?: PermissionGrantDto[];
}
