import { IsString, Matches, MinLength } from 'class-validator';

export class CreateRoleDto {
  @IsString()
  @Matches(/^[A-Z0-9_]+$/, { message: 'code must be UPPER_SNAKE_CASE' })
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;
}
