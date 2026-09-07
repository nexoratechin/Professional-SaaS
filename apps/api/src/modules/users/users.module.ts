import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { RolesController } from './roles.controller';
import { RolesService } from './roles.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule],
  controllers: [UsersController, RolesController],
  providers: [UsersService, RolesService],
})
export class UsersModule {}
