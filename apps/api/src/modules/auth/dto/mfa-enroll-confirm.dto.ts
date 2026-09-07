import { IsString, Length } from 'class-validator';

export class MfaEnrollConfirmDto {
  @IsString()
  @Length(6, 6)
  code!: string;
}
