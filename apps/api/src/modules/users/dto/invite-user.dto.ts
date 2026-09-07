import { IsEmail, IsString, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/decorators/is-strong-password.decorator';

export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(2)
  fullName!: string;

  /** The inviter sets an initial password directly; the user is created ACTIVE (see
   * UsersService.invite) and gets an (advisory, non-blocking) email verification link. */
  @IsStrongPassword()
  initialPassword!: string;
}
