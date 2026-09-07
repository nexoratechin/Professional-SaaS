import { IsInt, IsOptional, Min } from 'class-validator';

export class ConfirmUploadDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}
