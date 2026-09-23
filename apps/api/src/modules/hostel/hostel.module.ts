import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HostelController } from './hostel.controller';
import { HostelService } from './hostel.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule],
  controllers: [HostelController],
  providers: [HostelService],
})
export class HostelModule {}