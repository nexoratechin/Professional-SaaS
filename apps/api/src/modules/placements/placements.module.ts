import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PlacementsController } from './placements.controller';
import { PlacementsService } from './placements.service';
import { PlacementDriveService } from './placement-drive.service';
import { PlacementApplicationService } from './placement-application.service';
import { PlacementReportService } from './placement-report.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule],
  controllers: [PlacementsController],
  providers: [PlacementsService, PlacementDriveService, PlacementApplicationService, PlacementReportService],
  exports: [PlacementsService, PlacementDriveService, PlacementApplicationService, PlacementReportService],
})
export class PlacementsModule {}