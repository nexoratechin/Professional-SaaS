import { IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class ChangePasswordDto {
  @IsString()
  @MinLength(1)
  currentPassword!: string;

  @IsStrongPassword()
  newPassword!: string;
}
