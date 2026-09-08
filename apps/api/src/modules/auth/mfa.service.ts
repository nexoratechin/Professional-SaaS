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
import { SecuritySettingsService } from '../security/security-settings.service';
import { AuthService, USER_WITH_ROLES_INCLUDE, type LoginSuccessResult, type RequestMeta } from './auth.service';
import { MfaChallengeService } from './mfa-challenge.service';
import { TrustedDevicesService } from './trusted-devices.service';
import { hashToken } from './token.util';

export interface MfaEnrollResult {
  secret: string;
  otpauthUri: string;
}

export interface MfaVerifyResult {
  loginResult: LoginSuccessResult;
  rememberDeviceToken?: string;
  trustedDeviceDays?: number;
}

/**
 * Tenant-user MFA/TOTP: enroll → confirm → (later) challenge on login → optional "remember this
 * device". Backup codes give a recovery path when the authenticator device is unavailable.
 * Every read/write here goes through PlatformPrismaService with an explicit tenantId — this
 * service's verifyChallenge() runs pre-authentication (no request-scoped tenant context exists
 * yet), so all its methods use one uniform data-access pattern rather than switching between two
 * depending on which method happens to be authenticated, matching AuthService/PasswordResetService's
 * existing convention.
 */
@Injectable()
export class MfaService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly cipher: MfaSecretCipher,
    private readonly securitySettings: SecuritySettingsService,
    private readonly securityEvents: SecurityEventsService,
    private readonly auditService: AuditService,
    private readonly mfaChallenge: MfaChallengeService,
    private readonly trustedDevices: TrustedDevicesService,
    private readonly authService: AuthService,
  ) {}

  async status(tenantId: string, userId: string) {
    const [user, backupCodesRemaining] = await Promise.all([
      this.platformPrisma.client.user.findFirstOrThrow({
        where: { id: userId, tenantId },
        select: { mfaEnabled: true, mfaEnabledAt: true },
      }),
      this.platformPrisma.client.mfaBackupCode.count({ where: { tenantId, userId, usedAt: null } }),
    ]);
    return { enabled: user.mfaEnabled, enabledAt: user.mfaEnabledAt, backupCodesRemaining };
  }

  async enroll(tenantId: string, userId: string): Promise<MfaEnrollResult> {
    const available = await this.securitySettings.isMfaAvailable(tenantId);
    if (!available) {
      throw new BadRequestException("This tenant's plan does not include multi-factor authentication.");
    }
    const user = await this.platformPrisma.client.user.findFirstOrThrow({ where: { id: userId, tenantId } });
    if (user.mfaEnabled) {
      throw new BadRequestException('MFA is already enabled. Disable it before re-enrolling.');
    }

    const secret = generateTotpSecret();
    await this.platformPrisma.client.user.update({
      where: { id: userId },
      data: { mfaSecretEncrypted: this.cipher.encrypt(secret) },
    });

    return { secret, otpauthUri: buildTotpUri(secret, user.email) };
  }

  async confirmEnroll(tenantId: string, userId: string, code: string): Promise<{ backupCodes: string[] }> {
    const user = await this.platformPrisma.client.user.findFirstOrThrow({ where: { id: userId, tenantId } });
    if (!user.mfaSecretEncrypted) {
      throw new BadRequestException('No MFA enrollment in progress — call enroll first.');
    }
    const secret = this.cipher.decrypt(user.mfaSecretEncrypted);
    if (!verifyTotpCode(secret, code)) {
      throw new UnauthorizedException('Invalid verification code.');
    }

    await this.platformPrisma.client.user.update({
      where: { id: userId },
      data: { mfaEnabled: true, mfaEnabledAt: new Date() },
    });
    const backupCodes = await this.replaceBackupCodes(tenantId, userId);

    await this.securityEvents.record({ scope: 'TENANT', tenantId, userId, eventType: 'MFA_ENABLED' });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.MFA_ENABLED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'User',
      entityId: userId,
    });

    return { backupCodes };
  }

  async disable(tenantId: string, userId: string, password: string): Promise<void> {
    const settings = await this.securitySettings.getEffective(tenantId);
    if (settings.mfaRequired) {
      throw new BadRequestException('Your organization requires MFA — it cannot be disabled.');
    }

    const user = await this.platformPrisma.client.user.findFirstOrThrow({ where: { id: userId, tenantId } });
    if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Incorrect password.');
    }

    await this.platformPrisma.client.$transaction([
      this.platformPrisma.client.user.update({
        where: { id: userId },
        data: { mfaEnabled: false, mfaSecretEncrypted: null, mfaEnabledAt: null },
      }),
      this.platformPrisma.client.mfaBackupCode.deleteMany({ where: { tenantId, userId } }),
    ]);

    await this.securityEvents.record({
      scope: 'TENANT',
      tenantId,
      userId,
      eventType: 'MFA_DISABLED',
      severity: 'WARNING',
    });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.MFA_DISABLED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'User',
      entityId: userId,
    });
  }

  async regenerateBackupCodes(tenantId: string, userId: string): Promise<string[]> {
    const user = await this.platformPrisma.client.user.findFirstOrThrow({ where: { id: userId, tenantId } });
    if (!user.mfaEnabled) {
      throw new BadRequestException('Enable MFA before generating backup codes.');
    }
    const codes = await this.replaceBackupCodes(tenantId, userId);
    await this.securityEvents.record({ scope: 'TENANT', tenantId, userId, eventType: 'BACKUP_CODES_REGENERATED' });
    return codes;
  }

  private async replaceBackupCodes(tenantId: string, userId: string): Promise<string[]> {
    const codes = generateBackupCodes();
    await this.platformPrisma.client.$transaction([
      this.platformPrisma.client.mfaBackupCode.deleteMany({ where: { tenantId, userId } }),
      this.platformPrisma.client.mfaBackupCode.createMany({
        data: codes.map((code) => ({ tenantId, userId, codeHash: hashToken(code) })),
      }),
    ]);
    return codes;
  }

  private async tryConsumeBackupCode(tenantId: string, userId: string, code: string): Promise<boolean> {
    const result = await this.platformPrisma.client.mfaBackupCode.updateMany({
      where: { tenantId, userId, codeHash: hashToken(code.trim().toUpperCase()), usedAt: null },
      data: { usedAt: new Date() },
    });
    if (result.count > 0) {
      await this.securityEvents.record({
        scope: 'TENANT',
        tenantId,
        userId,
        eventType: 'BACKUP_CODE_USED',
        severity: 'WARNING',
      });
      return true;
    }
    return false;
  }

  /** The second step of a login that returned `{ mfaRequired: true }`. */
  async verifyChallenge(
    tenantId: string,
    challengeToken: string,
    code: string,
    rememberDevice: boolean,
    meta: RequestMeta,
  ): Promise<MfaVerifyResult> {
    const payload = await this.mfaChallenge.get(challengeToken);
    if (!payload || payload.realm !== 'TENANT' || payload.tenantId !== tenantId) {
      throw new UnauthorizedException('Invalid or expired challenge.');
    }

    const user = await this.platformPrisma.client.user.findFirstOrThrow({
      where: { id: payload.userId, tenantId },
      include: USER_WITH_ROLES_INCLUDE,
    });
    const secret = user.mfaSecretEncrypted ? this.cipher.decrypt(user.mfaSecretEncrypted) : null;
    const codeValid = (secret !== null && verifyTotpCode(secret, code)) || (await this.tryConsumeBackupCode(tenantId, user.id, code));

    if (!codeValid) {
      const attempts = await this.mfaChallenge.registerFailedAttempt(challengeToken);
      await this.securityEvents.record({
        scope: 'TENANT',
        tenantId,
        userId: user.id,
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
      scope: 'TENANT',
      tenantId,
      userId: user.id,
      eventType: 'MFA_CHALLENGE_SUCCEEDED',
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    const loginResult = await this.authService.completeLogin(tenantId, user, meta);

    let rememberDeviceToken: string | undefined;
    let trustedDeviceDays: number | undefined;
    if (rememberDevice) {
      const settings = await this.securitySettings.getEffective(tenantId);
      trustedDeviceDays = settings.trustedDeviceDays;
      rememberDeviceToken = await this.trustedDevices.create(tenantId, user.id, meta, trustedDeviceDays);
    }
    if (payload.isNewDevice) {
      await this.authService.notifyNewDeviceIfEnabled(tenantId, user, meta);
    }

    return { loginResult, rememberDeviceToken, trustedDeviceDays };
  }
}
