import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PLATFORM_ROLES } from './create-platform-user.dto';

export class UpdatePlatformUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName?: string;

  @IsOptional()
  @IsIn(PLATFORM_ROLES)
  role?: (typeof PLATFORM_ROLES)[number];

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
