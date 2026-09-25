import { IsInt, IsOptional, Min } from 'class-validator';

/** POST /documents/:id/confirm-upload. The sizeBytes claim is advisory only — the server runs a
 *  HEAD against storage and trusts the reported ContentLength, not this field. */
export class ConfirmUploadDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  sizeBytes?: number;
}