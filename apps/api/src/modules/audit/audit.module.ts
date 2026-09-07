import { Global, Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

/** Global: every module (this phase and future ones) can write audit entries without importing
 * this module explicitly. */
@Global()
@Module({
  imports: [CommonGuardsModule],
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
