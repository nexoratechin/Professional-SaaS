import { Processor, WorkerHost } from '@nestjs/bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job, Queue } from 'bullmq';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type AdmissionPortalMaintenanceJobData, type NotificationJobData } from '@college-erp/types';
import { processorOptions } from '@college-erp/queue';
import { WorkerStorageService } from '../../common/storage/worker-storage.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Access rows outlive their draft by a week so a resume link never dies mid-application. */
const ACCESS_GRACE_DAYS = 7;
/** A portal draft with no activity for this long is abandoned (configurable per-tenant later). */
const ABANDONED_DRAFT_DAYS = 30;
const DRAFTS_PER_TENANT_RUN = 500;

/**
 * Hourly housekeeping for the public admissions portal. There is no request to drive any of
 * this, so it runs on a fixed schedule per tenant:
 *
 *  - ISSUED offers past their expiry are marked EXPIRED (applicants see it immediately);
 *  - applicant access rows past their retention window are deleted (with their OTP/resume state);
 *  - INITIATED drafts untouched for 30 days are purged, including their private storage objects,
 *    so an abandoned application does not keep personal documents indefinitely.
 *
 * Only per-tenant work: every query goes through a tenant-scoped client, so a bug here can never
 * touch another college's applicants.
 */
@Processor(QUEUE_NAMES.ADMISSION_PORTAL_MAINTENANCE, processorOptions(QUEUE_NAMES.ADMISSION_PORTAL_MAINTENANCE))
export class AdmissionPortalMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(AdmissionPortalMaintenanceProcessor.name);

  constructor(
    private readonly storage: WorkerStorageService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notifications: Queue<NotificationJobData>,
  ) {
    super();
  }

  async process(_job: Job<AdmissionPortalMaintenanceJobData>): Promise<void> {
    const tenants = await platformPrismaClient.tenant.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } },
      select: { id: true, slug: true },
    });

    for (const tenant of tenants) {
      try {
        await this.sweepTenant(tenant.id);
      } catch (error) {
        // One bad tenant must not stop the sweep for everyone else.
        this.logger.error(
          `Admission portal maintenance failed for tenant ${tenant.slug}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async sweepTenant(tenantId: string): Promise<void> {
    const client = createTenantScopedClient(tenantId);
    const now = new Date();

    const expiredOffers = await client.admissionOffer.updateMany({
      where: { status: 'ISSUED', expiresAt: { lt: now } },
      data: { status: 'EXPIRED' },
    });

    // "Your offer expires soon": once per offer, three days out.
    const reminderWindowEnd = new Date(now.getTime() + 3 * DAY_MS);
    const expiringOffers = await client.admissionOffer.findMany({
      where: {
        status: 'ISSUED',
        reminderSentAt: null,
        expiresAt: { gt: now, lte: reminderWindowEnd },
      },
      include: {
        application: {
          include: { applicantAccesses: { orderBy: { createdAt: 'desc' }, take: 1 } },
        },
      },
      take: 200,
    });

    for (const offer of expiringOffers) {
      const application = offer.application;
      const access = application.applicantAccesses[0];
      const channel: 'EMAIL' | 'SMS' | null = access
        ? access.channel === 'PHONE'
          ? 'SMS'
          : 'EMAIL'
        : application.email
          ? 'EMAIL'
          : application.phone
            ? 'SMS'
            : null;
      const address = access?.contact ?? application.email ?? application.phone;

      if (channel && address) {
        const notification = await client.notification.create({
          data: {
            tenantId,
            recipientAddress: address,
            recipientName: application.fullName,
            channel,
            subject: `Your admission offer expires on ${offer.expiresAt.toISOString().slice(0, 10)}`,
            body:
              `Your offer ${offer.offerNumber} for ${application.fullName} is still awaiting a response.\n\n` +
              `Accept or decline it in the admissions portal before ${offer.expiresAt.toISOString().slice(0, 10)}; ` +
              `the seat is released when the offer expires.`,
            status: 'PENDING',
          },
        });
        await this.notifications.add('deliver', { tenantId, notificationId: notification.id });
      }

      await client.admissionOffer.update({ where: { id: offer.id }, data: { reminderSentAt: now } });
    }

    const staleAccess = await client.admissionApplicantAccess.deleteMany({
      where: { expiresAt: { lt: new Date(now.getTime() - ACCESS_GRACE_DAYS * DAY_MS) } },
    });

    const cutoff = new Date(now.getTime() - ABANDONED_DRAFT_DAYS * DAY_MS);
    const drafts = await client.admissionApplication.findMany({
      where: { submittedVia: 'PORTAL', status: 'INITIATED', updatedAt: { lt: cutoff } },
      select: { id: true, documents: { select: { storageKey: true } } },
      take: DRAFTS_PER_TENANT_RUN,
    });

    for (const draft of drafts) {
      for (const document of draft.documents) {
        if (!document.storageKey) continue;
        await this.storage.deleteObject(tenantId, document.storageKey).catch(() => undefined);
      }
      await client.admissionApplication.delete({ where: { id: draft.id } });
    }

    if (expiredOffers.count || staleAccess.count || drafts.length) {
      this.logger.log(
        `Admission portal sweep tenant ${tenantId}: ${expiredOffers.count} offers expired, ` +
          `${staleAccess.count} access rows removed, ${drafts.length} abandoned drafts purged.`,
      );
    }
  }
}
