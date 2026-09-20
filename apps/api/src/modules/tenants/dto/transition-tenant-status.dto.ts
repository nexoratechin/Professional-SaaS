import { IsOptional, IsString } from 'class-validator';

/** Body for the explicit /activate, /suspend, /deactivate lifecycle endpoints — an optional
 * human-readable reason, stamped onto the audit entry for support/compliance traceability. */
export class TransitionTenantStatusDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
