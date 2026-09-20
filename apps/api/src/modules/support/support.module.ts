import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { SupportTicketsController } from './support-tickets.controller';
import { SupportTicketsService } from './support-tickets.service';

@Module({
  imports: [CommonGuardsModule],
  controllers: [SupportTicketsController],
  providers: [SupportTicketsService],
})
export class SupportModule {}
