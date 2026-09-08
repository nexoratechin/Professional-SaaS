import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { AUDIT_ACTIONS, AUDIT_MODULES, type JwtAccessTokenClaims } from '@college-erp/auth';
import type { User } from '@college-erp/database';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { compareAgainstDummyHash } from '../../common/security/dummy-password-hash';
import { AuditService } from '../audit/audit.service';
import { SecurityEventsService } from '../security/security-events.service';
import { SecuritySettingsService } from '../security/security-settings.service';
import { LoginRiskService } from './login-risk.service';
import { MfaChallengeService } from './mfa-challenge.service';
import { PasswordHistoryService } from './password-history.service';
import { TrustedDevicesService } from './trusted-devices.service';
import { generateOpaqueToken, hashToken } from './token.util';

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
  /** Raw value of the `trusted_device` cookie, if the client presented one. */
  trustedDeviceToken?: string;
}

export const USER_WITH_ROLES_INCLUDE = { userRoles: { include: { role: true } } } as const;
export type UserWithRoles = User & { userRoles: { role: { code: string } }[] };

export interface LoginChallengeResult {
  mfaRequired: true;
  challengeToken: string;
  expiresInSeconds: number;
}

export interface LoginSuccessResult {
  mfaRequired: false;
  accessToken: string;
  rawRefreshToken: string;
  user: UserWithRoles;
  /** Tenant enforces MFA but this user hasn't enrolled yet — a soft nag, not a hard block, so
   * flipping TenantSecuritySettings.mfaRequired on can never instantly lock out every user who
   * hasn't set MFA up yet (there would be nobody left who could complete enrollment). */
  mfaSetupRequired?: boolean;
}

export type LoginServiceResult = LoginChallengeResult | LoginSuccessResult;

const MFA_CHALLENGE_TTL_SECONDS = 300;

