import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { DeviceSecretCipher } from '../../common/security/device-secret-cipher';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { StudentsModule } from '../students/students.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { AttendanceDevicesController } from './attendance-devices.controller';
import { AttendanceDeviceGatewayController } from './attendance-device-gateway.controller';
import { AttendanceDevicesService } from './devices/attendance-devices.service';
import { DeviceIngestService } from './devices/device-ingest.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule, StudentsModule],
  controllers: [AttendanceController, AttendanceDevicesController, AttendanceDeviceGatewayController],
  providers: [AttendanceService, AttendanceDevicesService, DeviceIngestService, DeviceSecretCipher],
})
export class AttendanceModule {}