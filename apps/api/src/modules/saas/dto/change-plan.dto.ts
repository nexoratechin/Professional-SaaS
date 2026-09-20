import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Tenant self-service or platform-admin plan change (upgrade/downgrade/side-grade) for a
 *  subscription. Applies immediately with prorated credit/charge for the remainder of the
 *  current billing period when BillingConfig.prorationEnabled is on. */
export class ChangePlanDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  @Matches(/^[a-z0-9_-]+$/, { message: 'planCode must be a plan catalog code (e.g. professional).' })
  planCode: string;
}