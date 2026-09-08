import { IsIn, IsOptional, IsString } from 'class-validator';

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;

export class CreateSupportTicketDto {
  @IsString()
  subject!: string;

  @IsString()
  description!: string;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];

  /** Platform-side create only — which tenant this ticket concerns (may be omitted for a
   * general platform issue with no tenant). The tenant self-service create route ignores this
   * field entirely and always uses the caller's own authenticated tenant. */
  @IsOptional()
  @IsString()
  tenantId?: string;
}
