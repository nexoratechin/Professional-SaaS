import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUE_NAMES } from '@college-erp/types';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { DocumentTypesService } from './document-types.service';
import { DocumentsController, DocumentTypesController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [
    CommonGuardsModule,
    RbacModule,
    // The queue's Redis connection comes from the global QueueModule; this just declares that
    // this module produces document-virus-scan jobs.
    BullModule.registerQueue({ name: QUEUE_NAMES.DOCUMENT_VIRUS_SCAN }),
  ],
  controllers: [DocumentsController, DocumentTypesController],
  providers: [DocumentsService, DocumentTypesService],
  exports: [DocumentsService, DocumentTypesService],
})
export class DocumentsModule {}