@Injectable()
export class AuthService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly auditService: AuditService,
    private readonly securityEvents: SecurityEventsService,
    private readonly securitySettings: SecuritySettingsService,
    private readonly loginRisk: LoginRiskService,
    private readonly mfaChallenge: MfaChallengeService,
    private readonly trustedDevices: TrustedDevicesService,
    private readonly passwordHistory: PasswordHistoryService,
  ) {}

  async login(tenantId: string, email: string, password: string, meta: RequestMeta): Promise<LoginServiceResult> {
    const user = await this.platformPrisma.client.user.findUnique({
      where: { tenantId_email: { tenantId, email } },
      include: USER_WITH_ROLES_INCLUDE,
    });

    if (!user || !user.passwordHash) {
      await compareAgainstDummyHash(password); // keep response timing consistent — see util
      await this.recordLoginEvent(tenantId, email, 'FAILED_UNKNOWN_EMAIL', meta);
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (user.status !== 'ACTIVE') {
      await compareAgainstDummyHash(password);
      await this.recordLoginEvent(tenantId, email, 'FAILED_USER_INACTIVE', meta);
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await compareAgainstDummyHash(password);
      await this.recordLoginEvent(tenantId, email, 'FAILED_ACCOUNT_LOCKED', meta);
      throw new UnauthorizedException(
        'This account is temporarily locked due to repeated failed login attempts. Try again later.',
      );
    }

    const passwordMatches = await bcrypt.compare(password, user.passwordHash);
    if (!passwordMatches) {
      const settings = await this.securitySettings.getEffective(tenantId);
      await this.registerFailedAttempt(tenantId, user.id, user.failedLoginAttempts, settings);
      await this.recordLoginEvent(tenantId, email, 'FAILED_PASSWORD', meta);
      throw new UnauthorizedException('Invalid credentials.');
    }

    const settings = await this.securitySettings.getEffective(tenantId);
    const risk = await this.loginRisk.assess(tenantId, user, meta, meta.trustedDeviceToken);

    if (risk.isNewDevice && settings.blockSuspiciousLogins && !user.mfaEnabled) {
      await this.securityEvents.record({
        scope: 'TENANT',
        tenantId,
        userId: user.id,
        eventType: 'SUSPICIOUS_LOGIN_BLOCKED',
        severity: 'CRITICAL',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      await this.recordLoginEvent(tenantId, email, 'FAILED_SUSPICIOUS_LOGIN_BLOCKED', meta);
      throw new ForbiddenException(
        'This login was blocked as unusual for your account. Contact your administrator or enable MFA.',
      );
    }

    if (user.mfaEnabled && !risk.trustedDevice) {
      const challengeToken = await this.mfaChallenge.create('TENANT', user.id, meta, {
        tenantId,
        isNewDevice: risk.isNewDevice,
      });
      return { mfaRequired: true, challengeToken, expiresInSeconds: MFA_CHALLENGE_TTL_SECONDS };
    }

    const result = await this.completeLogin(tenantId, user, meta);

    if (risk.trustedDevice) {
      await this.trustedDevices.touch(risk.trustedDevice.id, settings.trustedDeviceDays);
    }
    if (risk.isNewDevice) {
      await this.notifyNewDeviceIfEnabled(tenantId, user, meta, settings);
    }
    if (settings.mfaRequired && !user.mfaEnabled) {
      result.mfaSetupRequired = true;
    }
    return result;
  }

  /** Shared by the direct (no-MFA) login path above and MfaService.verifyChallenge's
   * post-second-factor path, so "should we notify" is decided in exactly one place regardless
   * of which path a given login took. */
  async notifyNewDeviceIfEnabled(
    tenantId: string,
    user: { id: string; email: string; fullName: string },
    meta: RequestMeta,
    settingsOverride?: { notifyOnNewDeviceLogin: boolean },
  ): Promise<void> {
    const settings = settingsOverride ?? (await this.securitySettings.getEffective(tenantId));
    if (settings.notifyOnNewDeviceLogin) {
      await this.loginRisk.notifyNewDevice(tenantId, user, meta);
    }
  }

  /** The tail of a successful login — issuing tokens/session — factored out so both the direct
   * (no-MFA) path here and MfaService.verifyChallenge's post-second-factor path share exactly
   * one implementation. */
  async completeLogin(tenantId: string, user: UserWithRoles, meta: RequestMeta): Promise<LoginSuccessResult> {
    const rawRefreshToken = generateOpaqueToken();
    const session = await this.platformPrisma.client.session.create({
      data: {
        tenantId,
        userId: user.id,
        refreshTokenHash: hashToken(rawRefreshToken),
        expiresAt: this.refreshExpiry(),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    const accessToken = await this.signAccessToken({ sub: user.id, tenantId, sid: session.id });
    await this.platformPrisma.client.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });
    await this.recordLoginEvent(tenantId, user.email, 'SUCCESS', meta);
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: user.id,
      action: AUDIT_ACTIONS.LOGIN_SUCCESS,
      module: AUDIT_MODULES.AUTH,
      entityType: 'Session',
      entityId: session.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { mfaRequired: false, accessToken, rawRefreshToken, user };
  }

  /** Increments the failed-attempt counter and locks the account once it crosses the
   * tenant/platform-configured threshold. A locked account audit entry is written separately
   * from the per-attempt LoginEvent row so it's easy to alert on "accounts getting locked"
   * without wading through every failed password attempt. */
  private async registerFailedAttempt(
    tenantId: string,
    userId: string,
    currentAttempts: number,
    settings: { maxFailedLoginAttempts: number; accountLockoutMinutes: number },
  ): Promise<void> {
    const nextAttempts = currentAttempts + 1;
    const shouldLock = nextAttempts >= settings.maxFailedLoginAttempts;
    const lockoutMs = settings.accountLockoutMinutes * 60 * 1000;

    await this.platformPrisma.client.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: shouldLock ? 0 : nextAttempts,
        lockedUntil: shouldLock ? new Date(Date.now() + lockoutMs) : undefined,
      },
    });

    if (shouldLock) {
      await this.auditService.record({
        scope: 'TENANT',
        tenantId,
        actorType: 'SYSTEM',
        action: AUDIT_ACTIONS.ACCOUNT_LOCKED,
        module: AUDIT_MODULES.AUTH,
        entityType: 'User',
        entityId: userId,
        after: { lockedForMs: lockoutMs, reason: 'too many failed login attempts' },
      });
      await this.securityEvents.record({
        scope: 'TENANT',
        tenantId,
        userId,
        eventType: 'ACCOUNT_LOCKED',
        severity: 'WARNING',
        metadata: { lockedForMs: lockoutMs },
      });
    }
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta) {
    const session = await this.platformPrisma.client.session.findUnique({
      where: { refreshTokenHash: hashToken(rawRefreshToken) },
    });
    if (!session) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (session.revokedAt) {
      // Presenting a hash that maps to an already-rotated/revoked row means this exact token
      // value was used before — treat as compromise and kill every active session for the user.
      await this.platformPrisma.client.session.updateMany({
        where: { userId: session.userId, tenantId: session.tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.auditService.record({
        scope: 'TENANT',
        tenantId: session.tenantId,
        actorType: 'USER',
        actorUserId: session.userId,
        action: AUDIT_ACTIONS.REFRESH_TOKEN_REUSE_DETECTED,
        module: AUDIT_MODULES.AUTH,
        entityType: 'Session',
        entityId: session.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Invalid refresh token.');
    }

    if (session.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired.');
    }

    const rawRefreshTokenNext = generateOpaqueToken();
    const newSession = await this.platformPrisma.client.$transaction(async (tx) => {
      await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return tx.session.create({
        data: {
          tenantId: session.tenantId,
          userId: session.userId,
          refreshTokenHash: hashToken(rawRefreshTokenNext),
          expiresAt: this.refreshExpiry(),
          ipAddress: meta.ipAddress,
          userAgent: meta.userAgent,
        },
      });
    });

    const user = await this.platformPrisma.client.user.findUniqueOrThrow({
      where: { id: session.userId },
      include: USER_WITH_ROLES_INCLUDE,
    });
    const accessToken = await this.signAccessToken({ sub: user.id, tenantId: session.tenantId, sid: newSession.id });

    return { accessToken, rawRefreshToken: rawRefreshTokenNext, user };
  }

  async logout(rawRefreshToken: string, meta: RequestMeta = {}): Promise<void> {
    const session = await this.platformPrisma.client.session.findUnique({
      where: { refreshTokenHash: hashToken(rawRefreshToken) },
    });
    if (!session || session.revokedAt) {
      return;
    }

    await this.platformPrisma.client.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId: session.tenantId,
      actorType: 'USER',
      actorUserId: session.userId,
      action: AUDIT_ACTIONS.LOGOUT,
      module: AUDIT_MODULES.AUTH,
      entityType: 'Session',
      entityId: session.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  /** "Log out of all other devices" — keeps the caller's own current session alive. */
  async revokeOtherSessions(tenantId: string, userId: string, currentSessionId: string): Promise<void> {
    await this.platformPrisma.client.session.updateMany({
      where: { tenantId, userId, id: { not: currentSessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.securityEvents.record({
      scope: 'TENANT',
      tenantId,
      userId,
      eventType: 'ALL_SESSIONS_REVOKED',
      metadata: { keptSessionId: currentSessionId },
    });
  }

  /** Self-service password change (distinct from the token-based forgot/reset flow) — verifies
   * the CURRENT password, enforces password-history reuse rules, and revokes every OTHER active
   * session while keeping the caller's own session alive (they just proved identity, unlike the
   * reset-password flow which revokes everything since nobody is authenticated there). */
  async changePassword(
    tenantId: string,
    userId: string,
    currentSessionId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.platformPrisma.client.user.findFirstOrThrow({ where: { id: userId, tenantId } });
    if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect.');
    }

    const settings = await this.securitySettings.getEffective(tenantId);
    await this.passwordHistory.assertNotReused(tenantId, userId, newPassword, user.passwordHash, settings.passwordHistoryCount);

    const newPasswordHash = await bcrypt.hash(newPassword, 12);
    await this.platformPrisma.client.user.update({ where: { id: userId }, data: { passwordHash: newPasswordHash } });
    await this.passwordHistory.recordAndPrune(tenantId, userId, user.passwordHash, settings.passwordHistoryCount);
    await this.platformPrisma.client.session.updateMany({
      where: { tenantId, userId, id: { not: currentSessionId }, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.securityEvents.record({ scope: 'TENANT', tenantId, userId, eventType: 'PASSWORD_CHANGED' });
    await this.auditService.record({
      scope: 'TENANT',
      tenantId,
      actorType: 'USER',
      actorUserId: userId,
      action: AUDIT_ACTIONS.PASSWORD_CHANGED,
      module: AUDIT_MODULES.AUTH,
      entityType: 'User',
      entityId: userId,
    });
  }

  private async signAccessToken(claims: Omit<JwtAccessTokenClaims, 'iat' | 'exp'>): Promise<string> {
    return this.jwtService.signAsync(claims);
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS') * 24 * 60 * 60 * 1000);
  }

  private async recordLoginEvent(
    tenantId: string,
    email: string,
    result:
      | 'SUCCESS'
      | 'FAILED_PASSWORD'
      | 'FAILED_USER_INACTIVE'
      | 'FAILED_UNKNOWN_EMAIL'
      | 'FAILED_ACCOUNT_LOCKED'
      | 'FAILED_SUSPICIOUS_LOGIN_BLOCKED',
    meta: RequestMeta,
  ): Promise<void> {
    await this.platformPrisma.client.loginEvent.create({
      data: {
        tenantId,
        emailAttempted: email,
        result,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });
  }
}
