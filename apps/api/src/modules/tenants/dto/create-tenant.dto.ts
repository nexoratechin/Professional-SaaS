import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';
import { TENANT_DATA_ISOLATION_MODES } from './set-tenant-data-isolation.dto';
import type { TenantDataIsolationModeDto } from './set-tenant-data-isolation.dto';

export class CreateTenantDto {
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug must be lowercase alphanumeric with hyphens only' })
  @MinLength(3)
  @MaxLength(63)
  slug!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsEmail()
  billingEmail!: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  /** Optional enterprise isolation. Defaults to SHARED. Requires TENANT_DB_ISOLATION_ENABLED. */
  @IsOptional()
  @IsIn(TENANT_DATA_ISOLATION_MODES)
  dataIsolationMode?: TenantDataIsolationModeDto;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  adminFullName!: string;

  @IsStrongPassword()
  adminPassword!: string;
}
