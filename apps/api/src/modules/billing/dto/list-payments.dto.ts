import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const STATUSES = ['PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED'] as const;
const METHODS = ['CARD', 'UPI', 'BANK_TRANSFER', 'CASH', 'OFFLINE'] as const;

/** Record a manual payment attempt against an invoice (platform admin reconciliation — the
 *  gateway itself doesn't exist yet; see PaymentsService doc comment). */
export class RecordPaymentDto {
  @IsIn(METHODS)
  method: (typeof METHODS)[number];

  @IsIn(STATUSES.slice(0, 3))
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED';

  @IsOptional()
  @IsInt()
  @Min(1)
  amountCents?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  gatewayReference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  failureReason?: string;
}

export class ListPaymentsDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsString()
  subscriptionId?: string;

  @IsOptional()
  @IsString()
  invoiceId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  @Type(() => Number)
  take?: number;
}