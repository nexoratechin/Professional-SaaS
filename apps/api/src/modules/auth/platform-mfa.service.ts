import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import {
  AUDIT_ACTIONS,
  AUDIT_MODULES,
  buildTotpUri,
  generateBackupCodes,
  generateTotpSecret,
  verifyTotpCode,
} from '@college-erp/auth';
import { MfaSecretCipher } from '../../common/security/mfa-secret-cipher';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { AuditService } from '../audit/audit.service';
import { SecurityEventsService } from '../security/security-events.service';
import { MfaChallengeService } from './mfa-challenge.service';
import { PlatformAuthService, type PlatformLoginSuccessResult } from './platform-auth.service';
import { hashToken } from './token.util';
import type { RequestMeta } from './auth.service';

export interface MfaEnrollResult {
  secret: string;
  otpauthUri: string;
}

/**
 * Platform-admin-realm MFA/TOTP — mirrors MfaService (tenant realm) using the same
 * packages/auth TOTP core and MfaSecretCipher, but deliberately bounded: no trusted-device
 * "remember me", no suspicious-login detection, no password history. PlatformUser accounts are
 * a small, internal ops team already covered by short-lived sessions, account lockout, and full
 * PlatformAuditLog coverage — MFA/backup-codes close the biggest remaining gap (a leaked
 * password being sufficient on its own) without building a second copy of the tenant realm's
 * fuller self-service security suite for a user base that doesn't need it.
 */
