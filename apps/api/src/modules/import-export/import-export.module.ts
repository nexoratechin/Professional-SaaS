import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { ImportExportController } from './import-export.controller';
import { ImportExportService } from './import-export.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, BullModule.registerQueue({ name: QUEUE_NAMES.DATA_IMPORTS })],
  controllers: [ImportExportController],
  providers: [ImportExportService],
})
export class ImportExportModule {}
