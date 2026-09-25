import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import type { NotificationChannel, Prisma } from '@college-erp/database';
import {
  NotificationSecretCipher,
  assertValidProviderConfig,
  resolveAudience,
} from '@college-erp/notifications';
import { QUEUE_NAMES, type NotificationAudienceFilter, type NotificationJobData } from '@college-erp/types';
import { AppConfigService } from '../../config/app-config.service';
import { TenantContextService } from '../../common/prisma/tenant-context.service';
import { TenantScopedPrismaService } from '../../common/prisma/tenant-scoped-prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  notificationProvidersFor,
  type CreateNotificationCampaignDto,
  type CreateNotificationEventTriggerDto,
  type CreateNotificationProviderConfigDto,
  type CreateNotificationTemplateDto,
  type UpdateNotificationCampaignDto,
  type UpdateNotificationProviderConfigDto,
  type UpdateNotificationTemplateDto,
} from './dto/notifications.dto';
import type { SendNotificationDto } from './dto/send-notification.dto';

/** Recipient + payload for a system-triggered notification. Signature is compatible with the
 * previous minimal module — every existing module keeps calling sendSystem unchanged. */
export interface SystemNotificationInput {
  recipientUserId: string;
  channel?: NotificationChannel;
  subject: string;
  body: string;
  /** ISO-8601 future timestamp for delayed delivery (optional). */
  scheduledAt?: string;
}

/** Event emission input for event-triggered notifications (see triggerEvent). */
export interface NotificationEventInput {
  /** The user who should receive every trigger's notification for this event. */
  recipientUserId: string;
  /** Variable bag rendered into the matched templates. */
  variables?: Record<string, string | number | boolean>;
}

@Injectable()
export class NotificationsService {
  private readonly cipher: NotificationSecretCipher;

