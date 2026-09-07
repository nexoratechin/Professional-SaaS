import { IsIn } from 'class-validator';

const STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;

export class UpdateUserStatusDto {
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];
}
