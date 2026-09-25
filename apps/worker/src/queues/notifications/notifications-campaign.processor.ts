import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { Job } from 'bullmq';
import { FEATURE_KEYS } from '@college-erp/auth';
import { createTenantScopedClient } from '@college-erp/database';
import { renderTemplate, resolveAudience } from '@college-erp/notifications';
import { QUEUE_NAMES, type NotificationAudienceFilter, type NotificationCampaignJobData } from '@college-erp/types';
import { EntitlementGate } from '../../entitlement/entitlement-gate';

/**
 * Scheduled/immediate campaign fan-out. The API enqueues one job per campaign launch (with a
 * BullMQ delay when the campaign has a scheduledAt); this processor then:
 *
 *  1. re-checks entitlement (the tenant may have been downgraded since the job was enqueued);
 *  2. re-reads the campaign through a tenant-scoped client — a canceled campaign is a no-op;
 *  3. marks it RUNNING and snapshots the audience via @college-erp/notifications' resolveAudience
 *     (the same implementation the API's preview endpoint uses, so both sides always agree);
 *  4. renders the template into a per-recipient Notification row and enqueues one `deliver` job
 *     per recipient onto the main notifications queue;
 *  5. marks the campaign COMPLETED with the resolved audience count.
 *
 * All mutations ride the tenant-scoped client built from the job's tenantId — the job payload is
 * the only carrier of tenant context, exactly like the rest of the worker.
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS_CAMPAIGN)
export class NotificationsCampaignProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsCampaignProcessor.name);

  constructor(
    private readonly entitlementGate: EntitlementGate,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationsQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<NotificationCampaignJobData>): Promise<void> {
    const { tenantId, campaignId } = job.data;
    if (!tenantId) {
      throw new Error('Notification campaign job is missing tenantId; refusing to process.');
    }

    const tenantClient = createTenantScopedClient(tenantId);

    const campaign = await tenantClient.notificationCampaign.findFirst({
      where: { id: campaignId, deletedAt: null },
      include: { template: true },
    });
    if (!campaign) {
      throw new Error(`Notification campaign ${campaignId} not found for tenant ${tenantId}.`);
    }

    // A campaign that was canceled (or already completed) between enqueue and processing is a
    // no-op — never deliver it.
    if (campaign.status === 'CANCELED' || campaign.status === 'COMPLETED') {
      this.logger.debug(`Skipped campaign ${campaign.id}: status is ${campaign.status}.`);
      return;
    }

    if (!(await this.entitlementGate.isFeatureEnabled(tenantId, FEATURE_KEYS.NOTIFICATIONS))) {
      await tenantClient.notificationCampaign.update({
        where: { id: campaign.id },
        data: { status: 'FAILED' },
      });
      this.logger.debug(`Skipped campaign ${campaign.id}: tenant ${tenantId} lost notifications entitlement.`);
      return;
    }

    await tenantClient.notificationCampaign.update({
      where: { id: campaign.id },
      data: { status: 'RUNNING', startedAt: campaign.startedAt ?? new Date() },
    });

    const filter = campaign.audienceFilter as unknown as NotificationAudienceFilter;
    const userIds = await resolveAudience(tenantClient, filter);

    this.logger.log(
      `Launching campaign ${campaign.id} (${campaign.name}) for ${userIds.length} recipients on tenant ${tenantId}.`,
    );

    for (const userId of userIds) {
      const subject = renderTemplate(campaign.template.subjectTemplate);
      const body = renderTemplate(campaign.template.bodyTemplate);

      const notification = await tenantClient.notification.create({
        data: {
          tenantId,
          recipientUserId: userId,
          channel: campaign.template.channel,
          subject: subject.text,
          body: body.text,
          templateId: campaign.templateId,
          campaignId: campaign.id,
          createdBy: campaign.createdBy ?? undefined,
        },
      });

      // Same payload contract as direct sends: tenantId + notificationId only; the deliver
      // processor re-fetches everything through its own tenant-scoped client.
      await this.notificationsQueue.add('deliver', { tenantId, notificationId: notification.id });
    }

    await tenantClient.notificationCampaign.update({
      where: { id: campaign.id },
      data: { status: 'COMPLETED', audienceCount: userIds.length, completedAt: new Date() },
    });
  }
}