import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Platform-side edits to a tenant's profile fields (name/brand, billing contact, timezone). */
export class UpdateTenantProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  billingEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}
