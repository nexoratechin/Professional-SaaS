import { IsIn, IsString, IsUUID, MinLength } from 'class-validator';

const CHANNELS = ['EMAIL', 'SMS', 'IN_APP'] as const;

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
}
