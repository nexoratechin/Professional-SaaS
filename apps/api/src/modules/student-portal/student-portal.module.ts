import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AuthModule } from '../auth/auth.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { CertificatesModule } from '../certificates/certificates.module';
import { DocumentsModule } from '../documents/documents.module';
import { FeesModule } from '../fees/fees.module';
import { HelpdeskModule } from '../helpdesk/helpdesk.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RbacModule } from '../rbac/rbac.module';
import { StudentPortalController } from './student-portal.controller';
import { PublicStudentIdController } from './public-student-id.controller';
import { StudentPortalService } from './student-portal.service';

/**
 * Student Portal — self-service composition over the existing modules. It reuses each owning
 * module's exported service for writes (certificates, documents, fee payments, helpdesk,
 * notifications) and reads the rest through the tenant-scoped Prisma client, always restricted
 * to the caller's own Student row.
 */
@Module({
  imports: [
    CommonGuardsModule,
    RbacModule,
    AuthModule,
    AttendanceModule,
    CertificatesModule,
    DocumentsModule,
    FeesModule,
    HelpdeskModule,
    NotificationsModule,
  ],
  controllers: [StudentPortalController, PublicStudentIdController],
  providers: [StudentPortalService],
  exports: [StudentPortalService],
})
export class StudentPortalModule {}
