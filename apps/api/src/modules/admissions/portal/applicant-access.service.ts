import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createTenantScopedClient, type AdmissionApplicantAccess } from '@college-erp/database';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { AppConfigService } from '../../../config/app-config.service';
import { AuditService } from '../../audit/audit.service';
import { AdmissionApplicantTokenService } from './applicant-token.service';
import { AdmissionPortalNotificationsService } from './admission-portal-notifications.service';
import type { AdmissionPortalConfig } from './admission-portal.config';

export interface ApplicantContact {
  channel: 'EMAIL' | 'PHONE';
  /** Normalised: lowercased email, or E.164-ish digits with an optional leading +. */
  contact: string;
  hash: string;
}

export interface OtpRequestResult {
  channel: 'EMAIL' | 'PHONE';
  sentTo: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
  /** Only present when ADMISSION_PORTAL_DEBUG_OTP is on outside production (e2e/local). */
  debugCode?: string;
}

export interface ApplicantSession {
  accessToken: string;
  expiresInSeconds: number;
  resumeToken: string;
  resumeExpiresAt: string;
  applicationId: string | null;
  sentTo: string;
}

const OTP_HASH_DOMAIN = 'admission-portal:otp:v1';

/**
 * Owns everything about "who is this applicant" on the public portal: contact normalisation,
 * one-time codes, the access row, and resume links.
 *
 * Threat model, since this is the only unauthenticated write path in the product:
 *  - contact enumeration is useless (identical responses for unknown contact and wrong code);
 *  - OTPs are HMAC'd, expire in 10 minutes and allow 5 attempts;
 *  - a per-access send counter plus a resend cooldown caps SMS/email bombing even behind rotating
 *    IPs (the controller adds the usual per-IP throttle on top);
 *  - resume tokens are 256-bit random, stored hashed, single-use.
 */
@Injectable()
export class ApplicantAccessService {
  constructor(
    private readonly tokens: AdmissionApplicantTokenService,
    private readonly notifications: AdmissionPortalNotificationsService,
    private readonly auditService: AuditService,
    private readonly appConfig: AppConfigService,
  ) {}

  normalise(channel: 'EMAIL' | 'PHONE', raw: string): ApplicantContact {
    const value = raw.trim();
    if (channel === 'EMAIL') {
      const email = value.toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 320) {
        throw new BadRequestException('Enter a valid email address.');
      }
      return { channel, contact: email, hash: this.sha256(email) };
    }

