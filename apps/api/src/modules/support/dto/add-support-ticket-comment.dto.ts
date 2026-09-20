import { IsString } from 'class-validator';

export class AddSupportTicketCommentDto {
  @IsString()
  body!: string;
}
