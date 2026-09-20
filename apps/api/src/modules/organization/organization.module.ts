import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule],
  controllers: [OrganizationController],
  providers: [OrganizationService],
})
export class OrganizationModule {}