@Injectable()
export class PlatformMfaService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly cipher: MfaSecretCipher,
    private readonly securityEvents: SecurityEventsService,
    private readonly auditService: AuditService,
    private readonly mfaChallenge: MfaChallengeService,
    private readonly platformAuthService: PlatformAuthService,
  ) {}

  async status(platformUserId: string) {
    const [user, backupCodesRemaining] = await Promise.all([
      this.platformPrisma.client.platformUser.findUniqueOrThrow({
        where: { id: platformUserId },
        select: { mfaEnabled: true, mfaEnabledAt: true },
      }),
      this.platformPrisma.client.platformMfaBackupCode.count({ where: { platformUserId, usedAt: null } }),
    ]);
    return { enabled: user.mfaEnabled, enabledAt: user.mfaEnabledAt, backupCodesRemaining };
  }

  async enroll(platformUserId: string): Promise<MfaEnrollResult> {
    const user = await this.platformPrisma.client.platformUser.findUniqueOrThrow({ where: { id: platformUserId } });
    if (user.mfaEnabled) {
      throw new BadRequestException('MFA is already enabled. Disable it before re-enrolling.');
    }

    const secret = generateTotpSecret();
    await this.platformPrisma.client.platformUser.update({
      where: { id: platformUserId },
      data: { mfaSecretEncrypted: this.cipher.encrypt(secret) },
    });

    return { secret, otpauthUri: buildTotpUri(secret, user.email, 'College ERP SaaS (Platform)') };
  }

  async confirmEnroll(platformUserId: string, code: string): Promise<{ backupCodes: string[] }> {
    const user = await this.platformPrisma.client.platformUser.findUniqueOrThrow({ where: { id: platformUserId } });
    if (!user.mfaSecretEncrypted) {
      throw new BadRequestException('No MFA enrollment in progress — call enroll first.');
    }
    const secret = this.cipher.decrypt(user.mfaSecretEncrypted);
    if (!verifyTotpCode(secret, code)) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    await this.platformPrisma.client.platformUser.update({
      where: { id: platformUserId },
      data: { mfaEnabled: true, mfaEnabledAt: new Date() },
    });
    const backupCodes = await this.replaceBackupCodes(platformUserId);

    await this.securityEvents.record({ scope: 'PLATFORM', platformUserId, eventType: 'MFA_ENABLED' });
    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId: platformUserId,
      action: AUDIT_ACTIONS.MFA_ENABLED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'PlatformUser',
      entityId: platformUserId,
    });

    return { backupCodes };
  }

  async disable(platformUserId: string, password: string): Promise<void> {
    const user = await this.platformPrisma.client.platformUser.findUniqueOrThrow({ where: { id: platformUserId } });
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect password.');
    }

    await this.platformPrisma.client.$transaction([
      this.platformPrisma.client.platformUser.update({
        where: { id: platformUserId },
        data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaEnabledAt: null },
      }),
      this.platformPrisma.client.platformMfaBackupCode.deleteMany({ where: { platformUserId } }),
    ]);

    await this.securityEvents.record({
      scope: 'PLATFORM',
      platformUserId,
      eventType: 'MFA_DISABLED',
      severity: 'WARNING',
    });
    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId: platformUserId,
      action: AUDIT_ACTIONS.MFA_DISABLED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'PlatformUser',
      entityId: platformUserId,
    });
  }

  async regenerateBackupCodes(platformUserId: string): Promise<string[]> {
    const user = await this.platformPrisma.client.platformUser.findUniqueOrThrow({ where: { id: platformUserId } });
    if (!user.mfaEnabled) {
      throw new BadRequestException('Enable MFA before generating backup codes.');
    }
    const codes = await this.replaceBackupCodes(platformUserId);
    await this.securityEvents.record({ scope: 'PLATFORM', platformUserId, eventType: 'BACKUP_CODES_REGENERATED' });
    return codes;
  }

  private async replaceBackupCodes(platformUserId: string): Promise<string[]> {
    const codes = generateBackupCodes();
    await this.platformPrisma.client.$transaction([
      this.platformPrisma.client.platformMfaBackupCode.deleteMany({ where: { platformUserId } }),
      this.platformPrisma.client.platformMfaBackupCode.createMany({
        data: codes.map((code) => ({ platformUserId, codeHash: hashToken(code) })),
      }),
    ]);
    return codes;
  }

  private async tryConsumeBackupCode(platformUserId: string, code: string): Promise<boolean> {
    const result = await this.platformPrisma.client.platformMfaBackupCode.updateMany({
      where: { platformUserId, codeHash: hashToken(code.trim().toUpperCase()), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (result.count > 0) {
      await this.securityEvents.record({
        scope: 'PLATFORM',
        platformUserId,
        eventType: 'BACKUP_CODE_USED',
        severity: 'WARNING',
      });
      return true;
    }
    return false;
  }

  async verifyChallenge(challengeToken: string, code: string, meta: RequestMeta): Promise<PlatformLoginSuccessResult> {
    const payload = await this.mfaChallenge.get(challengeToken);
    if (!payload || payload.realm !== 'PLATFORM') {
      throw new UnauthorizedException('Invalid or expired challenge.');
    }

    const user = await this.platformPrisma.client.platformUser.findUniqueOrThrow({ where: { id: payload.userId } });
    const secret = user.mfaSecretEncrypted ? this.cipher.decrypt(user.mfaSecretEncrypted) : null;
    const codeValid = (secret !== null && verifyTotpCode(secret, code)) || (await this.tryConsumeBackupCode(user.id, code));

    if (!codeValid) {
      const attempts = await this.mfaChallenge.registerFailedAttempt(challengeToken);
      await this.securityEvents.record({
        scope: 'PLATFORM',
        platformUserId: user.id,
        eventType: 'MFA_CHALLENGE_FAILED',
        severity: 'WARNING',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      if (attempts === null) {
        throw new UnauthorizedException('Too many failed attempts. Please log in again.');
      }
      throw new UnauthorizedException('Invalid code.');
    }

    await this.mfaChallenge.consume(challengeToken);
    await this.securityEvents.record({
      scope: 'PLATFORM',
      platformUserId: user.id,
      eventType: 'MFA_CHALLENGE_SUCCEEDED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.platformAuthService.completeLogin(user, meta);
  }
}
