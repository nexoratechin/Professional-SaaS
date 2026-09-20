import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class GenerateInvoiceDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(365)
  dueInDays?: number;
}
