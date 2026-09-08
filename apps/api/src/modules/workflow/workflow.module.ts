import { Module } from '@nestjs/common';
import { CommonGuardsModule } from '../../common/guards/common-guards.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { RbacModule } from '../rbac/rbac.module';
import { WorkflowApproverResolutionService } from './workflow-approver-resolution.service';
import { WorkflowDefinitionsController } from './workflow-definitions.controller';
import { WorkflowDefinitionsService } from './workflow-definitions.service';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowInstancesController } from './workflow-instances.controller';

/** Exports WorkflowDefinitionsService so TenantProvisioningService (tenants module) can seed the
 * tenant-configurable example definitions at tenant-creation time — same pattern as it already
 * uses to seed default roles. */
@Module({
  imports: [CommonGuardsModule, RbacModule, NotificationsModule],
  controllers: [WorkflowDefinitionsController, WorkflowInstancesController],
  providers: [WorkflowDefinitionsService, WorkflowEngineService, WorkflowApproverResolutionService],
  exports: [WorkflowDefinitionsService, WorkflowEngineService],
})
export class WorkflowModule {}
