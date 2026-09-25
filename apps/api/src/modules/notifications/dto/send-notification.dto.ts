import { IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

const CHANNELS = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH', 'IN_APP'] as const;

export class SendNotificationDto {
  @IsUUID()
  recipientUserId!: string;

  @IsIn(CHANNELS)
  channel!: (typeof CHANNELS)[number];

  @IsString()
  @MinLength(1)
  subject!: string;

  @IsString()
  @MinLength(1)
  body!: string;

  /** ISO-8601 future timestamp: rows are marked QUEUED and the deliver job gets a BullMQ delay. */
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  /** Template variable bag captured at enqueue time for traceability. */
  @IsOptional()
  @IsObject()
  variables?: Record<string, string | number | boolean>;
}