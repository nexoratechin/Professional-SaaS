import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { RbacModule } from '../rbac/rbac.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { HelpdeskConfigService } from './helpdesk-config.service';
import { HelpdeskController } from './helpdesk.controller';
import { HelpdeskReportService } from './helpdesk-report.service';
import { HelpdeskTicketService } from './helpdesk-ticket.service';

@Module({
  imports: [CommonGuardsModule, RbacModule, AuthModule, NotificationsModule, WorkflowModule],
  controllers: [HelpdeskController],
  providers: [HelpdeskConfigService, HelpdeskTicketService, HelpdeskReportService],
  exports: [HelpdeskConfigService, HelpdeskTicketService, HelpdeskReportService],
})
export class HelpdeskModule {}
