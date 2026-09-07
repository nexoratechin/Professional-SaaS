import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { JwtAccessTokenClaims, AuthenticatedUser } from '@college-erp/auth';
import { AppConfigService } from '../../config/app-config.service';
import { PlatformPrismaService } from '../../common/prisma/platform-prisma.service';

/** Validates a tenant-user access token on every request to a protected /auth, /tenant, /users,
 * /audit route. Re-checks the user is still ACTIVE and the session isn't revoked on every
 * request — a still-valid JWT for a deactivated user or revoked session must not grant access. */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: AppConfigService,
    private readonly platformPrisma: PlatformPrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_PUBLIC_KEY'),
      algorithms: ['RS256'],
    });
  }

  async validate(payload: JwtAccessTokenClaims): Promise<AuthenticatedUser> {
    const session = await this.platformPrisma.client.session.findUnique({ where: { id: payload.sid } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const user = await this.platformPrisma.client.user.findFirst({
      where: { id: payload.sub, tenantId: payload.tenantId },
    });
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException('User is no longer active.');
    }

    return {
      id: user.id,
      tenantId: user.tenantId,
      sessionId: session.id,
      email: user.email,
      fullName: user.fullName,
    };
  }
}
