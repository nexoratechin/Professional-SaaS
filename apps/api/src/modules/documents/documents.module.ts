import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';

@Module({
  imports: [CommonGuardsModule],
  controllers: [DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
