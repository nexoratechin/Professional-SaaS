import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { createTenantScopedClient, platformPrismaClient } from '@college-erp/database';
import { QUEUE_NAMES, type NotificationJobData } from '@college-erp/types';
import { AppConfigService } from '../../../config/app-config.service';

interface ApplicantMessage {
  tenantId: string;
  address: string;
  name: string | null;
  channel: 'EMAIL' | 'SMS';
  subject: string;
  body: string;
}

/**
 * Delivers messages to public applicants, who are not tenant users.
 *
 * The central notifications pipeline is reused end to end (same Notification row, same queue, same
 * provider config, branding and retry semantics) by writing `recipientAddress` instead of
 * `recipientUserId`. This service therefore writes directly through a tenant-scoped client rather
 * than NotificationsService, which is request-scoped and requires an authenticated tenant context
 * that public routes deliberately never have.
 */
@Injectable()
export class AdmissionPortalNotificationsService {
  private readonly logger = new Logger(AdmissionPortalNotificationsService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly queue: Queue<NotificationJobData>,
    private readonly appConfig: AppConfigService,
  ) {}

  async sendOtp(input: {
    tenantId: string;
    address: string;
    name?: string | null;
    channel: 'EMAIL' | 'SMS';
    code: string;
    ttlMinutes: number;
    collegeName: string;
  }): Promise<void> {
    // Local/staging convenience: with no provider configured the worker falls back to the console
    // provider, which would otherwise only appear in the worker log, far from the API caller.
    if (this.appConfig.get('NODE_ENV') !== 'production') {
      this.logger.debug(`Admission portal OTP for ${input.address}: ${input.code}`);
    }

    const body =
      `${input.code} is your ${input.collegeName} admission portal verification code.\n\n` +
      `It expires in ${input.ttlMinutes} minutes. If you did not request it, ignore this message.\n\n` +
      `Do not share this code with anyone, including staff of the college.`;

    await this.send({
      tenantId: input.tenantId,
      address: input.address,
      name: input.name ?? null,
      channel: input.channel,
      subject: `${input.code} is your verification code`,
      body,
    });
  }

  async sendResumeLink(input: {
    tenantId: string;
    address: string;
    name?: string | null;
    channel: 'EMAIL' | 'SMS';
    link: string;
    collegeName: string;
    expiresDays: number;
  }): Promise<void> {
    const body =
      `Continue your ${input.collegeName} application using this private link:\n\n${input.link}\n\n` +
      `The link is valid for ${input.expiresDays} days and can be used once. ` +
      `If you did not start an application, no action is needed.`;

    await this.send({
      tenantId: input.tenantId,
      address: input.address,
      name: input.name ?? null,
      channel: input.channel,
      subject: `Continue your ${input.collegeName} application`,
      body,
    });
  }

  async sendApplicationReceived(input: {
    tenantId: string;
    address: string;
    name: string;
    channel: 'EMAIL' | 'SMS';
    reference: string;
    collegeName: string;
    supportEmail: string | null;
    supportPhone: string | null;
  }): Promise<void> {
    const support = input.supportEmail ?? input.supportPhone;
    const body =
      `Thank you, ${input.name}. Your application to ${input.collegeName} has been received.\n\n` +
      `Reference: ${input.reference}\n\n` +
      `Track it any time from the admissions portal using this reference and your verified email/phone.` +
      (support ? `\n\nQuestions? Contact ${support}.` : '');

    await this.send({
      tenantId: input.tenantId,
      address: input.address,
      name: input.name,
      channel: input.channel,
      subject: `Application received — ${input.reference}`,
      body,
    });
  }

  /**
   * In-app alert to everyone who can manage admissions. Recipients are resolved from RBAC rather
   * than a hard-coded role list, so a college that renames or clones the registrar role still gets
   * notified. Deliberately IN_APP only: staff already have email, and this must not fan out a
   * separate mail per application during an intake spike.
   */
  async sendStaffAlert(input: { tenantId: string; subject: string; body: string }): Promise<void> {
    const client = createTenantScopedClient(input.tenantId);
    const staff = await client.user.findMany({
      where: {
        status: 'ACTIVE',
        userRoles: {
          some: {
            role: {
              rolePermissions: {
                some: { permission: { key: 'admissions.manage' } },
              },
            },
          },
        },
      },
      select: { id: true },
      take: 25,
    });

    for (const member of staff) {
      const notification = await client.notification.create({
        data: {
          tenantId: input.tenantId,
          recipientUserId: member.id,
          channel: 'IN_APP',
          subject: input.subject,
          body: input.body,
          status: 'PENDING',
        },
      });
      await this.queue.add('deliver', { tenantId: input.tenantId, notificationId: notification.id });
    }
  }

  /** "You have an offer" — resolved from the applicant's access row, falling back to the contact
   *  stored on the application (staff-created applications have no access row). */
  async notifyOfferIssued(input: { tenantId: string; applicationId: string }): Promise<void> {
    const client = createTenantScopedClient(input.tenantId);
    const [app, tenant] = await Promise.all([
      client.admissionApplication.findFirst({
        where: { id: input.applicationId },
        include: {
          applicantAccesses: { orderBy: { createdAt: 'desc' }, take: 1 },
          offers: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      }),
      platformPrismaClient.tenant.findUnique({ where: { id: input.tenantId }, select: { name: true } }),
    ]);
    if (!app) return;
    const offer = app.offers[0];
    if (!offer) return;

    const access = app.applicantAccesses[0];
    const channel: 'EMAIL' | 'SMS' | null = access
      ? access.channel === 'PHONE'
        ? 'SMS'
        : 'EMAIL'
      : app.email
        ? 'EMAIL'
        : app.phone
          ? 'SMS'
          : null;
    const address = access?.contact ?? app.email ?? app.phone;
    if (!channel || !address) return;

    await this.sendOfferIssued({
      tenantId: input.tenantId,
      address,
      name: app.fullName,
      channel,
      reference: app.publicReference ?? app.applicationNumber,
      collegeName: tenant?.name ?? 'the college',
      expiresAt: offer.expiresAt,
    });
  }

  async sendOfferIssued(input: {
    tenantId: string;
    address: string;
    name: string;
    channel: 'EMAIL' | 'SMS';
    reference: string;
    collegeName: string;
    expiresAt: Date;
  }): Promise<void> {
    const body =
      `Good news — ${input.collegeName} has issued you an admission offer.\n\n` +
      `Application: ${input.reference}\nRespond by: ${input.expiresAt.toISOString().slice(0, 10)}\n\n` +
      `Sign in to the admissions portal to accept or decline. Seats are released if the offer expires.`;

    await this.send({
      tenantId: input.tenantId,
      address: input.address,
      name: input.name,
      channel: input.channel,
      subject: `Admission offer for ${input.reference}`,
      body,
    });
  }

  private async send(message: ApplicantMessage): Promise<void> {
    const client = createTenantScopedClient(message.tenantId);
    const notification = await client.notification.create({
      data: {
        tenantId: message.tenantId,
        recipientAddress: message.address,
        recipientName: message.name,
        channel: message.channel,
        subject: message.subject,
        body: message.body,
        status: 'PENDING',
      },
    });

    // Same contract as NotificationsService: the job carries only ids, so a tampered payload
    // cannot make the worker deliver arbitrary content to an arbitrary address.
    await this.queue.add('deliver', { tenantId: message.tenantId, notificationId: notification.id });
  }
}
