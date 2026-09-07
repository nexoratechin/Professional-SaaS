import { IsDateString, IsIn, IsString } from 'class-validator';

const BILLING_CYCLES = ['MONTHLY', 'ANNUAL', 'ONE_TIME'] as const;

export class CreateSubscriptionDto {
  @IsString()
  tenantId!: string;

  @IsString()
  planCode!: string;

  @IsIn(BILLING_CYCLES)
  billingCycle!: (typeof BILLING_CYCLES)[number];

  @IsDateString()
  currentPeriodStart!: string;

  @IsDateString()
  currentPeriodEnd!: string;
}
