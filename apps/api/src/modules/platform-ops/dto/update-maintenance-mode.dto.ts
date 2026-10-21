import { IsBoolean, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateMaintenanceModeDto {
  @IsBoolean()
  enabled!: boolean;

  /** Shown verbatim on every tenant login screen while maintenance is active. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;

  /** Optional expected end of the window, ISO 8601. Omit for an open-ended window. */
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}