  constructor(
    private readonly tenantPrisma: TenantScopedPrismaService,
    private readonly tenantContext: TenantContextService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly queue: Queue<NotificationJobData>,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS_CAMPAIGN) private readonly campaignQueue: Queue,
    private readonly auditService: AuditService,
    private readonly appConfig: AppConfigService,
  ) {
    this.cipher = new NotificationSecretCipher(this.appConfig.get('NOTIFICATION_SECRET_KEY'));
  }

  // ── Direct sends (existing behaviour, extended with scheduling + variables) ──

  async send(tenantId: string, dto: SendNotificationDto, actorUserId: string) {
    // Tenant-scoped lookup — if recipientUserId belongs to a different tenant, this finds
    // nothing and we reject rather than silently creating a notification that points at
    // someone outside this tenant.
    const recipient = await this.tenantPrisma.client.user.findFirst({ where: { id: dto.recipientUserId } });
    if (!recipient) {
      throw new NotFoundException('Recipient not found in this tenant.');
    }

    const scheduledAt = dto.scheduledAt ? new Date(dto.scheduledAt) : undefined;
    if (scheduledAt && scheduledAt.getTime() <= Date.now()) {
      throw new BadRequestException('scheduledAt must be in the future.');
    }

    const notification = await this.tenantPrisma.client.notification.create({
      data: {
        tenantId,
        recipientUserId: dto.recipientUserId,
        channel: dto.channel,
        subject: dto.subject,
        body: dto.body,
        variables: (dto.variables ?? undefined) as Prisma.InputJsonValue | undefined,
        scheduledAt,
        status: scheduledAt ? 'QUEUED' : 'PENDING',
        createdBy: actorUserId,
      },
    });

    // Job payload carries ONLY tenantId + notificationId — never the subject/body/recipient
    // directly — so the worker has no choice but to re-fetch through a tenant-scoped client.
    await this.enqueueDeliver(tenantId, notification.id, scheduledAt);

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.NOTIFICATION_QUEUED,
      module: AUDIT_MODULES.NOTIFICATIONS,
      entityType: 'Notification',
      entityId: notification.id,
      after: { channel: dto.channel, subject: dto.subject, scheduledAt: scheduledAt?.toISOString() },
    });

    return notification;
  }

  /** Internal, system-triggered notifications (workflow approvers, results, helpdesk, ...) —
   * no human actor, no per-notification audit entry (the lifecycle event that CAUSED it is what
   * gets audited by its caller). */
  async sendSystem(tenantId: string, input: SystemNotificationInput) {
    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : undefined;
    const notification = await this.tenantPrisma.client.notification.create({
      data: {
        tenantId,
        recipientUserId: input.recipientUserId,
        channel: input.channel ?? 'IN_APP',
        subject: input.subject,
        body: input.body,
        scheduledAt,
        status: scheduledAt ? 'QUEUED' : 'PENDING',
      },
    });

    await this.enqueueDeliver(tenantId, notification.id, scheduledAt);
    return notification;
  }

  /** Fires an event: every ACTIVE NotificationEventTrigger for (tenantId, eventKey) renders its
   * template's channel into one notification for the given recipient and enqueues it. Free-form
   * event keys keep this open for any future module with zero schema changes. */
  async triggerEvent(tenantId: string, eventKey: string, input: NotificationEventInput) {
    const triggers = await this.tenantPrisma.client.notificationEventTrigger.findMany({
      where: { tenantId, eventKey, isActive: true },
      include: { template: true },
    });

    for (const trigger of triggers) {
      const subject = this.fillTemplate(trigger.template.subjectTemplate, input.variables);
      const body = this.fillTemplate(trigger.template.bodyTemplate, input.variables);
      const notification = await this.tenantPrisma.client.notification.create({
        data: {
          tenantId,
          recipientUserId: input.recipientUserId,
          channel: trigger.template.channel,
          subject,
          body,
          templateId: trigger.templateId,
          createdBy: undefined,
        },
      });
      await this.enqueueDeliver(tenantId, notification.id);
    }
    return triggers.length;
  }

  // ── Inbox reads ─────────────────────────────────────────────────────────────

  list(query: { skip?: number; take?: number; status?: string; channel?: string } = {}) {
    return this.tenantPrisma.client.notification.findMany({
      where: {
        ...(query.status ? { status: query.status as never } : {}),
        ...(query.channel ? { channel: query.channel as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      skip: query.skip ?? 0,
      take: query.take ?? 50,
    });
  }

  async getOne(id: string) {
    const notification = await this.tenantPrisma.client.notification.findFirst({
      where: { id },
      include: { deliveryLogs: { orderBy: { createdAt: 'desc' } } },
    });
    if (!notification) throw new NotFoundException('Notification not found in this tenant.');
    return notification;
  }

  async summary() {
    const [byStatus, byChannel, total, failed, pending] = await Promise.all([
      this.tenantPrisma.client.notification.groupBy({ by: ['status'], _count: { _all: true } }),
      this.tenantPrisma.client.notification.groupBy({ by: ['channel'], _count: { _all: true } }),
      this.tenantPrisma.client.notification.count(),
      this.tenantPrisma.client.notification.count({ where: { status: 'FAILED' } }),
      this.tenantPrisma.client.notification.count({ where: { status: { in: ['PENDING', 'QUEUED'] } } }),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count._all])),
      byChannel: Object.fromEntries(byChannel.map((row) => [row.channel, row._count._all])),
      total,
      failed,
      pending,
    };
  }

  async markRead(id: string) {
    const notification = await this.getOne(id);
    if (notification.channel !== 'IN_APP') {
      throw new BadRequestException('Only in-app notifications can be marked read.');
    }
    return this.tenantPrisma.client.notification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });
  }

  /** Re-enqueues a FAILED notification for another delivery pass. */
  async retry(id: string) {
    const notification = await this.getOne(id);
    if (notification.status !== 'FAILED') {
      throw new BadRequestException('Only FAILED notifications can be retried.');
    }
    const updated = await this.tenantPrisma.client.notification.update({
      where: { id: notification.id },
      data: { status: 'QUEUED', error: null },
    });
    await this.enqueueDeliver(notification.tenantId, notification.id);
    return updated;
  }

  async deliveryLogs(notificationId: string) {
    // Touches the tenant-scoped lookup first so cross-tenant ids are rejected.
    await this.getOne(notificationId);
    return this.tenantPrisma.client.notificationDeliveryLog.findMany({
      where: { notificationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Templates ───────────────────────────────────────────────────────────────

  listTemplates() {
    return this.tenantPrisma.client.notificationTemplate.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getTemplate(id: string) {
    const template = await this.tenantPrisma.client.notificationTemplate.findFirst({
      where: { id, deletedAt: null },
    });
    if (!template) throw new NotFoundException('Notification template not found in this tenant.');
    return template;
  }

  createTemplate(tenantId: string, dto: CreateNotificationTemplateDto, actorUserId: string) {
    return this.tenantPrisma.client.notificationTemplate.create({
      data: {
        tenantId,
        code: dto.code,
        name: dto.name,
        description: dto.description,
        channel: dto.channel,
        subjectTemplate: dto.subjectTemplate,
        bodyTemplate: dto.bodyTemplate,
        variables: (dto.variables ?? undefined) as Prisma.InputJsonValue | undefined,
        isActive: dto.isActive ?? true,
        createdBy: actorUserId,
      },
    });
  }

  async updateTemplate(id: string, dto: UpdateNotificationTemplateDto, actorUserId: string) {
    await this.getTemplate(id);
    return this.tenantPrisma.client.notificationTemplate.update({
      where: { id },
      data: {
        ...(dto.code !== undefined ? { code: dto.code } : {}),
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.channel !== undefined ? { channel: dto.channel } : {}),
        ...(dto.subjectTemplate !== undefined ? { subjectTemplate: dto.subjectTemplate } : {}),
        ...(dto.bodyTemplate !== undefined ? { bodyTemplate: dto.bodyTemplate } : {}),
        ...(dto.variables !== undefined ? { variables: dto.variables as Prisma.InputJsonValue } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        updatedBy: actorUserId,
      },
    });
  }

  /** Soft delete: rows keep their (tenantId, code) uniqueness and providers keep working history. */
  async deleteTemplate(id: string, actorUserId: string) {
    await this.getTemplate(id);
    return this.tenantPrisma.client.notificationTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, updatedBy: actorUserId },
    });
  }

  // ── Campaigns ───────────────────────────────────────────────────────────────

  listCampaigns() {
    return this.tenantPrisma.client.notificationCampaign.findMany({
      where: { deletedAt: null },
      include: { template: { select: { id: true, name: true, code: true, channel: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getCampaign(id: string) {
    const campaign = await this.tenantPrisma.client.notificationCampaign.findFirst({
      where: { id, deletedAt: null },
      include: { template: true },
    });
    if (!campaign) throw new NotFoundException('Notification campaign not found in this tenant.');
    return campaign;
  }

  async createCampaign(tenantId: string, dto: CreateNotificationCampaignDto, actorUserId: string) {
    // Reject cross-tenant template ids up front.
    const template = await this.getTemplate(dto.templateId);
    return this.tenantPrisma.client.notificationCampaign.create({
      data: {
        tenantId,
        name: dto.name,
        description: dto.description,
        templateId: template.id,
        audienceFilter: dto.audienceFilter as Prisma.InputJsonValue,
        scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
        status: dto.scheduledAt ? 'SCHEDULED' : 'DRAFT',
        createdBy: actorUserId,
      },
    });
  }

  async updateCampaign(id: string, dto: UpdateNotificationCampaignDto, actorUserId: string) {
    const campaign = await this.getCampaign(id);
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new BadRequestException('Only DRAFT or SCHEDULED campaigns can be edited.');
    }
    if (dto.templateId) await this.getTemplate(dto.templateId);
    return this.tenantPrisma.client.notificationCampaign.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.templateId !== undefined ? { templateId: dto.templateId } : {}),
        ...(dto.audienceFilter !== undefined ? { audienceFilter: dto.audienceFilter as Prisma.InputJsonValue } : {}),
        ...(dto.scheduledAt !== undefined
          ? { scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null, status: dto.scheduledAt ? 'SCHEDULED' : 'DRAFT' }
          : {}),
        updatedBy: actorUserId,
      },
    });
  }

  /** Resolves an audience filter without creating anything — same shared implementation the
   * worker uses at fan-out time, so the preview always matches who actually receives it. */
  async previewAudience(filter: NotificationAudienceFilter) {
    return resolveAudience(this.tenantPrisma.client, filter);
  }

  /** Launches a DRAFT/SCHEDULED campaign: enqueues one campaign job (delayed until scheduledAt
   * when set) and marks it SCHEDULED/RUNNING-adjacent. The worker resolves the audience and
   * fans each recipient out. */
  async launchCampaign(id: string, actorUserId: string) {
    const campaign = await this.getCampaign(id);
    if (campaign.status !== 'DRAFT' && campaign.status !== 'SCHEDULED') {
      throw new BadRequestException('Only DRAFT or SCHEDULED campaigns can be launched.');
    }
    const scheduledAt = campaign.scheduledAt && campaign.scheduledAt.getTime() > Date.now() ? campaign.scheduledAt : null;

    const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : undefined;
    await this.campaignQueue.add('launch', { tenantId: campaign.tenantId, campaignId: campaign.id }, { delay });

    await this.tenantPrisma.client.notificationCampaign.update({
      where: { id: campaign.id },
      data: { status: scheduledAt ? 'SCHEDULED' : 'RUNNING', updatedBy: actorUserId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: campaign.tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.NOTIFICATION_CAMPAIGN_LAUNCHED,
      module: AUDIT_MODULES.NOTIFICATIONS,
      entityType: 'NotificationCampaign',
      entityId: campaign.id,
      after: { scheduledAt: scheduledAt?.toISOString() },
    });

    return campaign;
  }

  async cancelCampaign(id: string, actorUserId: string) {
    const campaign = await this.getCampaign(id);
    if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELED') {
      throw new BadRequestException('Campaign is already finished.');
    }
    const updated = await this.tenantPrisma.client.notificationCampaign.update({
      where: { id: campaign.id },
      data: { status: 'CANCELED', canceledAt: new Date(), updatedBy: actorUserId },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: campaign.tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.NOTIFICATION_CAMPAIGN_CANCELED,
      module: AUDIT_MODULES.NOTIFICATIONS,
      entityType: 'NotificationCampaign',
      entityId: campaign.id,
    });

    return updated;
  }

  /** Per-recipient notification rows already created for this campaign. */
  async campaignDeliveries(id: string, skip = 0, take = 50) {
    await this.getCampaign(id);
    return this.tenantPrisma.client.notification.findMany({
      where: { campaignId: id },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    });
  }

  // ── Provider configs ────────────────────────────────────────────────────────

  async listProviderConfigs() {
    const rows = await this.tenantPrisma.client.notificationProviderConfig.findMany({
      orderBy: [{ channel: 'asc' }, { isDefault: 'desc' }],
    });
    // Credentials are never returned — even encrypted, they belong to the storage layer only.
    return rows.map(({ credentialsEncrypted: _credentials, ...row }) => row);
  }

  async getProviderConfig(id: string) {
    const row = await this.tenantPrisma.client.notificationProviderConfig.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Notification provider config not found in this tenant.');
    const { credentialsEncrypted: _credentials, ...safe } = row;
    return safe;
  }

  async createProviderConfig(tenantId: string, dto: CreateNotificationProviderConfigDto, actorUserId: string) {
    this.validateProviderConfig(dto.channel, dto.provider, dto.config ?? {}, dto.credentials ?? {});

    const credentialsEncrypted = this.cipher.encrypt(JSON.stringify(dto.credentials ?? {}));
    return this.tenantPrisma.client.notificationProviderConfig.create({
      data: {
        tenantId,
        channel: dto.channel,
        provider: dto.provider,
        name: dto.name,
        config: (dto.config ?? undefined) as Prisma.InputJsonValue | undefined,
        credentialsEncrypted,
        isActive: dto.isActive ?? false,
        isDefault: dto.isDefault ?? false,
        createdBy: actorUserId,
      },
    }).then(({ credentialsEncrypted: _c, ...safe }) => safe);
  }

  async updateProviderConfig(id: string, dto: UpdateNotificationProviderConfigDto, actorUserId: string) {
    // Full row (including encrypted credentials) — the sanitized getProviderConfig() shape
    // deliberately strips credentials, but re-validating needs them.
    const row = await this.tenantPrisma.client.notificationProviderConfig.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Notification provider config not found in this tenant.');

    const nextConfig = dto.config ?? ((row.config as Record<string, unknown> | null) ?? {});
    const nextProvider = row.provider;
    const nextChannel = row.channel as NotificationChannel;
    const nextCredentials =
      dto.credentials !== undefined
        ? dto.credentials
        : row.credentialsEncrypted
          ? (JSON.parse(this.cipher.decrypt(row.credentialsEncrypted)) as Record<string, unknown>)
          : {};
    this.validateProviderConfig(nextChannel, nextProvider, nextConfig, nextCredentials);

    return this.tenantPrisma.client.notificationProviderConfig.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.config !== undefined ? { config: dto.config as Prisma.InputJsonValue } : {}),
        ...(dto.credentials !== undefined
          ? { credentialsEncrypted: this.cipher.encrypt(JSON.stringify(dto.credentials)) }
          : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
        updatedBy: actorUserId,
      },
    }).then(({ credentialsEncrypted: _c, ...safe }) => safe);
  }

  async deleteProviderConfig(id: string, actorUserId: string) {
    const row = await this.getProviderConfig(id);
    await this.tenantPrisma.client.notificationProviderConfig.delete({ where: { id: row.id } });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: row.tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.NOTIFICATION_PROVIDER_CONFIG_DELETED,
      module: AUDIT_MODULES.NOTIFICATIONS,
      entityType: 'NotificationProviderConfig',
      entityId: row.id,
    });
  }

  private validateProviderConfig(channel: NotificationChannel, provider: string, config: Record<string, unknown>, credentials: Record<string, unknown>) {
    if (!notificationProvidersFor(channel).includes(provider)) {
      throw new BadRequestException(
        `Provider "${provider}" is not supported for channel ${channel}. Supported: ${notificationProvidersFor(channel).join(', ')}.`,
      );
    }
    try {
      assertValidProviderConfig({ channel, provider, config, credentials });
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Invalid provider configuration.');
    }
  }

  // ── Event triggers ──────────────────────────────────────────────────────────

  listTriggers() {
    return this.tenantPrisma.client.notificationEventTrigger.findMany({
      include: { template: { select: { id: true, name: true, code: true, channel: true } } },
      orderBy: { eventKey: 'asc' },
    });
  }

  async createTrigger(tenantId: string, dto: CreateNotificationEventTriggerDto, actorUserId: string) {
    await this.getTemplate(dto.templateId);
    return this.tenantPrisma.client.notificationEventTrigger.create({
      data: {
        tenantId,
        eventKey: dto.eventKey,
        templateId: dto.templateId,
        isActive: dto.isActive ?? true,
        createdBy: actorUserId,
      },
    });
  }

  async deleteTrigger(id: string, actorUserId: string) {
    const trigger = await this.tenantPrisma.client.notificationEventTrigger.findFirst({ where: { id } });
    if (!trigger) throw new NotFoundException('Notification event trigger not found in this tenant.');
    await this.tenantPrisma.client.notificationEventTrigger.delete({ where: { id: trigger.id } });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: trigger.tenantId,
      actorType: 'USER',
      actorUserId,
      action: AUDIT_ACTIONS.NOTIFICATION_EVENT_TRIGGER_DELETED,
      module: AUDIT_MODULES.NOTIFICATIONS,
      entityType: 'NotificationEventTrigger',
      entityId: trigger.id,
    });
  }

  // ── Preferences ─────────────────────────────────────────────────────────────

  listPreferences(userId: string) {
    return this.tenantPrisma.client.notificationPreference.findMany({
      where: { userId },
      orderBy: { channel: 'asc' },
    });
  }

  /** Upserts a per-user per-channel toggle (absent row = enabled by default). */
  async upsertPreference(userId: string, channel: NotificationChannel, enabled: boolean) {
    const tenantId = this.tenantContext.tenantId as string;
    return this.tenantPrisma.client.notificationPreference.upsert({
      where: { tenantId_userId_channel: { tenantId, userId, channel } },
      create: { tenantId, userId, channel, enabled },
      update: { enabled },
    });
  }

  // ── Push devices ────────────────────────────────────────────────────────────

  listPushDevices(userId: string) {
    return this.tenantPrisma.client.userPushDevice.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  registerPushDevice(tenantId: string, userId: string, deviceToken: string, platform: string) {
    return this.tenantPrisma.client.userPushDevice.upsert({
      where: { tenantId_userId_deviceToken: { tenantId, userId, deviceToken } },
      create: { tenantId, userId, deviceToken, platform },
      update: { platform, lastSeenAt: new Date() },
    });
  }

  async unregisterPushDevice(id: string, userId: string) {
    const device = await this.tenantPrisma.client.userPushDevice.findFirst({ where: { id, userId } });
    if (!device) throw new NotFoundException('Push device not found.');
    await this.tenantPrisma.client.userPushDevice.delete({ where: { id: device.id } });
    return { success: true };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  private async enqueueDeliver(tenantId: string, notificationId: string, scheduledAt?: Date) {
    const delay = scheduledAt ? Math.max(0, scheduledAt.getTime() - Date.now()) : undefined;
    await this.queue.add('deliver', { tenantId, notificationId }, { delay });
  }

  private fillTemplate(template: string, variables?: Record<string, string | number | boolean>): string {
    // Inline interpolation mirroring @college-erp/notifications renderTemplate — renders now so
    // the stored Notification row is a self-contained snapshot of what the recipient got.
    return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key: string) => {
      const value = variables?.[key];
      return value === undefined || value === null ? match : String(value);
    });
  }
}