import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type HelpdeskSlaSweepJobData, type NotificationJobData } from '@college-erp/types';

const OPEN_STATUSES = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'REOPENED'] as const;

/**
 * Periodic maintenance sweep (see HelpdeskSlaSchedulerService for the repeatable-job
 * registration) — finds every open helpdesk ticket past its response/resolution SLA across every
 * tenant, and auto-escalates it: records a HelpdeskEscalation, bumps the ticket's escalation
 * level, writes the immutable history row + platform audit entry, and queues notifications to
 * the assignee and the SLA policy's configured escalation role holders.
 *
 * Finding breached tickets is inherently cross-tenant (a maintenance sweep, not a per-tenant
 * request), so — like WorkflowEscalationProcessor — this reads through the unscoped
 * platformPrismaClient and performs every MUTATION through a per-tenant client built from what
 * was found. Idempotent: a ticket already carrying the matching breach reason is skipped.
 */
@Processor(QUEUE_NAMES.HELPDESK_SLA)
export class HelpdeskSlaProcessor extends WorkerHost {
  private readonly logger = new Logger(HelpdeskSlaProcessor.name);

  constructor(@InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationsQueue: Queue<NotificationJobData>) {
    super();
  }

  async process(_job: Job<HelpdeskSlaSweepJobData>): Promise<void> {
    const now = new Date();
    const breached = await platformPrismaClient.helpdeskTicket.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        OR: [
          { responseDueAt: { lt: now, not: null }, firstRespondedAt: null },
          { resolutionDueAt: { lt: now } },
        ],
      },
      include: { slaPolicy: true, escalations: { select: { reason: true } } },
    });

    const byTenant = new Map<string, typeof breached>();
    for (const ticket of breached) {
      const list = byTenant.get(ticket.tenantId) ?? [];
      list.push(ticket);
      byTenant.set(ticket.tenantId, list);
    }

    let escalated = 0;
    for (const [tenantId, tickets] of byTenant) {
      const tenantClient = createTenantScopedClient(tenantId);

      for (const ticket of tickets) {
        const policy = ticket.slaPolicy;
        if (!policy?.escalateAfterMinutes) continue;
        const graceMs = policy.escalateAfterMinutes * 60_000;
        const reasons = new Set(ticket.escalations.map((e) => e.reason));

        const responseBreached = !ticket.firstRespondedAt && ticket.responseDueAt && ticket.responseDueAt.getTime() + graceMs < now.getTime();
        const resolutionBreached = ticket.resolutionDueAt && ticket.resolutionDueAt.getTime() + graceMs < now.getTime();

        let reason: 'RESPONSE_BREACH' | 'RESOLUTION_BREACH' | null = null;
        if (responseBreached && !reasons.has('RESPONSE_BREACH')) reason = 'RESPONSE_BREACH';
        else if (resolutionBreached && !reasons.has('RESOLUTION_BREACH')) reason = 'RESOLUTION_BREACH';
        if (!reason) continue;

        const level = (ticket.escalationLevel ?? 0) + 1;
        await tenantClient.helpdeskEscalation.create({
          data: {
            tenantId,
            ticketId: ticket.id,
            reason,
            level,
            fromAssigneeUserId: ticket.assignedToUserId ?? null,
            toRoleCode: policy.escalateToRoleCode ?? null,
            note: reason === 'RESPONSE_BREACH' ? `First response breached (due ${ticket.responseDueAt?.toISOString()}).` : `Resolution breached (due ${ticket.resolutionDueAt?.toISOString()}).`,
          },
        });

        await tenantClient.helpdeskTicket.update({
          where: { id: ticket.id },
          data: { escalationLevel: level, escalatedAt: now },
        });

        await tenantClient.helpdeskTicketHistory.create({
          data: { tenantId, ticketId: ticket.id, event: 'SLA_BREACHED', actorType: 'SYSTEM', toValue: reason },
        });

        await platformPrismaClient.platformAuditLog.create({
          data: {
            scope: 'TENANT',
            tenantId,
            actorType: 'SYSTEM',
            action: 'HELPDESK_TICKET_ESCALATED',
            module: 'helpdesk',
            entityType: 'HelpdeskTicket',
            entityId: ticket.id,
            after: { reason, level, toRoleCode: policy.escalateToRoleCode },
          },
        });

        const recipientIds = new Set<string>();
        if (ticket.assignedToUserId) recipientIds.add(ticket.assignedToUserId);
        if (policy.escalateToRoleCode) {
          const roleHolders = await tenantClient.userRole.findMany({
            where: { role: { code: policy.escalateToRoleCode }, user: { status: 'ACTIVE' } },
            select: { userId: true },
          });
          for (const holder of roleHolders) recipientIds.add(holder.userId);
        }

        for (const recipientUserId of recipientIds) {
          const notification = await tenantClient.notification.create({
            data: {
              tenantId,
              recipientUserId,
              channel: 'IN_APP',
              subject: `Helpdesk ticket ${ticket.ticketNumber} escalated`,
              body: `${ticket.subject} — escalated (${reason}).`,
            },
          });
          await this.notificationsQueue.add('deliver', { tenantId, notificationId: notification.id });
        }

        escalated += 1;
      }
    }

    this.logger.log(`Helpdesk SLA sweep: found ${breached.length} breached ticket(s) across ${byTenant.size} tenant(s), escalated ${escalated}.`);
  }
}
