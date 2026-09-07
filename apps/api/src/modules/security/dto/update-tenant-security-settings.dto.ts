import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateTenantSecuritySettingsDto {
  /** Only takes effect if the tenant's plan grants FEATURE_KEYS.MFA and the platform-wide
   * mfaGloballyEnabled switch is on — enforced in SecuritySettingsService, not here. */
  @IsOptional()
  @IsBoolean()
  mfaRequired?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24)
  passwordHistoryCount?: number;

  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(20)
  maxFailedLoginAttempts?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440)
  accountLockoutMinutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  trustedDeviceDays?: number;

  @IsOptional()
  @IsBoolean()
  notifyOnNewDeviceLogin?: boolean;

  @IsOptional()
  @IsBoolean()
  blockSuspiciousLogins?: boolean;
}
