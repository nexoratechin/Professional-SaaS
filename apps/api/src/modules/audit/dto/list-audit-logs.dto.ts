import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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
}

export class ListPlatformAuditLogsDto extends ListAuditLogsDto {
  @IsOptional()
  @IsString()
  tenantId?: string;
}
