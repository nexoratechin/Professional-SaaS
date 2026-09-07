import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { SaasController } from './saas.controller';
import { SaasService } from './saas.service';

@Module({
  imports: [CommonGuardsModule, RbacModule],
  controllers: [SaasController],
  providers: [SaasService],
})
export class SaasModule {}
