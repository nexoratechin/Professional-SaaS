import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @Length(1, 200)
  challengeToken!: string;

  /** Either a 6-digit TOTP code or an XXXXX-XXXXX backup code. */
  @IsString()
  @Length(6, 11)
  code!: string;

  @IsOptional()
  @IsBoolean()
  rememberDevice?: boolean;
}
