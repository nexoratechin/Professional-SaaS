import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class UpdateSubscriptionItemDto {
  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  moduleKey?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  unitPriceCents?: number;
}
