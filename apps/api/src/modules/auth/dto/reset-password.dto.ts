import { IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class ResetPasswordDto {
  @IsString()
  @MinLength(1)
  token!: string;

  @IsStrongPassword()
  newPassword!: string;
}
