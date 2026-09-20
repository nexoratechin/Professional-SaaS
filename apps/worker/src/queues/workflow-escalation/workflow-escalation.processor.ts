import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type NotificationJobData, type WorkflowEscalationSweepJobData } from '@college-erp/types';

/**
 * Periodic maintenance sweep (see WorkflowEscalationSchedulerService for the repeatable-job
 * registration) — finds every PENDING workflow approval task past its deadline, across every
 * tenant, and widens who may decide it to also include holders of the transition's configured
 * escalationRoleCode (see WorkflowApprovalTask.escalatedToRoleCode's schema doc comment: this
 * ADDS an eligible decider, it does not revoke the original approver's ability, and the task
 * stays PENDING throughout).
 *
 * Finding overdue tasks is inherently cross-tenant (a maintenance sweep, not a per-tenant
 * request), so — like AuditService/TenantLookupService elsewhere in this codebase — this reads
 * through the unscoped platformPrismaClient. Every MUTATION is still performed through a
 * tenant-scoped client built per tenant from what was found, exactly like NotificationsProcessor.
 */
@Processor(QUEUE_NAMES.WORKFLOW_ESCALATION)
export class WorkflowEscalationProcessor extends WorkerHost {
  private readonly logger = new Logger(WorkflowEscalationProcessor.name);

  constructor(@InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationsQueue: Queue<NotificationJobData>) {
    super();
  }

  async process(_job: Job<WorkflowEscalationSweepJobData>): Promise<void> {
    const overdueTasks = await platformPrismaClient.workflowApprovalTask.findMany({
      where: { status: 'PENDING', dueAt: { lt: new Date() }, escalatedAt: null },
      include: { transition: true, instance: true },
    });

    const byTenant = new Map<string, typeof overdueTasks>();
    for (const task of overdueTasks) {
      const list = byTenant.get(task.tenantId) ?? [];
      list.push(task);
      byTenant.set(task.tenantId, list);
    }

    let escalatedCount = 0;
    for (const [tenantId, tasks] of byTenant) {
      const tenantClient = createTenantScopedClient(tenantId);

      for (const task of tasks) {
        const escalationRoleCode = task.transition.escalationRoleCode;
        if (!escalationRoleCode) {
          continue;
        }

        await tenantClient.workflowApprovalTask.update({
          where: { id: task.id },
          data: { escalatedAt: new Date(), escalatedToRoleCode: escalationRoleCode },
        });

        await platformPrismaClient.platformAuditLog.create({
          data: {
            scope: 'TENANT',
            tenantId,
            actorType: 'SYSTEM',
            action: 'WORKFLOW_ESCALATED',
            module: 'workflows',
            entityType: task.instance.entityType,
            entityId: task.instance.entityId,
            after: { taskId: task.id, escalatedToRoleCode: escalationRoleCode, dueAt: task.dueAt },
          },
        });

        const eligibleUserRoles = await tenantClient.userRole.findMany({
          where: { role: { code: escalationRoleCode }, user: { status: 'ACTIVE' } },
          include: { user: { select: { id: true } } },
        });

        for (const userRole of eligibleUserRoles) {
          const notification = await tenantClient.notification.create({
            data: {
              tenantId,
              recipientUserId: userRole.user.id,
              channel: 'IN_APP',
              subject: `Escalated approval needed: ${task.instance.entityType}`,
              body:
                `A workflow approval task overdue since ${task.dueAt?.toISOString() ?? 'unknown'} has been ` +
                `escalated to your role (${escalationRoleCode}).`,
            },
          });
          await this.notificationsQueue.add('deliver', { tenantId, notificationId: notification.id });
        }

        escalatedCount += 1;
      }
    }

    this.logger.log(
      `Workflow escalation sweep: found ${overdueTasks.length} overdue task(s) across ${byTenant.size} tenant(s), escalated ${escalatedCount}.`,
    );
  }
}