    const digits = value.replace(/[^0-9]/g, '');
    if (digits.length < 8 || digits.length > 15) {
      throw new BadRequestException('Enter a valid phone number, including the country code.');
    }
    const phone = value.startsWith('+') ? `+${digits}` : digits;
    return { channel, contact: phone, hash: this.sha256(phone) };
  }

  async requestOtp(input: {
    tenantId: string;
    tenantName: string;
    config: AdmissionPortalConfig;
    channel: 'EMAIL' | 'PHONE';
    contact: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<OtpRequestResult> {
    const normalised = this.normalise(input.channel, input.contact);
    const client = createTenantScopedClient(input.tenantId);
    const now = new Date();

    const existing = await client.admissionApplicantAccess.findUnique({
      where: {
        tenantId_channel_contactHash: {
          tenantId: input.tenantId,
          channel: normalised.channel,
          contactHash: normalised.hash,
        },
      },
    });

    if (existing) {
      this.assertCanSend(existing, input.config, now);
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const otpHash = this.hashOtp(code);
    const otpExpiresAt = new Date(now.getTime() + input.config.otp.ttlSeconds * 1000);
    const expiresAt = new Date(now.getTime() + input.config.draftRetentionDays * 24 * 60 * 60 * 1000);

    const row = existing
      ? await client.admissionApplicantAccess.update({
          where: { id: existing.id },
          data: {
            contact: normalised.contact,
            otpHash,
            otpExpiresAt,
            otpAttempts: 0,
            otpSentAt: now,
            otpSentCount: { increment: 1 },
            ipHash: input.ip ? this.sha256(input.ip) : null,
            userAgentHash: input.userAgent ? this.sha256(input.userAgent) : null,
            lastSeenAt: now,
            expiresAt,
          },
        })
      : await this.createAccessRow({
          tenantId: input.tenantId,
          normalised,
          otpHash,
          otpExpiresAt,
          expiresAt,
          now,
          ip: input.ip,
          userAgent: input.userAgent,
        });

    try {
      await this.notifications.sendOtp({
        tenantId: input.tenantId,
        address: normalised.contact,
        channel: normalised.channel === 'PHONE' ? 'SMS' : 'EMAIL',
        code,
        ttlMinutes: Math.round(input.config.otp.ttlSeconds / 60),
        collegeName: input.tenantName,
      });
    } catch (error) {
      // Persisting the hash without delivering the code leaves the applicant stuck at "code sent".
      // Clear it so the next attempt is not blocked by a cooldown for a message that never existed.
      await client.admissionApplicantAccess
        .update({ where: { id: row.id }, data: { otpHash: null, otpExpiresAt: null } })
        .catch(() => undefined);
      throw error;
    }

    return {
      channel: normalised.channel,
      sentTo: this.mask(normalised.channel, normalised.contact),
      expiresInSeconds: input.config.otp.ttlSeconds,
      resendAfterSeconds: input.config.otp.resendCooldownSeconds,
      ...(this.debugOtpEnabled() ? { debugCode: code } : {}),
    };
  }

  /** e2e/local escape hatch: an environment with no mail provider can still complete the flow.
   *  Hard-disabled in production regardless of configuration. */
  private debugOtpEnabled(): boolean {
    return this.appConfig.get('NODE_ENV') !== 'production' && this.appConfig.get('ADMISSION_PORTAL_DEBUG_OTP');
  }

  async verifyOtp(input: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    config: AdmissionPortalConfig;
    appBaseUrl: string;
    channel: 'EMAIL' | 'PHONE';
    contact: string;
    code: string;
    ip: string | null;
    userAgent: string | null;
  }): Promise<ApplicantSession> {
    const normalised = this.normalise(input.channel, input.contact);
    const client = createTenantScopedClient(input.tenantId);
    const now = new Date();

    const row = await client.admissionApplicantAccess.findUnique({
      where: {
        tenantId_channel_contactHash: {
          tenantId: input.tenantId,
          channel: normalised.channel,
          contactHash: normalised.hash,
        },
      },
    });

    // Deliberately one message for every failure mode: unknown contact, expired code, no code
    // outstanding, wrong code. Anything else turns this endpoint into a contact oracle.
    const invalid = () =>
      new BadRequestException('That code is not valid or has expired. Request a new code.');

    if (!row || !row.otpHash || !row.otpExpiresAt || row.otpExpiresAt < now) {
      throw invalid();
    }
    if (row.otpAttempts >= input.config.otp.maxAttempts) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'OTP_ATTEMPTS_EXCEEDED',
          message: 'Too many incorrect attempts. Request a new code.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const expected = Buffer.from(row.otpHash, 'hex');
    const actual = Buffer.from(this.hashOtp(input.code.trim()), 'hex');
    const matches = expected.length === actual.length && timingSafeEqual(expected, actual);

    if (!matches) {
      await client.admissionApplicantAccess.update({
        where: { id: row.id },
        data: { otpAttempts: { increment: 1 }, lastSeenAt: now },
      });
      throw invalid();
    }

    const resumeToken = randomBytes(32).toString('base64url');
    const resumeExpiresAt = new Date(now.getTime() + input.config.resumeTokenTtlDays * 24 * 60 * 60 * 1000);

    const updated = await client.admissionApplicantAccess.update({
      where: { id: row.id },
      data: {
        verifiedAt: row.verifiedAt ?? now,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        resumeTokenHash: this.sha256(resumeToken),
        resumeExpiresAt,
        ipHash: input.ip ? this.sha256(input.ip) : row.ipHash,
        userAgentHash: input.userAgent ? this.sha256(input.userAgent) : row.userAgentHash,
        lastSeenAt: now,
      },
    });

    await this.auditService.record({
      scope: 'TENANT',
      tenantId: input.tenantId,
      actorType: 'APPLICANT',
      action: AUDIT_ACTIONS.ADMISSION_PORTAL_OTP_VERIFIED,
      module: AUDIT_MODULES.ADMISSIONS,
      entityType: 'AdmissionApplicantAccess',
      entityId: updated.id,
      ipAddress: input.ip ?? undefined,
      userAgent: input.userAgent ?? undefined,
      after: { channel: normalised.channel, masked: this.mask(normalised.channel, normalised.contact) },
    });

    await this.sendResumeLink({
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      tenantSlug: input.tenantSlug,
      appBaseUrl: input.appBaseUrl,
      channel: normalised.channel,
      contact: normalised.contact,
      resumeToken,
      expiresDays: input.config.resumeTokenTtlDays,
    }).catch(() => undefined); // never fail a successful verification on a courtesy email

    const accessToken = await this.tokens.sign(
      { accessId: updated.id, tenantId: input.tenantId, applicationId: updated.applicationId },
      input.config.applicantTokenTtlSeconds,
    );

    return {
      accessToken,
      expiresInSeconds: input.config.applicantTokenTtlSeconds,
      resumeToken,
      resumeExpiresAt: resumeExpiresAt.toISOString(),
      applicationId: updated.applicationId,
      sentTo: this.mask(normalised.channel, normalised.contact),
    };
  }

  async resume(input: {
    tenantId: string;
    config: AdmissionPortalConfig;
    resumeToken: string;
  }): Promise<ApplicantSession> {
    const client = createTenantScopedClient(input.tenantId);
    const hash = this.sha256(input.resumeToken.trim());
    const row = await client.admissionApplicantAccess.findFirst({
      where: { resumeTokenHash: hash, resumeExpiresAt: { gt: new Date() }, expiresAt: { gt: new Date() } },
    });
    if (!row || !row.verifiedAt) {
      throw new NotFoundException('This link has expired. Verify your email or phone to continue.');
    }

    const accessToken = await this.tokens.sign(
      { accessId: row.id, tenantId: input.tenantId, applicationId: row.applicationId },
      input.config.applicantTokenTtlSeconds,
    );

    return {
      accessToken,
      expiresInSeconds: input.config.applicantTokenTtlSeconds,
      resumeToken: input.resumeToken,
      resumeExpiresAt: (row.resumeExpiresAt ?? new Date()).toISOString(),
      applicationId: row.applicationId,
      sentTo: this.mask(row.channel as 'EMAIL' | 'PHONE', row.contact),
    };
  }

  /** Loads the access row behind a verified token and rejects revoked/expired access. */
  async requireAccess(tenantId: string, accessId: string): Promise<AdmissionApplicantAccess> {
    const client = createTenantScopedClient(tenantId);
    const row = await client.admissionApplicantAccess.findFirst({ where: { id: accessId } });
    if (!row || !row.verifiedAt) {
      throw new BadRequestException('Verify your email or phone number to continue.');
    }
    if (row.expiresAt < new Date()) {
      throw new BadRequestException('This application session has expired. Start a new application.');
    }
    return row;
  }

  async bindApplication(tenantId: string, accessId: string, applicationId: string): Promise<void> {
    const client = createTenantScopedClient(tenantId);
    await client.admissionApplicantAccess.update({
      where: { id: accessId },
      data: { applicationId, lastSeenAt: new Date() },
    });
  }

  private async createAccessRow(input: {
    tenantId: string;
    normalised: ApplicantContact;
    otpHash: string;
    otpExpiresAt: Date;
    expiresAt: Date;
    now: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<AdmissionApplicantAccess> {
    const client = createTenantScopedClient(input.tenantId);
    try {
      return await client.admissionApplicantAccess.create({
        data: {
          tenantId: input.tenantId,
          channel: input.normalised.channel,
          contact: input.normalised.contact,
          contactHash: input.normalised.hash,
          otpHash: input.otpHash,
          otpExpiresAt: input.otpExpiresAt,
          otpSentAt: input.now,
          otpSentCount: 1,
          ipHash: input.ip ? this.sha256(input.ip) : null,
          userAgentHash: input.userAgent ? this.sha256(input.userAgent) : null,
          expiresAt: input.expiresAt,
        },
      });
    } catch (error) {
      // Two simultaneous first-time requests race on the unique (tenant, channel, contact) key.
      // The loser retries the update path rather than surfacing a 500 to the applicant.
      const existing = await client.admissionApplicantAccess.findUnique({
        where: {
          tenantId_channel_contactHash: {
            tenantId: input.tenantId,
            channel: input.normalised.channel,
            contactHash: input.normalised.hash,
          },
        },
      });
      if (!existing) throw error;
      return existing;
    }
  }

  private assertCanSend(row: AdmissionApplicantAccess, config: AdmissionPortalConfig, now: Date): void {
    if (row.otpSentCount >= config.otp.maxSendsPerAccess) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          code: 'OTP_SEND_LIMIT_REACHED',
          message: 'Too many verification codes requested. Contact the admissions office.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (row.otpSentAt) {
      const elapsedMs = now.getTime() - row.otpSentAt.getTime();
      if (elapsedMs < config.otp.resendCooldownSeconds * 1000) {
        const retryAfter = Math.ceil((config.otp.resendCooldownSeconds * 1000 - elapsedMs) / 1000);
        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            code: 'OTP_COOLDOWN',
            message: `Please wait ${retryAfter}s before requesting another code.`,
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }
  }

  private async sendResumeLink(input: {
    tenantId: string;
    tenantName: string;
    tenantSlug: string;
    appBaseUrl: string;
    channel: 'EMAIL' | 'PHONE';
    contact: string;
    resumeToken: string;
    expiresDays: number;
  }): Promise<void> {
    const link = `${input.appBaseUrl.replace(/\/+$/, '')}/apply/${encodeURIComponent(input.tenantSlug)}?resume=${encodeURIComponent(input.resumeToken)}`;
    await this.notifications.sendResumeLink({
      tenantId: input.tenantId,
      address: input.contact,
      channel: input.channel === 'PHONE' ? 'SMS' : 'EMAIL',
      link,
      collegeName: input.tenantName,
      expiresDays: input.expiresDays,
    });
  }

  private hashOtp(code: string): string {
    const secret = this.appConfig.get('NOTIFICATION_SECRET_KEY');
    return createHmac('sha256', secret).update(`${OTP_HASH_DOMAIN}:${code}`).digest('hex');
  }

  private sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private mask(channel: 'EMAIL' | 'PHONE', contact: string): string {
    if (channel === 'EMAIL') {
      const [local, domain] = contact.split('@');
      if (!local || !domain) return '•••';
      const head = local.slice(0, 2);
      return `${head}${'•'.repeat(Math.max(1, local.length - 2))}@${domain}`;
    }
    return `${contact.slice(0, 3)}${'•'.repeat(Math.max(1, contact.length - 5))}${contact.slice(-2)}`;
  }
}
