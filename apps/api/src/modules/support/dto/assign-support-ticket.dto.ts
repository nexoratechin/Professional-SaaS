import { IsString } from 'class-validator';

export class AssignSupportTicketDto {
  @IsString()
  platformUserId!: string;
}
