import { IsNumber, IsOptional, IsString } from 'class-validator';

export class RecordUsageEventDto {
  @IsString()
  tenantId!: string;

  @IsString()
  eventType!: string;

  @IsNumber()
  quantity!: number;

  @IsOptional()
  metadata?: Record<string, unknown>;
}
