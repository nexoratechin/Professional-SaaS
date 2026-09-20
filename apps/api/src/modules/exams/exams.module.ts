import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ExamsController } from './exams.controller';
import { ExamsService } from './exams.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule],
  controllers: [ExamsController],
  providers: [ExamsService],
})
export class ExamsModule {}