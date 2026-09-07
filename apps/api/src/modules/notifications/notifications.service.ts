import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QUEUE_NAMES, type NotificationJobData } from '@college-erp/types';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import type { SendNotificationDto } from './dto/send-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly queue: Queue<NotificationJobData>,
    private readonly auditService: AuditService,
  ) {}

  async send(tenantId: string, dto: SendNotificationDto, actorUserId: string) {
    // Tenant-scoped lookup — if recipientUserId belongs to a different tenant, this finds
    // nothing and we reject rather than silently creating a notification that points at
    // someone outside this tenant.
    const recipient = await this.tenantPrisma.client.user.findFirst({ where: { id: dto.recipientUserId } });
    if (!recipient) {
      throw new NotFoundException('Recipient not found in this tenant.');
    }

    const notification = await this.tenantPrisma.client.notification.create({
      data: {
        tenantId,
        recipientUserId: dto.recipientUserId,
        channel: dto.channel,
        subject: dto.subject,
        body: dto.body,
        createdBy: actorUserId,
      },
    });

    // Job payload carries ONLY tenantId + notificationId — never the subject/body/recipient
    // directly — so the worker has no choice but to re-fetch through a tenant-scoped client.
    await this.queue.add('deliver', { tenantId, notificationId: notification.id });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: 'NOTIFICATION_QUEUED',
      entityType: 'Notification',
      entityId: notification.id,
      after: { channel: dto.channel, subject: dto.subject },
    });

    return notification;
  }

  async list() {
    return this.tenantPrisma.client.notification.findMany({ orderBy: { createdAt: 'desc' } });
  }
}
