import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdatePlatformSecuritySettingsDto {
  /** Emergency kill switch — if false, no tenant can use MFA regardless of plan/tenant settings. */
  @IsOptional()
  @IsBoolean()
  mfaGloballyEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  mfaRequiredForPlatformAdmins?: boolean;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(20)
  defaultMaxFailedLoginAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  defaultAccountLockoutMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  defaultPasswordHistoryCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  defaultTrustedDeviceDays?: number;

  @IsOptional()
  @IsBoolean()
  suspiciousLoginDetectionEnabled?: boolean;
}
