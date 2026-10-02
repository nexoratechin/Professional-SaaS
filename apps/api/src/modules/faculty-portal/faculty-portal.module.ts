import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExamsModule } from '../exams/exams.module';
import { HrModule } from '../hr/hr.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RbacModule } from '../rbac/rbac.module';
import { FacultyPortalController } from './faculty-portal.controller';
import { FacultyPortalService } from './faculty-portal.service';

/**
 * Faculty Portal — self-service composition over the existing modules. It resolves the caller's
 * own Employee row (Employee.userId) and reads/writes each section through the owning service
 * (attendance, exams, HR leave/workload, notifications) or, where no service entry point exists,
 * through the tenant-scoped Prisma client — always restricted to the caller's assigned course
 * offerings and their registered students.
 */
@Module({
  imports: [
    CommonGuardsModule,
    RbacModule,
    AuthModule,
    AttendanceModule,
    ExamsModule,
    HrModule,
    NotificationsModule,
  ],
  controllers: [FacultyPortalController],
  providers: [FacultyPortalService],
  exports: [FacultyPortalService],
})
export class FacultyPortalModule {}
