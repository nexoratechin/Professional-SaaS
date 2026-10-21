import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const PLATFORM_ROLES = ['PLATFORM_ADMIN', 'PLATFORM_SUPPORT'] as const;

export class CreatePlatformUserDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsIn(PLATFORM_ROLES)
  role!: (typeof PLATFORM_ROLES)[number];

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
