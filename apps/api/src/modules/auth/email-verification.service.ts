import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import { generateOpaqueToken, hashToken } from './token.util';

const VERIFICATION_TOKEN_TTL_MS = 72 * 60 * 60 * 1000; // 3 days

/**
 * Verification is tracked but deliberately does NOT gate login (see UsersService.invite) — an
 * admin who invites a user with a known email and sets their initial password has already
 * vouched for the account. Gating login on verification is left for a future self-registration
 * flow, where nobody has vouched for the email yet and blocking is the right call.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
    private readonly config: AppConfigService,
  ) {}

  async issueVerificationToken(tenantId: string, tenantSlug: string, userId: string, email: string): Promise<void> {
    const rawToken = generateOpaqueToken();
    await this.platformPrisma.client.emailVerificationToken.create({
      data: {
        tenantId,
        userId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS),
      },
    });

    // Invalidate any still-outstanding tokens for this user so an older token cannot be replayed.
    await this.platformPrisma.client.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    // The raw token is only logged when AUTH_DEBUG_TOKEN_LOGGING is explicitly enabled (never in
    // production): it is a live account-activation credential.
    if (this.config.get('AUTH_DEBUG_TOKEN_LOGGING')) {
      this.logger.log(
        `Email verification requested for ${email} (tenant ${tenantSlug}). Verification token (debug logging enabled): ${rawToken}`,
      );
    } else {
      this.logger.log(
        `Email verification requested for ${email} (tenant ${tenantSlug}). Verification link generated; configure an email provider to deliver it.`,
      );
    }

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'SYSTEM',
      action: AUDIT_ACTIONS.EMAIL_VERIFICATION_REQUESTED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'User',
      entityId: userId,
    });
  }

  async verifyEmail(tenantId: string, rawToken: string): Promise<void> {
    const verificationToken = await this.platformPrisma.client.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });
    if (
      !verificationToken ||
      verificationToken.tenantId !== tenantId ||
      verificationToken.usedAt ||
      verificationToken.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired verification token.');
    }

    const user = await this.platformPrisma.client.user.findUniqueOrThrow({
      where: { id: verificationToken.userId },
    });

    await this.platformPrisma.client.$transaction([
      this.platformPrisma.client.user.update({
        where: { id: verificationToken.userId },
        data: {
          emailVerifiedAt: new Date(),
          status: user.status === 'INVITED' ? 'ACTIVE' : undefined,
        },
      }),
      this.platformPrisma.client.emailVerificationToken.update({
        where: { id: verificationToken.id },
        data: { usedAt: new Date() },
      }),
    ]);

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: verificationToken.userId,
      action: AUDIT_ACTIONS.EMAIL_VERIFIED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'User',
      entityId: verificationToken.userId,
    });
  }
}
