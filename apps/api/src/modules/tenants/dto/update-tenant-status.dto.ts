import { IsIn } from 'class-validator';

const STATUSES = ['TRIAL', 'ACTIVE', 'SUSPENDED', 'CANCELED'] as const;

export class UpdateTenantStatusDto {
  @IsIn(STATUSES)
  status!: (typeof STATUSES)[number];
}
