import { Type } from 'class-transformer';
import { IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

const AUDIT_SCOPES = ['PLATFORM', 'TENANT'] as const;

/** Searchable filters shared by both the tenant- and platform-scoped audit endpoints — see
 * AuditService.search(). Every field is optional; omitting all of them just paginates the full
 * trail (narrowed to the caller's own tenant on the tenant endpoint). */
export class ListAuditLogsDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  take?: number;

  @IsOptional()
  @IsString()
  module?: string;

  @IsOptional()
  @IsString()
  action?: string;

  @IsOptional()
  @IsString()
  entityType?: string;

  @IsOptional()
  @IsString()
  entityId?: string;

  @IsOptional()
  @IsString()
  actorEmail?: string;

  @IsOptional()
  @IsString()
  requestId?: string;

  @IsOptional()
  @IsISO8601()
  dateFrom?: string;

  @IsOptional()
  @IsISO8601()
  dateTo?: string;
}

export class ListPlatformAuditLogsDto extends ListAuditLogsDto {
  @IsOptional()
  @IsString()
  tenantId?: string;

  @IsOptional()
  @IsIn(AUDIT_SCOPES)
  scope?: (typeof AUDIT_SCOPES)[number];
}
