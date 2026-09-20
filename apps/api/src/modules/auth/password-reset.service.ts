import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AUDIT_ACTIONS, AUDIT_MODULES } from '@college-erp/auth';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import { SecurityEventsService } from '../security/security-events.service';
import { SecuritySettingsService } from '../security/security-settings.service';
import { PasswordHistoryService } from './password-history.service';
import { generateOpaqueToken, hashToken } from './token.util';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly auditService: AuditService,
    private readonly securityEvents: SecurityEventsService,
    private readonly securitySettings: SecuritySettingsService,
    private readonly passwordHistory: PasswordHistoryService,
  ) {}

  /**
   * Always resolves the same way regardless of whether the email exists or the account is
   * active — returning a different result (or an error) for "unknown email" vs "known email"
   * would let an attacker enumerate valid tenant email addresses through this endpoint alone.
   */
  async forgotPassword(tenantId: string, tenantSlug: string, email: string): Promise<void> {
    const user = await this.platformPrisma.client.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
    });
    if (!user || user.status !== 'ACTIVE') {
      return;
    }

    const rawToken = generateOpaqueToken();
    await this.platformPrisma.client.passwordResetToken.create({
      data: {
        tenantId,
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    // No email provider yet (Phase 8+ Integrations) — log the link the same way
    // NotificationsProcessor logs deliveries, so this flow is fully exercisable end to end today.
    this.logger.log(
      `Password reset requested for ${email} (tenant ${tenantSlug}). Reset token (not delivered — no email ` +
        `provider configured yet): ${rawToken}`,
    );

    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.PASSWORD_RESET_REQUESTED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'User',
      entityId: user.id,
    });
  }

  async resetPassword(tenantId: string, rawToken: string, newPassword: string): Promise<void> {
    const resetToken = await this.platformPrisma.client.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
    });

    // Reject if the token doesn't exist, was issued for a DIFFERENT tenant than the one this
    // request resolved to, was already used, or has expired — one generic error for all cases
    // so none of them is distinguishable from the others.
    if (!resetToken || resetToken.tenantId !== tenantId || resetToken.usedAt || resetToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token.');
    }

    const user = await this.platformPrisma.client.user.findUniqueOrThrow({ where: { id: resetToken.userId } });
    const settings = await this.securitySettings.getEffective(tenantId);
    await this.passwordHistory.assertNotReused(tenantId, user.id, newPassword, user.passwordHash, settings.passwordHistoryCount);

    const passwordHash = await bcrypt.hash(newPassword, 12);

    await this.platformPrisma.client.$transaction([
      this.platformPrisma.client.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      }),
      this.platformPrisma.client.passwordResetToken.update({
        where: { id: resetToken.id },
        data: { usedAt: new Date() },
      }),
      // A password reset must invalidate every existing session — an attacker who compromised
      // the OLD password's sessions must not keep using them after the owner resets it.
      this.platformPrisma.client.session.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    if (user.passwordHash) {
      await this.passwordHistory.recordAndPrune(tenantId, user.id, user.passwordHash, settings.passwordHistoryCount);
    }

    await this.securityEvents.record({ scope: 'TENANT', tenantId, userId: resetToken.userId, eventType: 'PASSWORD_CHANGED' });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: resetToken.userId,
      action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'User',
      entityId: resetToken.userId,
    });
  }
}
