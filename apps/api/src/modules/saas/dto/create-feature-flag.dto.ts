import { IsString } from 'class-validator';

export class CreateFeatureFlagDto {
  @IsString()
  key!: string;

  @IsString()
  name!: string;

  @IsString()
  module!: string;
}
