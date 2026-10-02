import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { AuthModule } from '../auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RbacModule } from '../rbac/rbac.module';
import { ParentPortalController } from './parent-portal.controller';
import { ParentPortalService } from './parent-portal.service';

/**
 * Parent/Guardian Portal — read-only composition over the existing modules. It resolves the
 * caller's linked children through Guardians.userId and reads each section through the
 * tenant-scoped Prisma client, always restricted to a resolved child. Notices reuse
 * NotificationsService; document downloads reuse the global StorageService.
 */
@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule],
  controllers: [ParentPortalController],
  providers: [ParentPortalService],
  exports: [ParentPortalService],
})
export class ParentPortalModule {}
