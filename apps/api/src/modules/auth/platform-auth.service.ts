import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { PlatformJwtAccessTokenClaims } from '@college-erp/auth';
import type { PlatformUser } from '@college-erp/database';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';
import { compareAgainstDummyHash } from '../../common/security/dummy-password-hash';
import { ACCOUNT_LOCKOUT_DURATION_MS, MAX_FAILED_LOGIN_ATTEMPTS } from '../../common/security/brute-force.constants';
import { AuditService } from '../audit/audit.service';
import { SecuritySettingsService } from '../security/security-settings.service';
import { MfaChallengeService } from './mfa-challenge.service';
import { generateOpaqueToken, hashToken } from './token.util';
import type { RequestMeta } from './auth.service';

export interface PlatformLoginChallengeResult {
  mfaRequired: true;
  challengeToken: string;
  expiresInSeconds: number;
}

export interface PlatformLoginSuccessResult {
  mfaRequired: false;
  accessToken: string;
  rawRefreshToken: string;
  platformUser: PlatformUser;
  mfaSetupRequired?: boolean;
}

export type PlatformLoginServiceResult = PlatformLoginChallengeResult | PlatformLoginSuccessResult;

const MFA_CHALLENGE_TTL_SECONDS = 300;

@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly platformPrisma: PlatformPrismaService,
    private readonly jwtService: JwtService,
    private readonly config: AppConfigService,
    private readonly auditService: AuditService,
    private readonly securitySettings: SecuritySettingsService,
    private readonly mfaChallenge: MfaChallengeService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta): Promise<PlatformLoginServiceResult> {
    const platformUser = await this.platformPrisma.client.platformUser.findUnique({ where: { email } });
    if (!platformUser || !platformUser.isActive) {
      await compareAgainstDummyHash(password);
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (platformUser.lockedUntil && platformUser.lockedUntil > new Date()) {
      await compareAgainstDummyHash(password);
      throw new UnauthorizedException(
        'This account is temporarily locked due to repeated failed login attempts. Try again later.',
      );
    }

    const passwordMatches = await bcrypt.compare(password, platformUser.passwordHash);
    if (!passwordMatches) {
      const nextAttempts = platformUser.failedLoginAttempts + 1;
      const shouldLock = nextAttempts >= MAX_FAILED_LOGIN_ATTEMPTS;
      await this.platformPrisma.client.platformUser.update({
        where: { id: platformUser.id },
        data: {
          failedLoginAttempts: shouldLock ? 0 : nextAttempts,
          lockedUntil: shouldLock ? new Date(Date.now() + ACCOUNT_LOCKOUT_DURATION_MS) : undefined,
        },
      });
      if (shouldLock) {
        await this.auditService.record({
          scope: 'PLATFORM',
          actorType: 'SYSTEM',
          action: 'PLATFORM_ACCOUNT_LOCKED',
          entityType: 'PlatformUser',
          entityId: platformUser.id,
          after: { lockedForMs: ACCOUNT_LOCKOUT_DURATION_MS, reason: 'too many failed login attempts' },
        });
      }
      throw new UnauthorizedException('Invalid credentials.');
    }

    await this.platformPrisma.client.platformUser.update({
      where: { id: platformUser.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    if (platformUser.mfaEnabled) {
      const challengeToken = await this.mfaChallenge.create('PLATFORM', platformUser.id, meta, {
        isNewDevice: false,
      });
      return { mfaRequired: true, challengeToken, expiresInSeconds: MFA_CHALLENGE_TTL_SECONDS };
    }

    const result = await this.completeLogin(platformUser, meta);
    const platformSettings = await this.securitySettings.getPlatformSettings();
    if (platformSettings.mfaRequiredForPlatformAdmins) {
      result.mfaSetupRequired = true;
    }
    return result;
  }

  /** Shared by the direct (no-MFA) login path above and PlatformMfaService.verifyChallenge's
   * post-second-factor path. */
  async completeLogin(platformUser: PlatformUser, meta: RequestMeta): Promise<PlatformLoginSuccessResult> {
    const rawRefreshToken = generateOpaqueToken();
    const session = await this.platformPrisma.client.platformSession.create({
      data: {
        platformUserId: platformUser.id,
        refreshTokenHash: hashToken(rawRefreshToken),
        expiresAt: this.refreshExpiry(),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    const accessToken = await this.signAccessToken({
      sub: platformUser.id,
      sid: session.id,
      role: platformUser.role,
    });

    await this.auditService.record({
      scope: 'PLATFORM',
      actorType: 'PLATFORM_USER',
      actorPlatformUserId: platformUser.id,
      action: 'PLATFORM_LOGIN_SUCCESS',
      entityType: 'PlatformUser',
      entityId: platformUser.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return { mfaRequired: false, accessToken, rawRefreshToken, platformUser };
  }

  async refresh(rawRefreshToken: string) {
    const session = await this.platformPrisma.client.platformSession.findUnique({
      where: { refreshTokenHash: hashToken(rawRefreshToken) },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const rawRefreshTokenNext = generateOpaqueToken();
    const newSession = await this.platformPrisma.client.$transaction(async (tx) => {
      await tx.platformSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return tx.platformSession.create({
        data: {
          platformUserId: session.platformUserId,
          refreshTokenHash: hashToken(rawRefreshTokenNext),
          expiresAt: this.refreshExpiry(),
        },
      });
    });

    const platformUser = await this.platformPrisma.client.platformUser.findUniqueOrThrow({
      where: { id: session.platformUserId },
    });
    const accessToken = await this.signAccessToken({
      sub: platformUser.id,
      sid: newSession.id,
      role: platformUser.role,
    });

    return { accessToken, rawRefreshToken: rawRefreshTokenNext, platformUser };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.platformPrisma.client.platformSession.updateMany({
      where: { refreshTokenHash: hashToken(rawRefreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async signAccessToken(claims: Omit<PlatformJwtAccessTokenClaims, 'iat' | 'exp'>): Promise<string> {
    return this.jwtService.signAsync(claims);
  }

  private refreshExpiry(): Date {
    return new Date(Date.now() + this.config.get('REFRESH_TOKEN_TTL_DAYS') * 24 * 60 * 60 * 1000);
  }
}
