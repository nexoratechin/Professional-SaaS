import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** Append-only knobs for the SaaS-wide billing configuration (BillingConfigService.update). */
export class UpdateBillingConfigDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  taxName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5000)
  taxRateBps?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(10)
  @Matches(/^[A-Z0-9-]+$/, { message: 'invoicePrefix may only contain uppercase letters, digits, and hyphens.' })
  invoicePrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  gracePeriodDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  renewalDueDays?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(90)
  retryIntervalDays?: number;

  @IsOptional()
  @IsBoolean()
  prorationEnabled?: boolean;
}