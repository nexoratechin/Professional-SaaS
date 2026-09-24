import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';
import { TransportGpsService } from './gps/transport-gps.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule],
  controllers: [TransportController],
  providers: [TransportService, TransportGpsService],
})
export class TransportModule {}