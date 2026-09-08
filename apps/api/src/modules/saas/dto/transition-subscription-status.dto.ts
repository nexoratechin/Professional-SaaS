import { IsOptional, IsString } from 'class-validator';

/** Body for the explicit /activate, /suspend, /cancel lifecycle endpoints — an optional
 * human-readable reason, stamped onto the audit entry for support/compliance traceability. */
export class TransitionSubscriptionStatusDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
