import { IsBoolean } from 'class-validator';

/** Set (true) or clear (false) the subscription's end-of-period cancellation flag — cancel-at-
 *  period-end vs. reinstate for continued auto-renewal. */
export class CancelAtPeriodEndDto {
  @IsBoolean()
  cancelAtPeriodEnd: boolean;
}