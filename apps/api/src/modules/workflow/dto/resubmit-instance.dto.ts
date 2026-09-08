import { IsObject, IsOptional } from 'class-validator';

export class ResubmitInstanceDto {
  /** Replaces the instance's context wholesale when provided (e.g. the requester corrected the
   * amount) — omitted means "resubmit unchanged". */
  @IsOptional()
  @IsObject()
  context?: Record<string, unknown>;
}
