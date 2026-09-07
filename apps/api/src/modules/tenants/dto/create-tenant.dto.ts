import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

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

  @IsEmail()
  adminEmail!: string;

  @IsString()
  @MinLength(2)
  adminFullName!: string;

  @IsStrongPassword()
  adminPassword!: string;
}
