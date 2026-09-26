import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [CommonGuardsModule, BullModule.registerQueue({ name: QUEUE_NAMES.REPORT_EXPORTS })],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
