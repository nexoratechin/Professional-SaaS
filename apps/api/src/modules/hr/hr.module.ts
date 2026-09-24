import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HrController } from './hr.controller';
import { HrService } from './hr.service';
import { HrLeaveService } from './hr-leave.service';
import { HrPerformanceService } from './hr-performance.service';
import { HrPayrollService } from './hr-payroll.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule],
  controllers: [HrController],
  providers: [HrService, HrLeaveService, HrPerformanceService, HrPayrollService],
  exports: [HrService, HrLeaveService, HrPerformanceService, HrPayrollService],
})
export class HrModule {}